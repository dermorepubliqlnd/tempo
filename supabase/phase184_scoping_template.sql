-- phase184 (2026-10-13, Sandra): Analysis & Scoping template for NEW
-- lifecycle projects (lifecycle_version = 2), applied from the WBS page.
-- The tasks it adds are ordinary WBS tasks: the owner can rename, delete or
-- change hours like any other task. Templates live in task_templates so a
-- Site Settings editor can manage them later.
-- Also: assignees of Analysis & Scoping tasks can see and log time on them
-- while the project is still Draft (scoping happens before Start Project).
-- Existing projects are unaffected (all checks require lifecycle_version = 2
-- or wbs_phase = 'analysis', which only new-lifecycle projects have).

-- 1. Template rows ---------------------------------------------------------
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  template_name text not null,
  phase_key text not null references public.lifecycle_phases(key),
  ref text not null,                 -- row id inside the template (e.g. '1.2a')
  parent_ref text,                   -- ref of the parent row, null = top level
  sort_order int not null,
  name text not null,
  work_type_name text,               -- matched to work_types.name
  output_type_name text,             -- matched to output_types.name
  estimated_hours numeric,
  depends_on_refs text[] not null default '{}',
  is_active boolean not null default true,
  unique (template_key, ref)
);
alter table public.task_templates enable row level security;
drop policy if exists task_templates_select on public.task_templates;
create policy task_templates_select on public.task_templates for select to authenticated using (true);
drop policy if exists task_templates_write on public.task_templates;
create policy task_templates_write on public.task_templates for all to authenticated
  using (public.my_access_level() = 'full') with check (public.my_access_level() = 'full');

insert into public.task_templates (template_key, template_name, phase_key, ref, parent_ref, sort_order, name, work_type_name, output_type_name, estimated_hours, depends_on_refs) values
  ('scoping', 'Analysis & Scoping', 'analysis', '1.1',  null,  10, 'Discovery / kickoff call (incl. stakeholder and SME mapping)', 'Project Management', 'Discovery Call', 2.5, '{}'),
  ('scoping', 'Analysis & Scoping', 'analysis', '1.2',  null,  20, 'Needs analysis', 'Learning Design & Analysis', null, null, '{}'),
  ('scoping', 'Analysis & Scoping', 'analysis', '1.2a', '1.2', 21, 'Interviews, observation and data review (audits, NCRs, complaints, KPIs)', 'Learning Design & Analysis', 'No Deliverable/Activity Only', 6, '{1.1}'),
  ('scoping', 'Analysis & Scoping', 'analysis', '1.2b', '1.2', 22, 'Learner and context profile (roles, headcount, shifts, sites, Litmos access, language)', 'Learning Design & Analysis', 'No Deliverable/Activity Only', 2, '{1.2a}'),
  ('scoping', 'Analysis & Scoping', 'analysis', '1.2c', '1.2', 23, 'Performance gap: training vs non-training solution', 'Learning Design & Analysis', 'Needs Analysis (TNA)', 2, '{1.2a}'),
  ('scoping', 'Analysis & Scoping', 'analysis', '1.3',  null,  30, 'Scope statement (outcomes, audience, modality, success metrics L1-L4, rough estimate)', 'Learning Design & Analysis', 'Scope Document', 6, '{1.2b,1.2c}'),
  ('scoping', 'Analysis & Scoping', 'analysis', '1.4',  null,  40, 'Review scope', 'Quality Assurance', 'No Deliverable/Activity Only', 1, '{1.3}'),
  ('scoping', 'Analysis & Scoping', 'analysis', '1.5',  null,  50, 'Scope sign-off (sponsor)', 'Quality Assurance', 'No Deliverable/Activity Only', 0.5, '{1.4}')
on conflict (template_key, ref) do nothing;
-- (Output types above reflect phase185; on a fresh database run phase185 first or re-run its updates.)

-- 2. Apply a template to a project ----------------------------------------
create or replace function public.r2_apply_template(p_project_id uuid, p_template_key text) returns int
language plpgsql security definer set search_path = public as $$
declare
  p record;
  r record;
  v_ids jsonb := '{}'::jsonb;
  v_id uuid;
  v_start date;
  v_due date;
  v_base bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_n int := 0;
  v_dep text;
begin
  if not public.can_manage_wbs(p_project_id) then
    raise exception 'Only the project owner or Full Access can add a template to this project.';
  end if;
  select * into p from projects where id = p_project_id;
  if p.id is null or p.lifecycle_version is distinct from 2 then
    raise exception 'Templates are only available for projects using the new lifecycle.';
  end if;
  if coalesce(p.wbs_status, 'draft') = 'closed' then
    raise exception 'This project is closed.';
  end if;
  v_start := coalesce(p.start_date::date, (now() at time zone 'Asia/Manila')::date);
  v_due := greatest(coalesce(p.end_date::date, v_start), v_start);

  for r in select * from task_templates where template_key = p_template_key and is_active
           order by (parent_ref is not null), sort_order loop
    insert into tasks (project_id, parent_task_id, name, assignee_id, status,
                       start_date, start_date_full, start_date_standard, start_full_auto, start_standard_auto,
                       original_due_date, current_due_date, estimated_hours,
                       work_type_id, output_type_id, output_count, wbs_phase, sort_order)
    values (p_project_id,
            case when r.parent_ref is not null then (v_ids ->> r.parent_ref)::uuid end,
            r.name, p.owner_id, 'Not Started',
            v_start, v_start, v_start, true, true,
            v_due, v_due, r.estimated_hours,
            (select id from work_types where name = r.work_type_name limit 1),
            (select id from output_types where name = r.output_type_name limit 1),
            case when r.output_type_name = 'No Deliverable/Activity Only' then 0 end,
            r.phase_key, v_base + r.sort_order)
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object(r.ref, v_id);
    v_n := v_n + 1;
  end loop;

  for r in select * from task_templates where template_key = p_template_key and is_active and cardinality(depends_on_refs) > 0 loop
    foreach v_dep in array r.depends_on_refs loop
      if v_ids ? v_dep and v_ids ? r.ref then
        insert into task_dependencies (task_id, depends_on_task_id)
        values ((v_ids ->> r.ref)::uuid, (v_ids ->> v_dep)::uuid) on conflict do nothing;
      end if;
    end loop;
  end loop;
  return v_n;
end;
$$;
grant execute on function public.r2_apply_template(uuid, text) to authenticated;

-- 3. Draft privacy: assignees can see their own Analysis & Scoping tasks ----
drop policy if exists tasks_draft_privacy on public.tasks;
create policy tasks_draft_privacy on public.tasks as restrictive for select to authenticated
  using (public.can_see_project_plan(project_id) or (wbs_phase = 'analysis' and assignee_id = public.my_person_id()));
drop policy if exists tasks_draft_privacy_upd on public.tasks;
create policy tasks_draft_privacy_upd on public.tasks as restrictive for update to authenticated
  using (public.can_see_project_plan(project_id) or (wbs_phase = 'analysis' and assignee_id = public.my_person_id()));

-- 4. Time logging: allowed on Analysis & Scoping tasks before Start Project --
create or replace function public.enforce_time_entry_baseline_lock() returns trigger
language plpgsql as $$
declare
  v_locked boolean;
  v_wbs_status text;
  v_scoping boolean;
  v_analysis boolean;
begin
  if TG_OP = 'INSERT' and NEW.task_id is not null then
    select pr.timelines_locked, pr.wbs_status, t.is_scoping,
           (t.wbs_phase = 'analysis' and pr.lifecycle_version = 2)
      into v_locked, v_wbs_status, v_scoping, v_analysis
      from tasks t join projects pr on pr.id = t.project_id
      where t.id = NEW.task_id;
    if v_wbs_status = 'closed' then
      raise exception 'this project is closed -- no more hours can be logged against its tasks';
    end if;
    if not coalesce(v_locked, false) and not coalesce(v_scoping, false) and not coalesce(v_analysis, false) then
      raise exception 'hours can only be logged/tracked once this project has been started (WBS Planning -> Start Project). Before that, log planning time on the project''s Scoping task.';
    end if;
  end if;
  return NEW;
end;
$$;
