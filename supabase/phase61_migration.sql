-- Phase 61 (2026-09-22, Sandra: "ensure that no one logs more than 12
-- hours per day") -- a hard daily cap on logged hours, enforced at the
-- database level so it can't be bypassed by any client-side path.
--
-- Scope (confirmed with Sandra):
--   - Caps the DAILY TOTAL, not a single entry: project-task time and
--     non-project time (Non-Project Time feature, phase59) are summed
--     together per person per day against one 12-hour (720-minute) limit.
--   - Hard block: the write is rejected outright with a clear error, no
--     confirm-and-override even for Full Access.
--   - Counts pending as well as finalized entries -- pending_confirm,
--     pending_approval, confirmed, and approved all count toward the
--     day's total; only 'rejected' (and 'running', which has no duration
--     yet) are excluded. This prevents someone from getting past the cap
--     just because a stack of same-day entries haven't been decided yet.
--   - "Day" = the entry's started_at date in Asia/Manila time (the
--     business's local timezone -- everything else in this schema stores
--     timestamptz and lets the client format dates in browser-local time,
--     but a server-side trigger needs one fixed zone to bucket by).
--
-- Applies uniformly to every place duration_minutes is written, because
-- it's a single BEFORE INSERT OR UPDATE trigger on time_entries rather
-- than a check duplicated into each RPC:
--   - submit_manual_time_entry / submit_non_project_time_entry (insert,
--     pending_approval)
--   - stop_timer (update, sets duration when a timer is stopped)
--   - confirm_time_entry (update, recomputes duration off possibly-
--     adjusted started_at/ended_at)
--   - correct_time_entry (Full Access correcting a finalized entry's
--     hours -- deliberately NOT exempt, since a correction can push a day
--     over the cap just as easily as a fresh entry)
--
-- Exemption: BOTH stop_timer (a person stopping their own running timer)
-- and auto_stop_idle_timers (the 15-minute cron safety net that
-- force-stops a timer nobody remembered to stop) are exempt via a
-- session bypass flag, same pattern as enforce_time_entry_lock's
-- app.bypass_time_entry_lock. Reasoning: stopping a timer only computes
-- how long it ran and moves it to pending_confirm -- it isn't the
-- "logging" decision, confirming is (confirm_time_entry recomputes the
-- duration and IS checked, with no bypass). If stop_timer itself were
-- blocked, a timer that had already run past what's left of the day's
-- cap could never be stopped through the app at all -- it would just
-- keep running, unstoppable, which is worse than the thing this feature
-- is trying to prevent. So: stopping always succeeds, confirming is
-- where the 12-hour rule actually bites, and the person can adjust the
-- times down at that point if needed. auto_stop_idle_timers additionally
-- needs the bypass because it's one bulk UPDATE across every idle timer
-- system-wide -- if one person's stop tripped the cap, raising inside
-- the trigger would abort the whole statement and leave every OTHER
-- idle timer stuck running too.

create or replace function enforce_time_entry_daily_cap() returns trigger
language plpgsql as $$
declare
  v_day date;
  v_other_minutes numeric;
  v_total_minutes numeric;
  v_cap constant numeric := 720; -- 12 hours
begin
  if coalesce(current_setting('app.bypass_time_entry_daily_cap', true), '') = 'on' then
    return NEW;
  end if;

  -- Nothing to check yet (timer still running) or this write is only
  -- removing the entry from the day's total (rejecting it, or resuming a
  -- timer back to running with duration cleared) -- never block those.
  if NEW.duration_minutes is null or NEW.status in ('running', 'rejected') then
    return NEW;
  end if;

  v_day := (NEW.started_at at time zone 'Asia/Manila')::date;

  select coalesce(sum(duration_minutes), 0) into v_other_minutes
    from time_entries
    where person_id = NEW.person_id
      and id <> NEW.id
      and status not in ('running', 'rejected')
      and (started_at at time zone 'Asia/Manila')::date = v_day;

  v_total_minutes := v_other_minutes + NEW.duration_minutes;

  if v_total_minutes > v_cap then
    raise exception 'this would bring logged hours for % to %h, over the 12-hour daily limit (% h already logged/pending that day)',
      to_char(v_day, 'Mon DD, YYYY'),
      round(v_total_minutes / 60.0, 2),
      round(v_other_minutes / 60.0, 2);
  end if;

  return NEW;
end;
$$;

drop trigger if exists time_entries_daily_cap on time_entries;
create trigger time_entries_daily_cap
  before insert or update on time_entries
  for each row execute function enforce_time_entry_daily_cap();

-- Exempt stop_timer (see reasoning above) -- stopping should never be
-- blocked, only confirming.
create or replace function stop_timer(p_entry_id uuid) returns void
language plpgsql security definer as $$
declare
  v_person uuid;
  v_status text;
  v_started timestamptz;
begin
  select person_id, status, started_at into v_person, v_status, v_started from time_entries where id = p_entry_id;
  if v_person is null then
    raise exception 'time entry not found';
  end if;
  if v_person <> my_person_id() then
    raise exception 'not authorized to stop this timer';
  end if;
  if v_status <> 'running' then
    raise exception 'this timer is not currently running';
  end if;

  perform set_config('app.bypass_time_entry_daily_cap', 'on', true);

  update time_entries
    set ended_at = now(),
        status = 'pending_confirm',
        duration_minutes = greatest(1, round(extract(epoch from (now() - v_started)) / 60.0))
    where id = p_entry_id;
end;
$$;

grant execute on function stop_timer(uuid) to authenticated;

-- Exempt the idle auto-stop cron job (see reasoning above).
create or replace function auto_stop_idle_timers() returns void
language plpgsql security definer as $$
declare
  v_threshold int;
begin
  select idle_timeout_minutes into v_threshold from app_settings where id = true;
  v_threshold := coalesce(v_threshold, 240);

  perform set_config('app.bypass_time_entry_daily_cap', 'on', true);

  update time_entries
    set ended_at = now(),
        status = 'pending_confirm',
        duration_minutes = round(extract(epoch from (now() - started_at)) / 60.0),
        auto_stopped = true
    where status = 'running'
      and started_at < now() - (v_threshold || ' minutes')::interval;
end;
$$;

grant execute on function auto_stop_idle_timers() to authenticated;
