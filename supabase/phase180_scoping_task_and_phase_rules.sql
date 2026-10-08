-- phase180 (2026-10-09, Sandra):
-- (1) Stage -> Phase rules in Site Settings (automatic or manual):
--     app_settings.stage_phase_rules = {"draft":{"phase":"Scoping","auto":true},"closed":{"phase":"Done","auto":true}}
-- (2) Scoping task: every Draft project gets one "Scoping & WBS planning" task (owner),
--     the only task that takes time before Start Project. On Start it's completed
--     (Done + validated, Estimated = logged) or archived if no time was logged.
--     It's kept out of the WBS editor / baseline snapshot by the client (is_scoping).

alter table public.app_settings add column if not exists stage_phase_rules jsonb not null
  default '{"draft":{"phase":"Scoping","auto":true},"closed":{"phase":"Done","auto":true}}'::jsonb;
alter table public.tasks add column if not exists is_scoping boolean not null default false;

create or replace function public.a_project_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rules jsonb := coalesce((select stage_phase_rules from app_settings limit 1), '{}'::jsonb);
begin
  if new.wbs_status = 'closed' and coalesce(new.status, '') not in ('Cancelled', 'Completed') then
    new.status := 'Completed';
    new.completed_at := coalesce(new.completed_at, now());
    if coalesce((v_rules->'closed'->>'auto')::boolean, true) then
      new.phase := coalesce(v_rules->'closed'->>'phase', 'Done');
    end if;
  end if;
  if tg_op = 'UPDATE' and old.wbs_status = 'closed' and coalesce(new.wbs_status, '') <> 'closed' and new.status = 'Completed' then
    new.status := 'In Progress';
    new.completed_at := null;
    if new.phase = 'Done' then new.phase := null; end if;
  end if;
  if coalesce(new.wbs_status, 'draft') = 'draft' then
    if coalesce((v_rules->'draft'->>'auto')::boolean, true) then
      new.phase := v_rules->'draft'->>'phase';
    end if;
  end if;
  if coalesce(new.wbs_status, 'draft') not in ('draft', 'closed') then
    if coalesce(new.status, 'Not Started') in ('Not Started', 'Completed') then
      new.status := 'In Progress';
    end if;
    if new.phase in ('Backlog', 'Queued', 'Done') then
      new.phase := null;
    end if;
  end if;
  new.stage := public.project_stage_of(new.status, new.wbs_status, new.id);
  return new;
end;
$$;

-- Time can be logged on the Scoping task before Start Project.
create or replace function public.enforce_time_entry_baseline_lock() returns trigger
language plpgsql as $$
declare
  v_locked boolean;
  v_wbs_status text;
  v_scoping boolean;
begin
  if TG_OP = 'INSERT' and NEW.task_id is not null then
    select pr.timelines_locked, pr.wbs_status, t.is_scoping into v_locked, v_wbs_status, v_scoping
      from tasks t join projects pr on pr.id = t.project_id
      where t.id = NEW.task_id;
    if v_wbs_status = 'closed' then
      raise exception 'this project is closed -- no more hours can be logged against its tasks';
    end if;
    if not coalesce(v_locked, false) and not coalesce(v_scoping, false) then
      raise exception 'hours can only be logged/tracked once this project has been started (WBS Planning -> Start Project). Before that, log planning time on the project''s Scoping task.';
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.ensure_scoping_task(p_project_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  p record;
begin
  select id into v_id from tasks where project_id = p_project_id and is_scoping and not is_archived limit 1;
  if v_id is not null then return v_id; end if;
  select * into p from projects where id = p_project_id;
  if p.id is null or coalesce(p.wbs_status, 'draft') <> 'draft' or coalesce(p.is_archived, false) then return null; end if;
  insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date, is_scoping, sort_order,
                     output_type_id, output_count)
  values (p_project_id, 'Scoping & WBS planning', p.owner_id, 'Not Started',
          coalesce(p.created_at::date, (now() at time zone 'Asia/Manila')::date),
          greatest(coalesce(p.start_date::date, (now() at time zone 'Asia/Manila')::date), coalesce(p.created_at::date, (now() at time zone 'Asia/Manila')::date)),
          greatest(coalesce(p.start_date::date, (now() at time zone 'Asia/Manila')::date), coalesce(p.created_at::date, (now() at time zone 'Asia/Manila')::date)),
          true, -1000,
          (select id from output_types where name = 'No Deliverable/Activity Only' limit 1), 0)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.trg_project_scoping_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_task uuid;
  v_hours numeric;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if tg_op = 'INSERT' then
    perform public.ensure_scoping_task(new.id);
    return null;
  end if;
  -- owner changed while Draft: scoping task follows the owner
  if new.owner_id is distinct from old.owner_id and coalesce(new.wbs_status, 'draft') = 'draft' then
    update tasks set assignee_id = new.owner_id where project_id = new.id and is_scoping and not is_archived and status <> 'Done';
  end if;
  -- Start Project approved: complete (or archive) the Scoping task
  if coalesce(old.wbs_status, 'draft') = 'draft' and coalesce(new.wbs_status, 'draft') <> 'draft' then
    select id into v_task from tasks where project_id = new.id and is_scoping and not is_archived and status <> 'Done' limit 1;
    if v_task is not null then
      select coalesce(sum(duration_minutes), 0) / 60.0 into v_hours
        from time_entries where task_id = v_task and not coalesce(is_archived, false) and status <> 'rejected';
      perform set_config('app.bypass_done_task_lock', 'on', true);
      perform set_config('app.bypass_due_date_lock', 'on', true);
      perform set_config('app.bypass_start_date_lock', 'on', true);
      perform set_config('app.bypass_validation_rpc', 'on', true);
      perform set_config('app.timelines_lock_governance', 'on', true);
      perform set_config('app.bypass_timelines_lock_governance', 'on', true);
      if v_hours <= 0 then
        update tasks set is_archived = true where id = v_task;
      else
        update tasks set
          estimated_hours = round(v_hours, 2),
          current_due_date = v_today,
          status = 'Done',
          actual_completion_date = v_today,
          submitted_on = now(),
          validated_completion_date = v_today::timestamptz,
          validation_performed_at = now(),
          validated_locked_at = now(),
          output_count = 0
        where id = v_task;
      end if;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists zz_project_scoping_task on public.projects;
create trigger zz_project_scoping_task after insert or update of wbs_status, owner_id on public.projects
  for each row execute function public.trg_project_scoping_task();

-- Backfill: Draft projects get their Scoping task; Draft phase follows the rule.
select public.ensure_scoping_task(id) from projects where coalesce(wbs_status, 'draft') = 'draft' and not coalesce(is_archived, false) and not coalesce(is_unsaved, false);
alter table public.projects disable trigger trg_touch_activity_projects;
update public.projects set phase = phase where coalesce(wbs_status, 'draft') = 'draft';
alter table public.projects enable trigger trg_touch_activity_projects;
