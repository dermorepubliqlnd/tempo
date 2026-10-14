-- phase199 (2026-10-14, Sandra): Work Type / Output Type matrix applied.
-- * Output Type pre-filled on template and module tasks (still editable).
-- * Site Settings dropdown lists: outputs added under the work types that use them.
-- * System Configuration always counts as 1 output.

-- 1. Dropdown lists (Work Type -> Output Type) ----------------------------------
insert into public.work_type_output_types (work_type_id, output_type_id)
select w.id, o.id from (values
  ('LMS Administration','System Configuration'), ('LMS Administration','Data / Tracker'),
  ('Project Management','Communication Material'), ('Project Management','No Deliverable/Activity Only'),
  ('Evaluation','Survey / Evaluation'), ('Evaluation','Data / Tracker'), ('Evaluation','Report'),
  ('Quality Assurance','QA Record'), ('Quality Assurance','No Deliverable/Activity Only'),
  ('Training Delivery','Session'), ('Training Delivery','No Deliverable/Activity Only'),
  ('Learning Design & Analysis','Storyboard'), ('Learning Design & Analysis','Training Design'),
  ('LMS Administration','No Deliverable/Activity Only')
) as v(wt, ot)
join public.work_types w on w.name = v.wt
join public.output_types o on o.name = v.ot
on conflict (work_type_id, output_type_id) do nothing;

-- 2. Template Output Types -----------------------------------------------------
update public.task_templates t set output_type_name = v.ot
from (values
  ('delivery','D1','Session'), ('delivery','D2','Session'), ('delivery','D3','Session'),
  ('delivery','D5','System Configuration'), ('delivery','D6','No Deliverable/Activity Only'),
  ('delivery','D7','Communication Material'), ('delivery','D8','No Deliverable/Activity Only'),
  ('delivery','D9','Data / Tracker'), ('delivery','D10','No Deliverable/Activity Only'),
  ('evaluation','E1','Survey / Evaluation'), ('evaluation','E2','Data / Tracker'), ('evaluation','E3','Data / Tracker'),
  ('evaluation','E4','Data / Tracker'), ('evaluation','E5','Report'), ('evaluation','E6','Data / Tracker'),
  ('evaluation','E7','System Configuration'), ('evaluation','E8','Report'), ('evaluation','E9','Report')
) as v(k, r, ot)
where t.template_key = v.k and t.ref = v.r;
-- (D4 Pilot Fixes keeps no preset: it's the same output as the build.)

-- 3. System Configuration always counts as 1 -----------------------------------
create or replace function public.trg_r2_system_config_count() returns trigger
language plpgsql as $$
begin
  if new.output_type_id is not null
     and exists (select 1 from output_types where id = new.output_type_id and name = 'System Configuration') then
    new.output_count := 1;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_r2_system_config_count on public.tasks;
create trigger trg_r2_system_config_count before insert or update of output_type_id, output_count on public.tasks
  for each row execute function public.trg_r2_system_config_count();

-- 4. Add module: Output Type pre-filled (Storyboard, QA Record x1, sign-offs no deliverable) --
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
  v_out uuid;
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
      (1, 'design',      'Design / Storyboard · ' || v_name, coalesce(p_maker_id, p.owner_id), 8::numeric, false, 'Learning Design & Analysis', 'Storyboard'),
      (2, 'design',      'Review · Design · ' || v_name,     v_reviewer,                        1::numeric, true, 'Quality Assurance', 'QA Record'),
      (3, 'design',      'Sign-Off · Design · ' || v_name,   p.owner_id,                        0.5::numeric, true, 'Quality Assurance', null::text),
      (4, 'development', 'Build · ' || v_name,               coalesce(p_maker_id, p.owner_id), 16::numeric, false, 'Content Development', null::text),
      (5, 'development', 'Review · Build · ' || v_name,      v_reviewer,                        2::numeric, true, 'Quality Assurance', 'QA Record'),
      (6, 'development', 'Sign-Off · Build · ' || v_name,    p.owner_id,                        0.5::numeric, true, 'Quality Assurance', null::text)
    ) as x(n, phase_key, name, assignee, hours, is_check, work_type, out_type) order by n loop
    v_out := coalesce((select id from output_types where name = s.out_type limit 1), case when s.is_check then v_noout end);
    insert into tasks (project_id, name, assignee_id, status,
                       start_date, start_date_full, start_date_standard, start_full_auto, start_standard_auto,
                       original_due_date, current_due_date, estimated_hours,
                       output_type_id, output_count, wbs_phase, sort_order, created_by, module_name, work_type_id)
    values (p_project_id, s.name, s.assignee, 'Not Started',
            v_start, v_start, v_start, true, true,
            v_due, v_due, s.hours,
            v_out, case when s.out_type = 'QA Record' then 1 when s.is_check then 0 end,
            s.phase_key, v_base + s.n, my_person_id(), v_name,
            (select id from work_types where name = s.work_type limit 1))
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
