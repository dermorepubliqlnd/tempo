-- phase207 (2026-10-21, Sandra): the Work Type decides the hand-off buttons.
--   Quality Assurance = a review step (Pass QA / For Revision)
--   Sign-Off (new)    = final approval (Approve / For Revision)
-- * New work type "Sign-Off" (output: No Deliverable/Activity Only).
-- * Scope Sign-Off template and Add module sign-offs use it.
-- * Sign-off tasks on new-lifecycle projects (created from 13 Oct) switch from
--   Quality Assurance to Sign-Off. Older projects are not touched.
-- * Archiving a step already re-links the chain; it now also hands its
--   milestone link to the step before it.

-- 1. Work type -------------------------------------------------------------------
-- Sandra added it as "Sign Off" on 21 Oct; align the name with the task names.
update public.work_types set name = 'Sign-Off' where name = 'Sign Off'
  and not exists (select 1 from public.work_types where name = 'Sign-Off');
insert into public.work_types (name, sort_order, is_active, color)
select 'Sign-Off', w.sort_order, true, w.color from public.work_types w where w.name = 'Quality Assurance'
on conflict (name) do nothing;
insert into public.work_type_output_types (work_type_id, output_type_id)
select w.id, o.id from public.work_types w, public.output_types o
where w.name = 'Sign-Off' and o.name = 'No Deliverable/Activity Only'
on conflict (work_type_id, output_type_id) do nothing;

-- 2. Templates and Add module ------------------------------------------------------
update public.task_templates set work_type_name = 'Sign-Off'
where template_key = 'scoping' and name ~* 'sign[- ]?off' and work_type_name = 'Quality Assurance';

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
      (3, 'design',      'Sign-Off · Design · ' || v_name,   p.owner_id,                        0.5::numeric, true, 'Sign-Off', null::text),
      (4, 'development', 'Build · ' || v_name,               coalesce(p_maker_id, p.owner_id), 16::numeric, false, 'Content Development', null::text),
      (5, 'development', 'Review · Build · ' || v_name,      v_reviewer,                        2::numeric, true, 'Quality Assurance', 'QA Record'),
      (6, 'development', 'Sign-Off · Build · ' || v_name,    p.owner_id,                        0.5::numeric, true, 'Sign-Off', null::text)
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

-- 3. Backfill: sign-offs on new-lifecycle projects ---------------------------------
update public.tasks t set work_type_id = (select id from public.work_types where name = 'Sign-Off')
from public.projects p
where p.id = t.project_id and p.lifecycle_version = 2 and p.created_at >= '2026-10-13'
  and t.work_type_id = (select id from public.work_types where name = 'Quality Assurance')
  and t.name ~* '(sign[- ]?off|approv|validat)'
  and coalesce(t.status, '') not in ('Done', 'Cancelled'); -- finished tasks are locked; they keep QA

-- 4. Archiving a step: its milestone link moves to the step before it --------------
create or replace function public.trg_r2_close_chain_on_archive() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if coalesce(old.is_archived, false) or not coalesce(new.is_archived, false) then return null; end if;
  if not exists (select 1 from projects where id = new.project_id and lifecycle_version = 2) then return null; end if;
  insert into task_dependencies (task_id, depends_on_task_id)
  select nxt.task_id, prv.depends_on_task_id
  from task_dependencies nxt
  join task_dependencies prv on prv.task_id = new.id
  join tasks t on t.id = nxt.task_id
  where nxt.depends_on_task_id = new.id and not coalesce(t.is_archived, false)
    and nxt.task_id <> prv.depends_on_task_id
  on conflict do nothing;
  insert into milestone_dependencies (milestone_id, task_id)
  select md.milestone_id, prv.depends_on_task_id
  from milestone_dependencies md
  join task_dependencies prv on prv.task_id = new.id
  join tasks pt on pt.id = prv.depends_on_task_id and not coalesce(pt.is_archived, false)
  where md.task_id = new.id
  on conflict do nothing;
  return null;
end;
$function$;
