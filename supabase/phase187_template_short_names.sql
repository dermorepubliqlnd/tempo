-- phase187 (2026-10-13, Sandra): short task names in the scoping template,
-- with the detail moved to a task description shown on hover.
-- Adds tasks.description (nullable; existing tasks unaffected) and
-- task_templates.description; r2_apply_template copies it onto new tasks.
alter table public.tasks add column if not exists description text;
alter table public.task_templates add column if not exists description text;

update public.task_templates t set name = v.name, description = v.descr
  from (values
    ('1.1',  'Discovery call',    'Kickoff with the requestor / sponsor. Map stakeholders and SMEs: who validates content, who signs off.'),
    ('1.2',  'Needs analysis',    'Groups the three analysis steps below. Hours roll up from them.'),
    ('1.2a', 'Data gathering',    'Interviews, floor or store observation, and data review (audits, NCRs, complaints, KPIs).'),
    ('1.2b', 'Learner profile',   'Roles, headcount, shifts, sites, Litmos access and language of the target learners.'),
    ('1.2c', 'Gap analysis',      'Performance gap: training vs non-training solution. Produces the Needs Analysis (TNA).'),
    ('1.3',  'Scope statement',   'Outcomes, audience, modality, success metrics (Kirkpatrick L1-L4) and a rough estimate for later phases. Produces the Scope Document.'),
    ('1.4',  'Review scope',      'Check the scope statement for completeness and alignment before sponsor sign-off.'),
    ('1.5',  'Scope sign-off',    'Sponsor approves the scope. Scope Confirmed is reached at Start Project.')
  ) as v(ref, name, descr)
 where t.template_key = 'scoping' and t.ref = v.ref;

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
                       work_type_id, output_type_id, output_count, wbs_phase, sort_order, description)
    values (p_project_id,
            case when r.parent_ref is not null then (v_ids ->> r.parent_ref)::uuid end,
            r.name, p.owner_id, 'Not Started',
            v_start, v_start, v_start, true, true,
            v_due, v_due, r.estimated_hours,
            (select id from work_types where name = r.work_type_name limit 1),
            (select id from output_types where name = r.output_type_name limit 1),
            case when r.output_type_name = 'No Deliverable/Activity Only' then 0 end,
            r.phase_key, v_base + r.sort_order, r.description)
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
