-- phase194 (2026-10-14, Sandra): module view. Tasks carry the module they
-- belong to (set by Add module) so the WBS can group by module; module
-- sign-offs link to the Design Approved / Materials Approved milestones.
alter table public.tasks add column if not exists module_name text;

create or replace function public.r2_add_module(p_project_id uuid, p_module_name text, p_maker_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  p record;
  v_name text := btrim(coalesce(p_module_name, ''));
  v_reviewer uuid;
  v_start date;
  v_due date;
  v_base bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_noout uuid := (select id from output_types where name = 'No Deliverable/Activity Only' limit 1);
  s record;
  i int;
begin
  if v_name = '' then raise exception 'Give the module a name, e.g. "M1 Hygiene basics".'; end if;
  if not public.can_manage_wbs(p_project_id) then
    raise exception 'Only the project owner or Full Access can add a module to this project.';
  end if;
  select * into p from projects where id = p_project_id;
  if p.id is null or p.lifecycle_version is distinct from 2 then
    raise exception 'Modules are only available for projects using the new lifecycle.';
  end if;
  if coalesce(p.wbs_status, 'draft') = 'closed' then raise exception 'This project is closed.'; end if;

  -- Reviewer = the maker's supervisor, falling back to the project owner.
  select reports_to into v_reviewer from people where id = coalesce(p_maker_id, p.owner_id);
  v_reviewer := coalesce(v_reviewer, p.owner_id);
  v_start := coalesce(p.start_date::date, (now() at time zone 'Asia/Manila')::date);
  v_due := greatest(coalesce(p.end_date::date, v_start), v_start);

  i := 0;
  for s in select * from (values
      (1, 'design',      'Design / storyboard · ' || v_name, coalesce(p_maker_id, p.owner_id), 8::numeric, false),
      (2, 'design',      'Review · design · ' || v_name,     v_reviewer,                        1::numeric, true),
      (3, 'design',      'Sign-off · design · ' || v_name,   p.owner_id,                        0.5::numeric, true),
      (4, 'development', 'Build · ' || v_name,               coalesce(p_maker_id, p.owner_id), 16::numeric, false),
      (5, 'development', 'Review · build · ' || v_name,      v_reviewer,                        2::numeric, true),
      (6, 'development', 'Sign-off · build · ' || v_name,    p.owner_id,                        0.5::numeric, true)
    ) as x(n, phase_key, name, assignee, hours, is_check) order by n loop
    insert into tasks (project_id, name, assignee_id, status,
                       start_date, start_date_full, start_date_standard, start_full_auto, start_standard_auto,
                       original_due_date, current_due_date, estimated_hours,
                       output_type_id, output_count, wbs_phase, sort_order, created_by, module_name)
    values (p_project_id, s.name, s.assignee, 'Not Started',
            v_start, v_start, v_start, true, true,
            v_due, v_due, s.hours,
            case when s.is_check then v_noout end, case when s.is_check then 0 end,
            s.phase_key, v_base + s.n, my_person_id(), v_name)
    returning id into v_id;
    if i > 0 then
      insert into task_dependencies (task_id, depends_on_task_id) values (v_id, v_ids[i]) on conflict do nothing;
    end if;
    v_ids := v_ids || v_id;
    i := i + 1;
  end loop;
  -- Milestones (#12): Design Approved waits on the FIRST module's design sign-off
  -- (building can start once M1 is approved); Materials Approved waits on every
  -- module's build sign-off.
  if not exists (select 1 from milestone_dependencies md join project_milestones pm on pm.id = md.milestone_id
                 where pm.project_id = p_project_id and pm.phase_key = 'design') then
    insert into milestone_dependencies (milestone_id, task_id)
    select pm.id, v_ids[3] from project_milestones pm where pm.project_id = p_project_id and pm.phase_key = 'design'
    on conflict do nothing;
  end if;
  insert into milestone_dependencies (milestone_id, task_id)
  select pm.id, v_ids[6] from project_milestones pm where pm.project_id = p_project_id and pm.phase_key = 'development'
  on conflict do nothing;
  return 6;
end;
$$;
grant execute on function public.r2_add_module(uuid, text, uuid) to authenticated;
