-- Phase 123 (2026-09-29, Sandra: "Is it possible that the user uses a
-- timer for non-project logs?") -- Non-project TIMER.
--
-- Decisions (confirmed with Sandra):
--   - Add Time -> Non-project -> Start Timer | Log Manual Time.
--   - Start Timer needs only an Activity Type; no notes at start.
--   - Stopping forces notes (confirm_time_entry rejects a non-project
--     timer entry without notes). Until notes are added the entry stays
--     pending_confirm = "Pending" log, and it's flagged in Needs My
--     Attention (covers the idle auto-stop case, where nobody saw the
--     stop modal).
--   - Non-project TIMER entries need NO approval: confirm -> 'confirmed',
--     same lifecycle as project timers. Non-project MANUAL entries still
--     go to pending_approval (submit_non_project_time_entry unchanged).
--   - One running timer per person across BOTH lanes (existing partial
--     unique index one_running_timer_per_person already covers it; the
--     RPCs now give a readable message instead of a raw index error).
--   - Accidental starts: a timer under 2 minutes can be discarded (moved
--     to the Archive, no hard delete) without notes.

-- 1. Start a non-project timer ---------------------------------------------
create or replace function start_non_project_timer(p_activity_type_id uuid) returns uuid
language plpgsql security definer as $$
declare
  v_me uuid := my_person_id();
  v_label text;
  v_new_id uuid;
begin
  if v_me is null then
    raise exception 'not signed in';
  end if;
  if not exists (
    select 1 from non_project_activity_types
     where id = p_activity_type_id and is_active and not coalesce(is_archived, false)
  ) then
    raise exception 'choose an active activity type';
  end if;

  select coalesce(t.name, a.name, 'another item') into v_label
    from time_entries te
    left join tasks t on t.id = te.task_id
    left join non_project_activity_types a on a.id = te.activity_type_id
   where te.person_id = v_me and te.status = 'running'
   limit 1;
  if v_label is not null then
    raise exception 'you already have a timer running on "%" -- stop it before starting a new one', v_label;
  end if;

  insert into time_entries (task_id, activity_type_id, person_id, started_at, source, status)
  values (null, p_activity_type_id, v_me, now(), 'timer', 'running')
  returning id into v_new_id;

  return v_new_id;
end;
$$;
revoke all on function start_non_project_timer(uuid) from public;
grant execute on function start_non_project_timer(uuid) to authenticated;

-- 2. start_timer: the "already running" check now sees non-project timers
--    too (it inner-joined tasks, so a running non-project timer slipped
--    past it and hit the raw unique-index error instead).
create or replace function start_timer(p_task_id uuid) returns uuid
language plpgsql security definer as $$
declare
  v_assignee uuid;
  v_archived boolean;
  v_label text;
  v_new_id uuid;
begin
  select assignee_id, is_archived into v_assignee, v_archived from tasks where id = p_task_id;
  if v_assignee is null then
    raise exception 'task not found or has no assignee yet';
  end if;
  if v_assignee <> my_person_id() then
    raise exception 'only the task assignee can start this timer';
  end if;
  if coalesce(v_archived, false) then
    raise exception 'cannot start a timer on an archived task';
  end if;

  select coalesce(t.name, a.name, 'another item') into v_label
    from time_entries te
    left join tasks t on t.id = te.task_id
    left join non_project_activity_types a on a.id = te.activity_type_id
   where te.person_id = my_person_id() and te.status = 'running'
   limit 1;
  if v_label is not null then
    raise exception 'you already have a timer running on "%" -- stop it before starting a new one', v_label;
  end if;

  insert into time_entries (task_id, person_id, started_at, source, status)
  values (p_task_id, my_person_id(), now(), 'timer', 'running')
  returning id into v_new_id;

  return v_new_id;
end;
$$;
grant execute on function start_timer(uuid) to authenticated;

-- 3. confirm_time_entry: notes required for a non-project timer entry.
create or replace function confirm_time_entry(
  p_entry_id uuid,
  p_started_at timestamptz default null,
  p_ended_at timestamptz default null,
  p_notes text default null
) returns void
language plpgsql security definer as $$
declare
  v_person uuid;
  v_status text;
  v_start timestamptz;
  v_end timestamptz;
  v_activity uuid;
  v_notes text;
  v_archived boolean;
begin
  select person_id, status, started_at, ended_at, activity_type_id, reason_notes, is_archived
    into v_person, v_status, v_start, v_end, v_activity, v_notes, v_archived
    from time_entries where id = p_entry_id;

  if v_person is null then
    raise exception 'time entry not found';
  end if;
  if v_person <> my_person_id() then
    raise exception 'not authorized to confirm this time entry';
  end if;
  if coalesce(v_archived, false) then
    raise exception 'this time entry was discarded';
  end if;
  if v_status <> 'pending_confirm' then
    raise exception 'this time entry is not awaiting confirmation';
  end if;
  if v_activity is not null and nullif(trim(coalesce(p_notes, v_notes, '')), '') is null then
    raise exception 'add a note describing what this non-project time was for';
  end if;

  if p_started_at is not null then v_start := p_started_at; end if;
  if p_ended_at is not null then v_end := p_ended_at; end if;

  if v_end < v_start then
    raise exception 'end time must be at or after start time';
  end if;

  update time_entries
    set started_at = v_start,
        ended_at = v_end,
        duration_minutes = greatest(1, round(extract(epoch from (v_end - v_start)) / 60.0)),
        status = 'confirmed',
        confirmed_at = now(),
        reason_notes = coalesce(nullif(trim(p_notes), ''), reason_notes)
    where id = p_entry_id;
end;
$$;
grant execute on function confirm_time_entry(uuid, timestamptz, timestamptz, text) to authenticated;

-- 4. Discard an accidental timer (under 2 minutes) -> Archive -------------
create or replace function discard_timer_entry(p_entry_id uuid) returns void
language plpgsql security definer as $$
declare
  v_te time_entries%rowtype;
  v_seconds numeric;
begin
  select * into v_te from time_entries where id = p_entry_id;
  if v_te.id is null then
    raise exception 'time entry not found';
  end if;
  if v_te.person_id <> my_person_id() then
    raise exception 'you can only discard your own timer';
  end if;
  if v_te.source <> 'timer' or v_te.status not in ('running', 'pending_confirm') or v_te.is_archived then
    raise exception 'only a running or unconfirmed timer can be discarded';
  end if;
  v_seconds := extract(epoch from (coalesce(case when v_te.status = 'running' then now() end, v_te.ended_at, now()) - v_te.started_at));
  if v_seconds >= 120 then
    raise exception 'only a timer under 2 minutes can be discarded -- confirm it instead';
  end if;

  perform set_config('app.bypass_time_entry_daily_cap', 'on', true);
  perform set_config('app.bypass_time_entry_lock', 'on', true);

  update time_entries
     set ended_at = coalesce(case when status = 'running' then now() end, ended_at, now()),
         duration_minutes = coalesce(duration_minutes, 1),
         status = 'pending_confirm',
         is_archived = true,
         archived_at = now(),
         archived_by = my_person_id(),
         archive_reason = 'Discarded: accidental timer start (under 2 minutes)',
         archive_batch_id = gen_random_uuid(),
         archive_is_root = true
   where id = p_entry_id;
end;
$$;
revoke all on function discard_timer_entry(uuid) from public;
grant execute on function discard_timer_entry(uuid) to authenticated;

-- 5. Working Now shows non-project timers with their Activity Type -------
drop function if exists get_running_timers(text);
create function get_running_timers(p_scope text default 'team') returns table (
  entry_id uuid, person_id uuid, person_name text, task_id uuid, task_name text, task_number integer,
  project_id uuid, project_name text, started_at timestamptz,
  activity_type_id uuid, activity_type_name text, non_project_entry_number integer
)
language sql stable security definer as $$
  select te.id, te.person_id, p.name, te.task_id, t.name, t.task_number, t.project_id, pr.name, te.started_at,
         te.activity_type_id, a.name, te.non_project_entry_number
  from time_entries te
  join people p on p.id = te.person_id
  left join tasks t on t.id = te.task_id
  left join projects pr on pr.id = t.project_id
  left join non_project_activity_types a on a.id = te.activity_type_id
  where te.status = 'running'
    and (
      (p_scope = 'all' and my_access_level() = 'full')
      or (
        p_scope = 'team'
        and te.person_id <> my_person_id()
        and is_in_reports_to_subtree(my_person_id(), te.person_id)
      )
    )
  order by te.started_at asc;
$$;
revoke all on function get_running_timers(text) from public;
grant execute on function get_running_timers(text) to authenticated;

select 'phase123 ok' as result;
