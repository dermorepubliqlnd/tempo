-- phase161 (2026-10-07, Sandra): "Ongoing container" switch per PROJECT.
-- A normal project (e.g. BAU "Content Revisions – Q4 2026") can be marked an
-- ongoing container: project Health / WBS Status show "Ongoing" (no baseline
-- variance, out of health charts) while its TASKS keep full due-date rules:
-- Due soon / Overdue / At Risk, and date moves need an extension request.
-- Session behaviour (Add Session, reschedule without approval) stays a
-- Project Type feature: project_types.uses_sessions (Training Delivery).

alter table public.projects add column if not exists is_ongoing_container boolean not null default false;
alter table public.project_types add column if not exists uses_sessions boolean not null default false;
update public.project_types set uses_sessions = true where name = 'Training Delivery';

create or replace function public.sync_project_is_operational() returns trigger
language plpgsql as $$
begin
  NEW.is_operational := coalesce((select pt.is_operational from public.project_types pt where pt.id = NEW.project_type_id), false)
                        or coalesce(NEW.is_ongoing_container, false);
  return NEW;
end $$;

-- Sessions only on session-based project types.
create or replace function public.reschedule_session_range(p_task_id uuid, p_start_date date, p_end_date date)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.my_person_id();
  v_t public.tasks%rowtype;
  v_p public.projects%rowtype;
begin
  select * into v_t from public.tasks where id = p_task_id and not is_archived;
  if v_t.id is null then raise exception 'Task not found.'; end if;
  select * into v_p from public.projects where id = v_t.project_id;
  if not coalesce((select uses_sessions from public.project_types where id = v_p.project_type_id), false) then
    raise exception 'Only training sessions can be rescheduled this way -- request an extension instead.';
  end if;
  if v_p.wbs_status = 'closed' then raise exception 'This project is closed.'; end if;
  if v_t.status in ('Done', 'Cancelled') then raise exception 'Done or cancelled sessions can''t be rescheduled.'; end if;
  if exists (select 1 from public.tasks c where c.parent_task_id = v_t.id and not c.is_archived) then
    raise exception 'Reschedule the individual sessions under this task instead.';
  end if;
  if not (coalesce(public.my_access_level() = 'full', false) or v_p.owner_id = v_me or v_t.assignee_id = v_me) then
    raise exception 'Only the assignee, the project owner or Full Access can reschedule this session.';
  end if;
  if p_start_date is null or p_end_date is null then raise exception 'Start and end dates are required.'; end if;
  if p_end_date < p_start_date then raise exception 'The end date can''t be earlier than the start date.'; end if;

  perform set_config('app.bypass_due_date_lock', 'on', true);
  perform set_config('app.bypass_start_date_lock', 'on', true);
  update public.tasks set
    start_date = p_start_date, start_date_full = p_start_date, start_date_standard = p_start_date,
    start_full_auto = false, start_standard_auto = false, manual_end_date = p_end_date,
    original_due_date = p_end_date, current_due_date = p_end_date
  where id = p_task_id;
  perform set_config('app.bypass_due_date_lock', 'off', true);
  perform set_config('app.bypass_start_date_lock', 'off', true);
end $$;
grant execute on function public.reschedule_session_range(uuid, date, date) to authenticated;

create or replace function public.reschedule_session(p_task_id uuid, p_date date)
returns void language sql security definer set search_path = public as $$
  select public.reschedule_session_range(p_task_id, p_date, p_date)
$$;
grant execute on function public.reschedule_session(uuid, date) to authenticated;

select 'phase161' t,
  (select string_agg(name, ', ') from public.project_types where uses_sessions) session_types,
  (select count(*) from public.projects where is_ongoing_container) containers;
