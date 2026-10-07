-- phase173 (2026-10-08, Sandra, item H): one "Log time" form, same checks everywhere.
-- PREVIEW-GATED: does nothing unless public.auto_approvals_enabled() is true
-- (staging header x-tempo-channel: preview, or app_settings.auto_approvals_live).
--
-- BEFORE INSERT OR UPDATE guard on time_entries. Checks only:
--   a) INSERT of a source='manual' row (manual, non-project, follow-up),
--   b) UPDATE of a pending_approval / rejected manual row whose started_at or
--      ended_at actually changes (edit_pending_manual_time_entry),
--   c) a timer confirm: status pending_confirm -> confirmed with changed times.
-- Everything else (timers starting/stopping, archive/restore, approvals and
-- decisions, corrections of finalized entries via their own RPCs) passes
-- straight through.
-- Rules: end in the future (1 minute grace) -> error; end <= start -> error;
-- overlap with another live entry of the same person -> error naming it;
-- a normal (non-follow-up) manual entry on a Done task -> error.
--
-- Named zy_ so it runs after every existing BEFORE trigger
-- (time_entries_*, trg_*) but BEFORE zz_auto_approve_manual_time, so an
-- entry that breaks a rule never reaches the auto-approval decision.
-- Additive only: no existing function or trigger is changed.

create or replace function public.time_entry_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_check boolean := false;
  v_conflict uuid;
  v_task_status text;
  v_start timestamptz := NEW.started_at;
  v_end timestamptz := NEW.ended_at;
  v_timer_confirm boolean := false;
begin
  if not public.auto_approvals_enabled() then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    v_check := NEW.source = 'manual';
  elsif TG_OP = 'UPDATE' then
    if NEW.started_at is not distinct from OLD.started_at
       and NEW.ended_at is not distinct from OLD.ended_at
       and NEW.task_id is not distinct from OLD.task_id then
      return NEW;  -- times (and task) untouched: archive, decisions, notes, etc.
    end if;
    v_timer_confirm := OLD.status = 'pending_confirm' and NEW.status = 'confirmed';
    v_check :=
      (OLD.source = 'manual' and OLD.status in ('pending_approval', 'rejected')
         and NEW.status in ('pending_approval', 'rejected'))
      or v_timer_confirm;
    -- The confirm form sends whole minutes, so an untouched timer still
    -- "changes" by a few seconds. Treat a shift under 1 minute as no change
    -- (keep the timer's own time), so plain confirms are never blocked by
    -- seconds-level rounding against a neighbouring entry.
    if v_timer_confirm then
      if OLD.started_at is not null and abs(extract(epoch from (NEW.started_at - OLD.started_at))) < 60 then
        v_start := OLD.started_at;
      end if;
      if OLD.ended_at is not null and abs(extract(epoch from (NEW.ended_at - OLD.ended_at))) < 60 then
        v_end := OLD.ended_at;
      end if;
      if v_start is not distinct from OLD.started_at and v_end is not distinct from OLD.ended_at then
        return NEW;  -- times not really edited
      end if;
    end if;
  end if;

  if not v_check or coalesce(NEW.is_archived, false) then
    return NEW;
  end if;

  if v_start is null or v_end is null then
    raise exception 'Enter a start and end time.';
  end if;
  if v_end > now() + interval '1 minute' then
    raise exception 'You can only log time that has already passed. Change the end time to now or earlier.';
  end if;
  if v_end <= v_start then
    raise exception 'The end time is before the start time. Change the end time to after the start.';
  end if;

  v_conflict := public.find_time_entry_overlap(NEW.person_id, v_start, v_end, array[NEW.id]);
  if v_conflict is not null then
    raise exception 'This time overlaps another entry: %. Change the start or end time.', public.time_entry_label(v_conflict);
  end if;

  -- A normal manual entry can't go on a Done task (follow-up time can).
  -- Only on insert or when the task changes, so editing a pending entry on a
  -- task that was marked Done afterwards isn't blocked.
  if NEW.source = 'manual' and NEW.task_id is not null and not coalesce(NEW.is_follow_up, false)
     and (TG_OP = 'INSERT' or NEW.task_id is distinct from OLD.task_id) then
    select status into v_task_status from tasks where id = NEW.task_id;
    if v_task_status = 'Done' then
      raise exception 'This task is Done. Log it as follow-up time instead.';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists zy_time_entry_guard on public.time_entries;
create trigger zy_time_entry_guard before insert or update on public.time_entries
  for each row execute function public.time_entry_guard();
