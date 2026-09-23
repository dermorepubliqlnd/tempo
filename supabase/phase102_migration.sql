-- Phase 102 (2026-09-23): Time corrections rework.
--
-- Sandra: "time correction only allows admin to add or subtract
-- duration. Is this the correct route or should we update start and end
-- time? What if the time will be extended but there is already a logged
-- time existing -- this will contradict and be flagged as overlap."
--
-- Phase 1 -- corrections now change START/END, never a bare duration.
--   duration_minutes is always derived from ended_at - started_at, so
--   the overlap check (which reads timestamps) and every hours rollup
--   (which reads duration) can never disagree again. The same rules as
--   a fresh entry apply: end after start, nothing in the future, no
--   overlap with another pending/finalized entry of the same person,
--   12-hour daily cap (existing time_entries_daily_cap trigger, not
--   bypassed). Correction notes are now REQUIRED.
--   Overlap resolution: the corrector may pass p_trim_entry_ids -- other
--   confirmed/approved entries of the same person that the corrected
--   interval runs into. Each is trimmed at the edge it overlaps (its end
--   pulled back, or its start pushed forward), and gets its own
--   correction trail. An entry fully inside the new interval, or one
--   that fully surrounds it, can't be trimmed (would vanish / would need
--   splitting) -- the corrector is told to archive or adjust it first.
--   Original start/end are kept (original_started_at/original_ended_at),
--   first-correction-wins, same as original_duration_minutes.
--
-- Phase 2 -- employee correction REQUESTS on their own finalized entries.
--   time_entry_correction_requests: proposed start/end (+ activity type
--   for non-project), required reason. One pending request per entry.
--   Validated up front (future/overlap/12h) and again at approval time.
--   Decider: Full Access, or the project owner (project entry, owner is
--   not the requester), or the requester's nearest active manager.
--   Nobody decides their own request (except the existing top-of-chain
--   self-exemption). Approving applies the change through the same
--   internal apply function as a Full Access correction.

alter table time_entries add column if not exists original_started_at timestamptz;
alter table time_entries add column if not exists original_ended_at timestamptz;
alter table time_entries add column if not exists correction_requested_by uuid references people(id);

-- ---------------------------------------------------------------------
-- Shared: first overlapping pending/finalized entry for a person.
-- Mirrors TimeTracking.tsx findOverlappingEntry (running + rejected +
-- archived rows are not claims on the time).
create or replace function find_time_entry_overlap(
  p_person_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_exclude_ids uuid[] default '{}'
) returns uuid
language sql stable security definer as $$
  select te.id
    from time_entries te
   where te.person_id = p_person_id
     and not (te.id = any(coalesce(p_exclude_ids, '{}')))
     and te.is_archived = false
     and te.status in ('pending_confirm','pending_approval','confirmed','approved')
     and p_started_at < coalesce(te.ended_at, now())
     and te.started_at < p_ended_at
   order by te.started_at
   limit 1
$$;

grant execute on function find_time_entry_overlap(uuid, timestamptz, timestamptz, uuid[]) to authenticated;

create or replace function time_entry_label(p_entry_id uuid) returns text
language sql stable security definer as $$
  select coalesce(
           'T-' || lpad(t.task_number::text, 4, '0'),
           'NP-' || lpad(te.non_project_entry_number::text, 4, '0'),
           'entry'
         )
         || ' (' || to_char(te.started_at at time zone 'Asia/Manila', 'Mon DD HH12:MI AM')
         || ' - ' || coalesce(to_char(te.ended_at at time zone 'Asia/Manila', 'HH12:MI AM'), 'running') || ')'
    from time_entries te
    left join tasks t on t.id = te.task_id
   where te.id = p_entry_id
$$;

-- ---------------------------------------------------------------------
-- Internal: apply a start/end correction. No authorization here -- the
-- two public callers (correct_time_entry, decide_time_entry_correction)
-- each check their own. Not granted to authenticated.
create or replace function apply_time_entry_correction(
  p_entry_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_notes text,
  p_reason_category text,
  p_activity_type_id uuid,
  p_trim_entry_ids uuid[],
  p_requested_by uuid
) returns void
language plpgsql security definer as $$
declare
  v_entry time_entries%rowtype;
  v_other time_entries%rowtype;
  v_trim_id uuid;
  v_conflict uuid;
  v_new_s timestamptz;
  v_new_e timestamptz;
  v_label text;
begin
  select * into v_entry from time_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'time entry not found';
  end if;
  if v_entry.status not in ('confirmed','approved') then
    raise exception 'only a confirmed or approved time entry can be corrected';
  end if;
  if v_entry.is_archived then
    raise exception 'restore this entry before correcting it';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'end time must be after start time';
  end if;
  if p_ended_at > now() or p_started_at > now() then
    raise exception 'Future time entry not allowed -- time entries can only cover time that has already passed';
  end if;
  if coalesce(trim(p_notes), '') = '' then
    raise exception 'a correction reason is required';
  end if;
  if v_entry.task_id is null and p_activity_type_id is not null
     and not exists (select 1 from non_project_activity_types where id = p_activity_type_id) then
    raise exception 'unknown activity type';
  end if;

  perform set_config('app.bypass_time_entry_lock', 'on', true);
  v_label := time_entry_label(p_entry_id);

  -- 1. Trim the entries the corrector chose to shorten (before the main
  --    update, so the daily-cap trigger sees the reduced total).
  foreach v_trim_id in array coalesce(p_trim_entry_ids, '{}') loop
    select * into v_other from time_entries where id = v_trim_id for update;
    if v_other.id is null or v_other.id = p_entry_id then
      continue;
    end if;
    if v_other.person_id <> v_entry.person_id then
      raise exception 'can only trim entries belonging to the same person';
    end if;
    if v_other.is_archived or v_other.status not in ('confirmed','approved') then
      raise exception '% is not a finalized entry, so it can''t be trimmed here -- ask the owner to edit it', time_entry_label(v_trim_id);
    end if;
    if not (p_started_at < v_other.ended_at and v_other.started_at < p_ended_at) then
      continue; -- no longer overlaps, nothing to trim
    end if;
    if v_other.started_at >= p_started_at and v_other.ended_at <= p_ended_at then
      raise exception '% sits entirely inside the corrected time -- archive it or adjust it first', time_entry_label(v_trim_id);
    end if;
    if v_other.started_at < p_started_at and v_other.ended_at > p_ended_at then
      raise exception '% fully surrounds the corrected time -- trimming would split it; adjust it first', time_entry_label(v_trim_id);
    end if;
    if v_other.started_at < p_started_at then
      v_new_s := v_other.started_at; v_new_e := p_started_at;   -- pull its end back
    else
      v_new_s := p_ended_at;        v_new_e := v_other.ended_at; -- push its start forward
    end if;
    update time_entries
       set original_started_at = coalesce(original_started_at, started_at),
           original_ended_at = coalesce(original_ended_at, ended_at),
           original_duration_minutes = coalesce(original_duration_minutes, duration_minutes),
           started_at = v_new_s,
           ended_at = v_new_e,
           duration_minutes = greatest(1, round(extract(epoch from (v_new_e - v_new_s)) / 60.0)),
           corrected_by = my_person_id(),
           corrected_at = now(),
           correction_requested_by = p_requested_by,
           correction_notes = 'Trimmed to fit correction of ' || v_label || ': ' || trim(p_notes)
     where id = v_trim_id;
  end loop;

  -- 2. Anything still overlapping blocks the correction.
  v_conflict := find_time_entry_overlap(v_entry.person_id, p_started_at, p_ended_at, array[p_entry_id]);
  if v_conflict is not null then
    raise exception 'Time overlap detected with % -- adjust the start/end time or trim that entry', time_entry_label(v_conflict);
  end if;

  -- 3. Apply. Duration is always derived.
  update time_entries
     set original_started_at = coalesce(original_started_at, started_at),
         original_ended_at = coalesce(original_ended_at, ended_at),
         original_duration_minutes = coalesce(original_duration_minutes, duration_minutes),
         started_at = p_started_at,
         ended_at = p_ended_at,
         duration_minutes = greatest(1, round(extract(epoch from (p_ended_at - p_started_at)) / 60.0)),
         corrected_by = my_person_id(),
         corrected_at = now(),
         correction_requested_by = p_requested_by,
         correction_notes = trim(p_notes),
         reason_category = case when task_id is not null then coalesce(p_reason_category, reason_category) else reason_category end,
         activity_type_id = case when task_id is null then coalesce(p_activity_type_id, activity_type_id) else activity_type_id end
   where id = p_entry_id;
end;
$$;

revoke all on function apply_time_entry_correction(uuid, timestamptz, timestamptz, text, text, uuid, uuid[], uuid) from public;
-- Supabase's default privileges grant EXECUTE on new public-schema
-- functions to anon/authenticated directly, so revoking from PUBLIC alone
-- isn't enough -- without this, anyone could call the internal apply
-- function and skip the authorization in its two callers.
revoke execute on function apply_time_entry_correction(uuid, timestamptz, timestamptz, text, text, uuid, uuid[], uuid) from anon, authenticated;

-- ---------------------------------------------------------------------
-- Phase 1 public RPC: Full Access correction by start/end.
drop function if exists correct_time_entry(uuid, numeric, text, text, uuid);
drop function if exists correct_time_entry(uuid, numeric, text, text);

create or replace function correct_time_entry(
  p_entry_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_notes text,
  p_reason_category text default null,
  p_activity_type_id uuid default null,
  p_trim_entry_ids uuid[] default '{}'
) returns void
language plpgsql security definer as $$
begin
  if my_access_level() <> 'full' then
    raise exception 'only Full Access can correct a finalized time entry -- request a correction instead';
  end if;
  perform apply_time_entry_correction(p_entry_id, p_started_at, p_ended_at, p_notes,
                                      p_reason_category, p_activity_type_id, p_trim_entry_ids, null);
end;
$$;

grant execute on function correct_time_entry(uuid, timestamptz, timestamptz, text, text, uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- Phase 2: correction requests.
create table if not exists time_entry_correction_requests (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references time_entries(id) on delete cascade,
  requested_by uuid not null references people(id),
  current_started_at timestamptz not null,
  current_ended_at timestamptz not null,
  proposed_started_at timestamptz not null,
  proposed_ended_at timestamptz not null,
  proposed_activity_type_id uuid references non_project_activity_types(id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references people(id),
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz not null default now()
);

create unique index if not exists time_entry_correction_requests_one_pending
  on time_entry_correction_requests(entry_id) where status = 'pending';

alter table time_entry_correction_requests enable row level security;
drop policy if exists tecr_select on time_entry_correction_requests;
create policy tecr_select on time_entry_correction_requests for select using (true);
-- No insert/update/delete policies: all writes go through the RPCs below.

create or replace function can_decide_time_entry_correction(p_request_id uuid) returns boolean
language plpgsql stable security definer as $$
declare
  v_req time_entry_correction_requests%rowtype;
  v_task_id uuid;
  v_owner uuid;
  v_manager uuid;
begin
  select * into v_req from time_entry_correction_requests where id = p_request_id;
  if v_req.id is null then
    return false;
  end if;
  v_manager := nearest_active_manager(v_req.requested_by);
  if v_req.requested_by = my_person_id() then
    -- self-decision only for someone with nobody active above them
    return v_manager is null;
  end if;
  if my_access_level() = 'full' then
    return true;
  end if;
  select te.task_id, pr.owner_id into v_task_id, v_owner
    from time_entries te
    left join tasks t on t.id = te.task_id
    left join projects pr on pr.id = t.project_id
   where te.id = v_req.entry_id;
  if v_task_id is not null and v_owner is not null and v_owner <> v_req.requested_by and v_owner = my_person_id() then
    return true;
  end if;
  return v_manager = my_person_id();
end;
$$;

grant execute on function can_decide_time_entry_correction(uuid) to authenticated;

create or replace function request_time_entry_correction(
  p_entry_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text,
  p_activity_type_id uuid default null
) returns uuid
language plpgsql security definer as $$
declare
  v_entry time_entries%rowtype;
  v_conflict uuid;
  v_day date;
  v_other numeric;
  v_new numeric;
  v_id uuid;
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
  if p_started_at = v_entry.started_at and p_ended_at = v_entry.ended_at
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
    (entry_id, requested_by, current_started_at, current_ended_at, proposed_started_at, proposed_ended_at, proposed_activity_type_id, reason)
  values
    (p_entry_id, my_person_id(), v_entry.started_at, v_entry.ended_at, p_started_at, p_ended_at, p_activity_type_id, trim(p_reason))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function request_time_entry_correction(uuid, timestamptz, timestamptz, text, uuid) to authenticated;

create or replace function cancel_time_entry_correction(p_request_id uuid) returns void
language plpgsql security definer as $$
begin
  update time_entry_correction_requests
     set status = 'cancelled', decided_at = now(), decided_by = my_person_id()
   where id = p_request_id and requested_by = my_person_id() and status = 'pending';
  if not found then
    raise exception 'no pending request of yours to cancel';
  end if;
end;
$$;

grant execute on function cancel_time_entry_correction(uuid) to authenticated;

create or replace function decide_time_entry_correction(
  p_request_id uuid,
  p_decision text,
  p_notes text default null
) returns void
language plpgsql security definer as $$
declare
  v_req time_entry_correction_requests%rowtype;
  v_entry time_entries%rowtype;
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
    perform apply_time_entry_correction(
      v_req.entry_id, v_req.proposed_started_at, v_req.proposed_ended_at,
      v_req.reason || coalesce(' (approved: ' || nullif(trim(p_notes), '') || ')', ''),
      null, v_req.proposed_activity_type_id, '{}', v_req.requested_by);
  end if;

  update time_entry_correction_requests
     set status = p_decision, decided_by = my_person_id(), decided_at = now(), decision_notes = nullif(trim(p_notes), '')
   where id = p_request_id;
end;
$$;

grant execute on function decide_time_entry_correction(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Data cleanup report (run separately, read-only): entries whose stored
-- duration no longer matches end - start (left over from duration-only
-- corrections).
--   select id, time_entry_label(id), duration_minutes,
--          round(extract(epoch from (ended_at - started_at))/60.0) as span_minutes
--     from time_entries
--    where ended_at is not null and status in ('confirmed','approved')
--      and abs(duration_minutes - round(extract(epoch from (ended_at - started_at))/60.0)) > 1;
