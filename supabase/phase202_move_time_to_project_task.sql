-- phase202 (2026-10-20, Sandra): "Move to project task" correction.
--
-- Someone logged time as NON-PROJECT (e.g. Admin, Meeting) that was really
-- work on a project task. Until now a correction could only change the time
-- window (or the activity type), so the fix was archive + re-log, losing the
-- trail. This lets the SAME entry move from non-project to a project task.
--
-- Who:
--   - Full Access corrects directly (Time Tracking -> Correct), no approval.
--   - The person who logged it requests it (Time Tracking -> Request
--     correction); it is decided in Approval Center -> Time Corrections by
--     the usual deciders (their approver up the reporting line, or Full
--     Access -- can_decide_time_entry_correction, unchanged).
--
-- Rules for the target task (checked on request AND again on approval):
--   - assigned to the person who logged the time
--   - not archived, not Cancelled, not a parent task (log on its sub-tasks)
--   - project Active or Closing, baseline locked (same as logging new time);
--     Paused projects are blocked by the existing time_entries_block_paused
--     trigger
--   - a Done task is fine: the moved time is tagged as follow-up time
-- The time window may be corrected in the same request (all the usual
-- future / overlap / 12h checks apply). Only non-project -> project task;
-- project-to-project moves are not part of this.
--
-- Audit: the entry keeps its history -- moved_from_activity_type_id,
-- moved_at, moved_by, and correction_notes "Moved from Non-project · Admin
-- to T-0456 ...". Nothing is archived or double-counted.
--
-- Run once in Supabase SQL editor. Safe to re-run.

-- NO foreign keys on these (phase202b hotfix, 2026-10-21): a second FK from
-- time_entries to non_project_activity_types made the app's PostgREST embeds
-- ambiguous and Time Tracking showed no entries. Integrity is checked in the
-- functions below instead.
alter table public.time_entries add column if not exists moved_from_activity_type_id uuid;
alter table public.time_entries add column if not exists moved_at timestamptz;
alter table public.time_entries add column if not exists moved_by uuid;
alter table public.time_entry_correction_requests add column if not exists proposed_task_id uuid;
alter table public.time_entries drop constraint if exists time_entries_moved_from_activity_type_id_fkey;
alter table public.time_entries drop constraint if exists time_entries_moved_by_fkey;
alter table public.time_entry_correction_requests drop constraint if exists time_entry_correction_requests_proposed_task_id_fkey;

-- ---------------------------------------------------------------------
-- Why a task can't take a person's moved time (null = OK).
create or replace function public.time_move_target_error(p_person_id uuid, p_task_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_task tasks%rowtype;
  v_proj projects%rowtype;
  v_stage text;
begin
  select * into v_task from tasks where id = p_task_id;
  if v_task.id is null or coalesce(v_task.is_archived, false) then
    return 'that task was not found';
  end if;
  if coalesce(v_task.status, '') = 'Cancelled' then
    return 'that task is Cancelled -- pick another task';
  end if;
  if v_task.assignee_id is distinct from p_person_id then
    return 'time can only move to a task assigned to the person who logged it';
  end if;
  if exists (select 1 from tasks c where c.parent_task_id = v_task.id and not coalesce(c.is_archived, false)) then
    return 'that task has sub-tasks -- pick the sub-task the work was for';
  end if;
  select * into v_proj from projects where id = v_task.project_id;
  if v_proj.id is null or coalesce(v_proj.is_archived, false) then
    return 'that task''s project was not found';
  end if;
  v_stage := coalesce(v_proj.stage, public.project_stage_of(v_proj.status, v_proj.wbs_status, v_proj.id));
  if v_stage not in ('Active', 'Closing') then
    return format('that project is %s -- time can only move to an Active or Closing project', v_stage);
  end if;
  if not coalesce(v_proj.timelines_locked, false) then
    return 'that project''s baseline isn''t locked yet, so it can''t take logged time';
  end if;
  return null;
end;
$$;
grant execute on function public.time_move_target_error(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Internal: move a finalized non-project entry onto a project task.
-- No authorization here (callers check). Not granted to authenticated.
create or replace function public.apply_time_entry_move(
  p_entry_id uuid,
  p_task_id uuid,
  p_notes text,
  p_requested_by uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry time_entries%rowtype;
  v_err text;
  v_task tasks%rowtype;
  v_from text;
begin
  select * into v_entry from time_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'time entry not found';
  end if;
  if v_entry.task_id is not null then
    raise exception 'this entry is already on a project task -- only non-project time can be moved';
  end if;
  if v_entry.status not in ('confirmed', 'approved') or v_entry.is_archived then
    raise exception 'only a confirmed or approved entry can be moved';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'a reason is required';
  end if;
  v_err := public.time_move_target_error(v_entry.person_id, p_task_id);
  if v_err is not null then
    raise exception '%', v_err;
  end if;
  select * into v_task from tasks where id = p_task_id;
  select 'Non-project · ' || coalesce(name, 'activity') into v_from from non_project_activity_types where id = v_entry.activity_type_id;

  perform set_config('app.bypass_time_entry_lock', 'on', true);
  update time_entries
     set task_id = p_task_id,
         activity_type_id = null,
         moved_from_activity_type_id = coalesce(moved_from_activity_type_id, v_entry.activity_type_id),
         moved_at = now(),
         moved_by = my_person_id(),
         is_follow_up = case when coalesce(v_task.status, '') = 'Done' then true else is_follow_up end,
         corrected_by = my_person_id(),
         corrected_at = now(),
         correction_requested_by = p_requested_by,
         correction_notes = 'Moved from ' || coalesce(v_from, 'Non-project') || ' to T-' || lpad(v_task.task_number::text, 4, '0')
                            || ' ' || v_task.name || ': ' || trim(p_notes)
   where id = p_entry_id;
end;
$$;
revoke all on function public.apply_time_entry_move(uuid, uuid, text, uuid) from public;
revoke execute on function public.apply_time_entry_move(uuid, uuid, text, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------
-- Full Access: move (and optionally re-time) directly, in one step.
create or replace function public.correct_time_entry_to_task(
  p_entry_id uuid,
  p_task_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_notes text,
  p_trim_entry_ids uuid[] default '{}'
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_entry time_entries%rowtype;
begin
  if my_access_level() <> 'full' then
    raise exception 'only Full Access can correct a finalized time entry -- request a correction instead';
  end if;
  select * into v_entry from time_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'time entry not found';
  end if;
  if p_started_at is distinct from v_entry.started_at or p_ended_at is distinct from v_entry.ended_at then
    perform apply_time_entry_correction(p_entry_id, p_started_at, p_ended_at, p_notes, null, null, p_trim_entry_ids, null);
  end if;
  perform apply_time_entry_move(p_entry_id, p_task_id, p_notes, null);
end;
$$;
grant execute on function public.correct_time_entry_to_task(uuid, uuid, timestamptz, timestamptz, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Request: same as phase102, plus an optional target task (non-project
-- entries only). Old 5-argument version dropped so PostgREST has one match.
drop function if exists public.request_time_entry_correction(uuid, timestamptz, timestamptz, text, uuid);

create or replace function public.request_time_entry_correction(
  p_entry_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text,
  p_activity_type_id uuid default null,
  p_task_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry time_entries%rowtype;
  v_conflict uuid;
  v_day date;
  v_other numeric;
  v_new numeric;
  v_id uuid;
  v_err text;
begin
  select * into v_entry from time_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'time entry not found';
  end if;
  if v_entry.person_id <> my_person_id() then
    raise exception 'you can only request a correction on your own time entry';
  end if;
  if v_entry.status not in ('confirmed','approved') or v_entry.is_archived then
    raise exception 'only a confirmed or approved entry can have a correction requested -- pending entries can be edited directly';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'please give a reason for the correction';
  end if;
  if exists (select 1 from time_entry_correction_requests where entry_id = p_entry_id and status = 'pending') then
    raise exception 'there is already a pending correction request for this entry';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'end time must be after start time';
  end if;
  if p_ended_at > now() or p_started_at > now() then
    raise exception 'Future time entry not allowed -- time entries can only cover time that has already passed';
  end if;
  if p_task_id is not null then
    if v_entry.task_id is not null then
      raise exception 'only non-project time can be moved to a project task';
    end if;
    v_err := public.time_move_target_error(v_entry.person_id, p_task_id);
    if v_err is not null then
      raise exception '%', v_err;
    end if;
    p_activity_type_id := null;
  end if;
  if p_task_id is null and p_started_at = v_entry.started_at and p_ended_at = v_entry.ended_at
     and (p_activity_type_id is null or p_activity_type_id = v_entry.activity_type_id) then
    raise exception 'nothing to correct -- the proposed times match the current entry';
  end if;
  if v_entry.task_id is not null then
    p_activity_type_id := null;
  elsif p_activity_type_id is not null and not exists (select 1 from non_project_activity_types where id = p_activity_type_id) then
    raise exception 'unknown activity type';
  end if;

  v_conflict := find_time_entry_overlap(v_entry.person_id, p_started_at, p_ended_at, array[p_entry_id]);
  if v_conflict is not null then
    raise exception 'Time overlap detected with % -- adjust the proposed start/end time', time_entry_label(v_conflict);
  end if;

  v_day := (p_started_at at time zone 'Asia/Manila')::date;
  select coalesce(sum(duration_minutes), 0) into v_other
    from time_entries
   where person_id = v_entry.person_id and id <> p_entry_id
     and status not in ('running','rejected')
     and (started_at at time zone 'Asia/Manila')::date = v_day;
  v_new := greatest(1, round(extract(epoch from (p_ended_at - p_started_at)) / 60.0));
  if v_other + v_new > 720 then
    raise exception 'this would bring logged hours for % to %h, over the 12-hour daily limit',
      to_char(v_day, 'Mon DD, YYYY'), round((v_other + v_new) / 60.0, 2);
  end if;

  insert into time_entry_correction_requests
    (entry_id, requested_by, current_started_at, current_ended_at, proposed_started_at, proposed_ended_at, proposed_activity_type_id, proposed_task_id, reason)
  values
    (p_entry_id, my_person_id(), v_entry.started_at, v_entry.ended_at, p_started_at, p_ended_at, p_activity_type_id, p_task_id, trim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.request_time_entry_correction(uuid, timestamptz, timestamptz, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Decide: same as phase102; an approved request with a target task also
-- moves the entry (target re-checked now -- it may have changed).
create or replace function public.decide_time_entry_correction(
  p_request_id uuid,
  p_decision text,
  p_notes text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req time_entry_correction_requests%rowtype;
  v_entry time_entries%rowtype;
  v_note text;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'invalid decision: %', p_decision;
  end if;
  select * into v_req from time_entry_correction_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'correction request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'this correction request has already been decided';
  end if;
  if not can_decide_time_entry_correction(p_request_id) then
    raise exception 'not authorized to decide this correction request';
  end if;
  if p_decision = 'rejected' and coalesce(trim(p_notes), '') = '' then
    raise exception 'a note is required when rejecting';
  end if;

  if p_decision = 'approved' then
    select * into v_entry from time_entries where id = v_req.entry_id;
    if v_entry.started_at <> v_req.current_started_at or v_entry.ended_at <> v_req.current_ended_at then
      raise exception 'this entry changed after the request was made -- reject it and ask for a fresh request';
    end if;
    v_note := v_req.reason || coalesce(' (approved: ' || nullif(trim(p_notes), '') || ')', '');
    if v_req.proposed_task_id is null
       or v_req.proposed_started_at <> v_entry.started_at or v_req.proposed_ended_at <> v_entry.ended_at then
      perform apply_time_entry_correction(
        v_req.entry_id, v_req.proposed_started_at, v_req.proposed_ended_at,
        v_note, null, v_req.proposed_activity_type_id, '{}', v_req.requested_by);
    end if;
    if v_req.proposed_task_id is not null then
      perform apply_time_entry_move(v_req.entry_id, v_req.proposed_task_id, v_note, v_req.requested_by);
    end if;
  end if;

  update time_entry_correction_requests
     set status = p_decision, decided_by = my_person_id(), decided_at = now(), decision_notes = nullif(trim(p_notes), '')
   where id = p_request_id;
end;
$$;
grant execute on function public.decide_time_entry_correction(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
