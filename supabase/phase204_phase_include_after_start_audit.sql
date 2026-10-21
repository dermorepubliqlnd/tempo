-- phase204 (2026-10-22, Sandra): a phase skipped at Start Project can be
-- brought back (or an empty phase skipped) after the project has started,
-- with no approval step -- the change is recorded in the Audit Trail.
-- Who: the project owner, the owner's supervisor or Full Access.
-- Guard: after start, a phase that still has live tasks can't be skipped.

-- 1. Audit Trail change type for phases.
do $$
declare v_name text; v_def text;
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def
  from pg_constraint
  where conrelid = 'public.project_revision_changes'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%change_type%'
  limit 1;
  if v_name is null or v_def ilike '%phase_changed%' then return; end if;
  execute format('alter table public.project_revision_changes drop constraint %I', v_name);
  execute format('alter table public.project_revision_changes add constraint %I %s', v_name,
                 replace(v_def, 'ARRAY[', 'ARRAY[''phase_changed''::text, '));
end $$;

-- 2. Guard: Draft as before; after start, owner / owner's supervisor / Full Access.
create or replace function public.r2_guard_milestone_scope() returns trigger
language plpgsql as $$
declare v_status text;
begin
  if new.is_included is distinct from old.is_included then
    select coalesce(wbs_status, 'draft') into v_status from public.projects where id = new.project_id;
    if v_status <> 'draft' and coalesce(current_setting('app.r2_internal', true), '') <> 'on' then
      if v_status = 'closed' then
        raise exception 'This project is closed, so its phases can''t be changed.';
      end if;
      if not public.r2_can_manage_project_tasks(new.project_id) then
        raise exception 'Only the project owner, their supervisor or Full Access can change this project''s phases.';
      end if;
      if not new.is_included and exists (
        select 1 from public.tasks t
        where t.project_id = new.project_id and t.wbs_phase = new.phase_key
          and not coalesce(t.is_archived, false) and coalesce(t.status, '') <> 'Cancelled'
      ) then
        raise exception 'This phase still has tasks. Move or cancel them before skipping the phase.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 3. Record the change in the project's open revision (same place as other plan changes).
create or replace function public.trg_r2_phase_scope_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_label text;
  v_open uuid;
  v_src uuid;
  v_num integer;
begin
  if new.is_included is not distinct from old.is_included then return new; end if;
  select coalesce(wbs_status, 'draft') into v_status from projects where id = new.project_id;
  if v_status not in ('baseline_locked', 'changed_after_baseline') then return new; end if;
  select label into v_label from lifecycle_phases where key = new.phase_key;
  select id into v_open from project_revisions where project_id = new.project_id and status = 'in_progress';
  if v_open is null then
    select id into v_src from project_plan_versions where project_id = new.project_id order by version_number desc limit 1;
    select coalesce(max(revision_number), 0) + 1 into v_num from project_revisions where project_id = new.project_id;
    insert into project_revisions (project_id, revision_number, reason, status, source_plan_version_id, started_by)
    values (new.project_id, v_num, 'Auto-opened on phase change', 'in_progress', v_src, my_person_id())
    returning id into v_open;
    update projects set wbs_status = 'changed_after_baseline' where id = new.project_id;
  end if;
  insert into project_revision_changes (revision_id, task_id, task_name, change_type, field, previous_value, new_value, changed_by)
  values (v_open, new.id, 'Phase: ' || coalesce(v_label, new.phase_key), 'phase_changed', 'phase',
          to_jsonb(case when old.is_included then 'Included' else 'Skipped' end),
          to_jsonb(case when new.is_included then 'Included' else 'Skipped' end),
          my_person_id());
  return new;
end;
$$;
drop trigger if exists trg_r2_phase_scope_audit on public.project_milestones;
create trigger trg_r2_phase_scope_audit after update of is_included on public.project_milestones
  for each row execute function public.trg_r2_phase_scope_audit();
