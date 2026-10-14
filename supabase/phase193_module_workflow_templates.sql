-- phase193 (2026-10-14, Sandra): one flexible module workflow + delivery and
-- evaluation templates for new-lifecycle projects (lifecycle_version = 2).
--   1. Templates 'delivery' and 'evaluation': every activity from the modality
--      breakdowns, in order; the owner deletes what a project doesn't need.
--   2. r2_add_module: stamps one module's Design -> Review -> Sign-off ->
--      Build -> Review -> Sign-off chain (no checkboxes; delete any step).
--   3. Deleting (archiving) a step closes the chain: what waited on it now
--      waits on what it waited on.
-- Additive. Older projects are untouched.

-- 1. Delivery and evaluation templates ---------------------------------------
insert into public.task_templates (template_key, template_name, phase_key, ref, parent_ref, sort_order, name, work_type_name, output_type_name, estimated_hours, depends_on_refs) values
  ('delivery', 'Implementation / Delivery', 'delivery', 'D1',  null,  10, 'Train-the-trainer / facilitator walkthrough', null, 'No Deliverable/Activity Only', 2, '{}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D2',  null,  20, 'Manager and buddy briefing', null, 'No Deliverable/Activity Only', 1, '{D1}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D3',  null,  30, 'Pilot or dry run with target learners', null, 'No Deliverable/Activity Only', 3, '{D2}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D4',  null,  40, 'Pilot fixes', null, null, 4, '{D3}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D5',  null,  50, 'Upload to LMS (Litmos): learning path, enrolment, assignment rules, due dates', null, 'No Deliverable/Activity Only', 2, '{D4}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D6',  null,  60, 'Schedule batches or classes with supervisors', null, 'No Deliverable/Activity Only', 1, '{D5}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D7',  null,  70, 'Launch comms to learners and supervisors', null, 'No Deliverable/Activity Only', 1, '{D6}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D8',  null,  80, 'Reminders and escalation for overdue learners', null, 'No Deliverable/Activity Only', 1, '{D7}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D9',  null,  90, 'Monitor completion (first 2 weeks)', null, 'No Deliverable/Activity Only', 2, '{D8}'),
  ('delivery', 'Implementation / Delivery', 'delivery', 'D10', null, 100, 'Hand over to Training Delivery / Ongoing container', null, 'No Deliverable/Activity Only', 0.5, '{D9}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E1', null,  10, 'L1 reaction survey summary', null, 'No Deliverable/Activity Only', 1, '{}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E2', null,  20, 'L2 assessment / knowledge check results', null, 'No Deliverable/Activity Only', 1, '{E1}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E3', null,  30, 'L3 on-the-job check with supervisors (30 days)', null, 'No Deliverable/Activity Only', 2, '{E2}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E4', null,  40, 'Time-to-competency check (30-60-90 sign-offs)', null, 'No Deliverable/Activity Only', 2, '{E3}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E5', null,  50, 'L4 check: related KPIs, deviations or NCR trend with Quality', null, 'No Deliverable/Activity Only', 2, '{E4}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E6', null,  60, 'Audit-ready completion record export', null, 'No Deliverable/Activity Only', 0.5, '{E5}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E7', null,  70, 'Recertification schedule set in Litmos', null, 'No Deliverable/Activity Only', 0.5, '{E6}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E8', null,  80, 'Evaluation report', null, null, 4, '{E7}'),
  ('evaluation', 'Evaluation & Closure', 'evaluation', 'E9', null,  90, 'Lessons learned and close-out', null, 'No Deliverable/Activity Only', 1, '{E8}')
on conflict (template_key, ref) do nothing;

-- 2. Add module -------------------------------------------------------------
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
                       output_type_id, output_count, wbs_phase, sort_order, created_by)
    values (p_project_id, s.name, s.assignee, 'Not Started',
            v_start, v_start, v_start, true, true,
            v_due, v_due, s.hours,
            case when s.is_check then v_noout end, case when s.is_check then 0 end,
            s.phase_key, v_base + s.n, my_person_id())
    returning id into v_id;
    if i > 0 then
      insert into task_dependencies (task_id, depends_on_task_id) values (v_id, v_ids[i]) on conflict do nothing;
    end if;
    v_ids := v_ids || v_id;
    i := i + 1;
  end loop;
  return 6;
end;
$$;
grant execute on function public.r2_add_module(uuid, text, uuid) to authenticated;

-- 3. Deleting a step closes the chain (new-lifecycle projects) -------------
create or replace function public.trg_r2_close_chain_on_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.is_archived, false) or not coalesce(new.is_archived, false) then return null; end if;
  if not exists (select 1 from projects where id = new.project_id and lifecycle_version = 2) then return null; end if;
  insert into task_dependencies (task_id, depends_on_task_id)
  select nxt.task_id, prv.depends_on_task_id
  from task_dependencies nxt
  join task_dependencies prv on prv.task_id = new.id
  join tasks t on t.id = nxt.task_id
  where nxt.depends_on_task_id = new.id
    and not coalesce(t.is_archived, false)
    and nxt.task_id <> prv.depends_on_task_id
  on conflict do nothing;
  return null;
end;
$$;
drop trigger if exists trg_r2_close_chain_on_archive on public.tasks;
create trigger trg_r2_close_chain_on_archive after update of is_archived on public.tasks
  for each row execute function public.trg_r2_close_chain_on_archive();
