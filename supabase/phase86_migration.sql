-- ---------------------------------------------------------------------
-- Phase 86 migration (2026-09-23): auto-bump a task's Status to
-- "In Progress" once real work has actually been logged against it.
--
-- Sandra: "if a timer has started for a certain task, please trigger
-- task status change to In Progress. meaning if timer has started and
-- ended or a manual log has been approved then task status changes to
-- In Progress. Do not apply yet if there is no confirmed or approved
-- log against the task."
--
-- So: NOT on timer start (a running entry, status='running') -- only
-- once a time_entries row actually FINALIZES as confirmed (timer
-- stopped + auto/self-confirmed) or approved (manual entry approved).
-- Pending/rejected/running entries never touch task status. Only ever
-- moves Not Started -> In Progress -- never touches a task that's
-- already In Progress, Done, Cancelled, or any other status value, so
-- this can never fight with a manual status change or the existing
-- Done-completion workflow.
--
-- A trigger (not client-side) so this is authoritative regardless of
-- which path finalizes the entry (self-confirm, a supervisor's
-- approval, a correction) -- mirrors the existing
-- enforce_time_entry_daily_cap/enforce_status_baseline_lock pattern.
-- SECURITY DEFINER + the existing bypass_status_baseline_lock/
-- bypass_closed_project_lock session flags so this can't ever be
-- blocked by the very locks that already require a task to have a
-- locked baseline (and hence be loggable) in the first place -- same
-- defensive pattern as reopen_task's own status-changing writes.
-- ---------------------------------------------------------------------

create or replace function bump_task_status_on_time_logged() returns trigger
language plpgsql security definer as $$
begin
  if NEW.task_id is null then
    return NEW;
  end if;
  if NEW.status not in ('confirmed', 'approved') then
    return NEW;
  end if;

  perform set_config('app.bypass_status_baseline_lock', 'on', true);
  perform set_config('app.bypass_closed_project_lock', 'on', true);

  update tasks
    set status = 'In Progress'
    where id = NEW.task_id
      and status = 'Not Started';

  return NEW;
end;
$$;

drop trigger if exists trg_bump_task_status_on_time_logged on time_entries;
create trigger trg_bump_task_status_on_time_logged
  after insert or update on time_entries
  for each row execute function bump_task_status_on_time_logged();
