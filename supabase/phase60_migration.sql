-- Phase 60 (2026-09-22, Sandra: "WBS Planning should not be a gatekeep
-- for non-project tasks") -- enforce_time_entry_baseline_lock (phase26)
-- assumed every time_entries row has a task_id and joins tasks->projects
-- to check the project's Start-Project/baseline-lock status. For a
-- non-project entry (task_id null, activity_type_id set instead), that
-- join returns no rows, so v_locked/v_wbs_status come back NULL and
-- "not coalesce(v_locked, false)" evaluates to true -- wrongly blocking
-- every non-project time entry with "hours can only be logged/tracked
-- once this project has been started". Non-project time has no project
-- to gate against, so the check is simply skipped when task_id is null.

create or replace function enforce_time_entry_baseline_lock() returns trigger
language plpgsql as $$
declare
  v_locked boolean;
  v_wbs_status text;
begin
  if TG_OP = 'INSERT' and NEW.task_id is not null then
    select pr.timelines_locked, pr.wbs_status into v_locked, v_wbs_status
      from tasks t join projects pr on pr.id = t.project_id
      where t.id = NEW.task_id;
    if v_wbs_status = 'closed' then
      raise exception 'this project is closed -- no more hours can be logged against its tasks';
    end if;
    if not coalesce(v_locked, false) then
      raise exception 'hours can only be logged/tracked once this project has been started (WBS Planning -> Start Project)';
    end if;
  end if;
  return NEW;
end;
$$;
