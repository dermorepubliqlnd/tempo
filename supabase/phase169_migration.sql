-- phase169 (2026-10-07, Sandra): approve-by-exception ("auto-approvals").
-- PREVIEW-GATED: active only when app_settings.auto_approvals_live = true OR the
-- request carries the preview header (x-tempo-channel: preview) -- same pattern
-- as draft_privacy_enforced(). Go-live = set auto_approvals_live true.
--
-- 1. Manual time (project + non-project, not follow-up): auto-approved when
--    2 hrs or less, the work date is within 2 working days of today, no
--    overlap, and the person's auto-approved minutes that week stay <= 300.
--    Approver can reverse within 7 days (back to pending_approval).
-- 2. Task validation: Early (reported < due) -> approver validates.
--    On the due date -> auto-validated 2 working days after it was reported
--    unless the approver puts it on Hold. Late (reported > due) -> auto-
--    validated as soon as it is reported. Reversible within 7 days.
-- 3. Extensions (task due-date requests): auto-approved when the new date is
--    at most 2 working days after the current due date, it is the task's
--    first extension request, it is requested on/before the current due date,
--    and after the normal approval effect (incl. the dependent cascade) no
--    task in the project ends after the project end date. No undo.
-- Holidays = public.holidays (all categories) + weekends.

alter table public.app_settings add column if not exists auto_approvals_live boolean not null default false;

create or replace function public.auto_approvals_enabled() returns boolean
language sql stable set search_path = public as $$
  select coalesce((select auto_approvals_live from public.app_settings limit 1), false)
      or coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-tempo-channel', '') = 'preview'
$$;
grant execute on function public.auto_approvals_enabled() to authenticated;

-- working days in (p_from, p_to]  (0 when p_to <= p_from)
create or replace function public.working_days_after(p_from date, p_to date) returns int
language sql stable set search_path = public as $$
  select case when p_from is null or p_to is null or p_to <= p_from then 0 else (
    select count(*)::int from generate_series(p_from + 1, p_to, interval '1 day') g(d)
     where extract(isodow from g.d) < 6
       and not exists (select 1 from public.holidays h where h.date::date = g.d::date)
  ) end
$$;
grant execute on function public.working_days_after(date, date) to authenticated;

-- System-made decisions skip the routed-approver / authorization checks.
-- Only SECURITY DEFINER code in this file sets app.auto_approval (transaction-local).
create or replace function public.auto_approval_active() returns boolean
language sql stable as $$ select coalesce(current_setting('app.auto_approval', true), '') = 'on' $$;

-- ---------------------------------------------------------------- columns
alter table public.time_entries      add column if not exists auto_approved boolean not null default false;
alter table public.time_entries      add column if not exists auto_reversed_at timestamptz;
alter table public.time_entries      add column if not exists auto_reversed_by uuid references public.people(id);
alter table public.tasks             add column if not exists auto_validated boolean not null default false;
alter table public.tasks             add column if not exists validation_hold boolean not null default false;
alter table public.tasks             add column if not exists validation_hold_by uuid references public.people(id);
alter table public.tasks             add column if not exists validation_hold_at timestamptz;
alter table public.tasks             add column if not exists auto_validation_reversed_at timestamptz;
alter table public.tasks             add column if not exists auto_validation_reversal_note text;
alter table public.extension_requests add column if not exists auto_approved boolean not null default false;
alter table public.extension_requests add column if not exists auto_check_note text;

-- ================================================================ 1. TIME
create or replace function public.auto_approve_manual_time() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_min numeric;
  v_work date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_week date;
  v_used numeric;
begin
  if NEW.source <> 'manual' or NEW.status <> 'pending_approval' or coalesce(NEW.is_follow_up, false)
     or NEW.started_at is null or NEW.ended_at is null or not public.auto_approvals_enabled() then
    return NEW;
  end if;
  v_min  := extract(epoch from (NEW.ended_at - NEW.started_at)) / 60;
  v_work := (NEW.started_at at time zone 'Asia/Manila')::date;
  if v_min <= 0 or v_min > 120 or v_work > v_today or public.working_days_after(v_work, v_today) > 2 then
    return NEW;
  end if;
  if public.find_time_entry_overlap(NEW.person_id, NEW.started_at, NEW.ended_at, array[NEW.id]) is not null then
    return NEW;
  end if;
  v_week := date_trunc('week', v_work)::date;   -- Monday
  select coalesce(sum(extract(epoch from (te.ended_at - te.started_at)) / 60), 0) into v_used
    from time_entries te
   where te.person_id = NEW.person_id and te.auto_approved and not te.is_archived
     and (te.started_at at time zone 'Asia/Manila')::date between v_week and v_week + 6;
  if v_used + v_min > 300 then
    return NEW;
  end if;
  NEW.status := 'approved';
  NEW.auto_approved := true;
  NEW.decided_at := now();
  NEW.decided_by := null;
  NEW.decision_notes := 'Auto-approved: 2 hrs or less, logged within 2 working days';
  return NEW;
end;
$$;
drop trigger if exists zz_auto_approve_manual_time on public.time_entries;
create trigger zz_auto_approve_manual_time before insert on public.time_entries
  for each row execute function public.auto_approve_manual_time();

create or replace function public.reverse_auto_approved_time(p_entry_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  e record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into e from time_entries where id = p_entry_id;
  if not found then raise exception 'time entry not found'; end if;
  if not e.auto_approved or e.status <> 'approved' then raise exception 'this entry was not auto-approved'; end if;
  if e.decided_at < now() - interval '7 days' then raise exception 'auto-approvals can only be reversed within 7 days'; end if;
  if v_note is null then raise exception 'a reason is required to reverse an auto-approval'; end if;
  if not public.can_decide_time_entry(p_entry_id) then raise exception 'not authorized to reverse this entry'; end if;
  update time_entries set
    status = 'pending_approval',
    auto_approved = false,
    auto_reversed_at = now(),
    auto_reversed_by = my_person_id(),
    decided_at = null,
    decided_by = null,
    decision_notes = 'Auto-approval reversed: ' || v_note
  where id = p_entry_id;
end;
$$;
grant execute on function public.reverse_auto_approved_time(uuid, text) to authenticated;

-- ========================================================== 2. VALIDATION
-- Late completion -> validated on report (BEFORE UPDATE, runs after the other
-- BEFORE triggers alphabetically so their checks see the user's own change).
create or replace function public.auto_validate_late_completion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.status = 'Done' and NEW.actual_completion_date is not null and NEW.validated_completion_date is null
     and NEW.current_due_date is not null
     and (OLD.status is distinct from 'Done' or OLD.actual_completion_date is distinct from NEW.actual_completion_date) then
    NEW.validation_hold := false;                      -- a fresh report clears any old hold
    if NEW.actual_completion_date::date > NEW.current_due_date::date
       and public.auto_approvals_enabled()
       and not exists (select 1 from tasks c where c.parent_task_id = NEW.id and not c.is_archived)
       and coalesce((select wbs_status from projects where id = NEW.project_id), '') <> 'closed' then
      NEW.validated_completion_date := NEW.actual_completion_date::timestamptz;
      NEW.validated_by := null;
      NEW.validation_performed_at := now();
      NEW.validated_locked_at := now();
      NEW.validated_locked_by := null;
      NEW.completion_adjustment_reason := null;
      NEW.auto_validated := true;
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists zz_auto_validate_late_completion on public.tasks;
create trigger zz_auto_validate_late_completion before update on public.tasks
  for each row execute function public.auto_validate_late_completion();

-- On-the-due-date (and any late leftovers) -> validated once 2 working days have
-- passed since it was reported, unless on hold. Early completions never.
-- p_project_id null = the scheduled org-wide run (only when the live flag is on);
-- a project id = preview test for one project (Full Access or the owner), with
-- p_ignore_wait to skip the 2-day wait.
create or replace function public.run_auto_validations(p_project_id uuid default null, p_ignore_wait boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_n int;
begin
  if p_project_id is null then
    if not coalesce((select auto_approvals_live from app_settings limit 1), false) then return 0; end if;
  else
    if not public.auto_approvals_enabled() then raise exception 'auto-approvals are not switched on here'; end if;
    if not (my_access_level() = 'full' or exists (select 1 from projects where id = p_project_id and owner_id = my_person_id())) then
      raise exception 'only Full Access or the project owner can run this';
    end if;
  end if;
  perform set_config('app.auto_approval', 'on', true);
  perform set_config('app.bypass_validation_rpc', 'on', true);
  update tasks t set
    validated_completion_date = t.actual_completion_date::timestamptz,
    validated_by = null,
    validation_performed_at = now(),
    validated_locked_at = now(),
    validated_locked_by = null,
    completion_adjustment_reason = null,
    auto_validated = true
  where t.status = 'Done'
    and not t.is_archived
    and t.validated_completion_date is null
    and t.actual_completion_date is not null
    and t.current_due_date is not null
    and not t.validation_hold
    and t.actual_completion_date::date >= t.current_due_date::date
    and (p_project_id is null or t.project_id = p_project_id)
    and not exists (select 1 from tasks c where c.parent_task_id = t.id and not c.is_archived)
    and exists (select 1 from projects p where p.id = t.project_id and coalesce(p.wbs_status, '') <> 'closed')
    and (
      t.actual_completion_date::date > t.current_due_date::date
      or (p_project_id is not null and p_ignore_wait)
      or public.working_days_after(coalesce((t.submitted_on at time zone 'Asia/Manila')::date, t.actual_completion_date::date), v_today) >= 2
    );
  get diagnostics v_n = row_count;
  perform set_config('app.auto_approval', 'off', true);
  return v_n;
end;
$$;
grant execute on function public.run_auto_validations(uuid, boolean) to authenticated;

create or replace function public.set_validation_hold(p_task_id uuid, p_hold boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_assignee uuid;
begin
  select assignee_id into v_assignee from tasks where id = p_task_id;
  if not found then raise exception 'task not found'; end if;
  if not (can_full_access_approve(v_assignee) or (v_assignee is not null and is_approver_for(v_assignee))) then
    raise exception 'only the assignee''s approver can hold this validation';
  end if;
  update tasks set validation_hold = coalesce(p_hold, false),
                   validation_hold_by = case when p_hold then my_person_id() end,
                   validation_hold_at = case when p_hold then now() end
   where id = p_task_id;
end;
$$;
grant execute on function public.set_validation_hold(uuid, boolean) to authenticated;

create or replace function public.reverse_auto_validation(p_task_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into t from tasks where id = p_task_id;
  if not found then raise exception 'task not found'; end if;
  if not t.auto_validated or t.validated_completion_date is null then raise exception 'this task was not auto-validated'; end if;
  if t.validation_performed_at < now() - interval '7 days' then raise exception 'auto-validations can only be reversed within 7 days'; end if;
  if v_note is null then raise exception 'a reason is required to reverse an auto-validation'; end if;
  if not (can_full_access_approve(t.assignee_id) or (t.assignee_id is not null and is_approver_for(t.assignee_id))) then
    raise exception 'not authorized to reverse this validation';
  end if;
  perform set_config('app.bypass_validation_rpc', 'on', true);
  update tasks set                                   -- status stays Done
    validated_completion_date = null,
    validated_by = null,
    validation_performed_at = null,
    validated_locked_at = null,
    validated_locked_by = null,
    completion_adjustment_reason = null,
    auto_validated = false,
    auto_validation_reversed_at = now(),
    auto_validation_reversal_note = v_note,
    validation_hold = true,                          -- waits for a manual decision
    validation_hold_by = my_person_id(),
    validation_hold_at = now()
  where id = p_task_id;
end;
$$;
grant execute on function public.reverse_auto_validation(uuid, text) to authenticated;

-- ========================================================== 3. EXTENSIONS
-- Runs AFTER INSERT. Uses the normal decide_extension_request() so the effect
-- (due date, audit, dependent cascade) is identical to a manual approval; the
-- whole attempt sits in a sub-transaction and is undone (request stays Pending,
-- with the reason in auto_check_note) when any rule fails.
create or replace function public.auto_approve_extension() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_end date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_wd int;
  v_note text := null;
begin
  if NEW.task_id is null or NEW.status <> 'Pending' or coalesce(NEW.is_manager_initiated, false)
     or coalesce(NEW.request_type, 'due_date') <> 'due_date' or not public.auto_approvals_enabled() then
    return null;
  end if;
  select tk.id, tk.project_id, tk.current_due_date::date as due into t from tasks tk where tk.id = NEW.task_id;
  select end_date::date into v_end from projects where id = t.project_id;
  v_wd := public.working_days_after(t.due, NEW.requested_new_due_date::date);

  if t.due is null or NEW.requested_new_due_date::date <= t.due then
    v_note := 'the new date is not later than the current due date';
  elsif v_wd > 2 then
    v_note := v_wd || ' working days (auto-approval is for 2 or less)';
  elsif exists (select 1 from extension_requests er where er.task_id = NEW.task_id and er.id <> NEW.id) then
    v_note := 'not the first extension on this task';
  elsif v_today > t.due then
    v_note := 'requested after the due date had passed';
  end if;

  if v_note is null then
    begin
      perform set_config('app.auto_approval', 'on', true);
      perform public.decide_extension_request(NEW.id, 'Approved',
        'Auto-approved: ' || v_wd || ' working day' || case when v_wd = 1 then '' else 's' end ||
        ' (' || to_char(t.due, 'Mon DD') || ' -> ' || to_char(NEW.requested_new_due_date::date, 'Mon DD') || ')');
      if v_end is not null and exists (
           select 1 from tasks x
            where x.project_id = t.project_id and not x.is_archived
              and coalesce(x.status, '') <> 'Cancelled'
              and x.current_due_date::date > v_end) then
        raise exception using errcode = 'P0169', message = 'past project end';
      end if;
      update extension_requests set auto_approved = true, decided_by = null where id = NEW.id;
      perform set_config('app.auto_approval', 'off', true);
      return null;
    exception
      when sqlstate 'P0169' then
        v_note := 'it would push a task past the project end date (' || to_char(v_end, 'Mon DD') || ')';
      when others then
        v_note := 'could not be auto-checked (' || left(sqlerrm, 120) || ')';
    end;
  end if;
  update extension_requests set auto_check_note = v_note where id = NEW.id;
  return null;
end;
$$;
drop trigger if exists zz_auto_approve_extension on public.extension_requests;
create trigger zz_auto_approve_extension after insert on public.extension_requests
  for each row execute function public.auto_approve_extension();
