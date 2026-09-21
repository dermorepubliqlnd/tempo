-- Phase 54 migration (2026-09-21): validation_performed_at -- a new,
-- separate audit timestamp for task completion validation.
--
-- Sandra, after asking for Task Completion validation to be added to
-- the Approval Center, then clarified exactly what she wants captured:
-- "to make sure its clear the date selected when someone validates just
-- validates the actual close date. but the actual validation date was
-- the date when the approver did the validation so if actual completion
-- was yesterday, validated today, validation date is today but the
-- validated completion date is yesterday."
--
-- Today, validated_completion_date is overloaded: it's the confirmed
-- completion date (defaults to actual_completion_date, which can be a
-- past date -- see phase49_migration.sql's own default order), but
-- there was no separate record of WHEN the validation action itself
-- happened if that default gets used or the date is backdated further.
-- Same actual-vs-signed-off split already used at the project level
-- (projects.actual_close_date vs project_closeouts.closed_at, see
-- [[project_capaciq_closure_actual_date_signoff_lessons_learned_2026_09_07]]),
-- now added at the task validation level too:
--   - validated_completion_date: the completion date being confirmed
--     (business meaning -- "the work was done on this date").
--   - validation_performed_at (NEW): always now() at the moment
--     validate_task_completion runs (audit meaning -- "the approver
--     clicked Validate at this moment"), regardless of what date was
--     chosen for validated_completion_date.

alter table tasks add column if not exists validation_performed_at timestamptz;

-- Identical to phase49_migration.sql's validate_task_completion, plus
-- stamping validation_performed_at = now() on every call (including a
-- later date-only edit via the still-editable Validated Date field,
-- since that's also a fresh validation action, not the original one).
create or replace function validate_task_completion(p_task_id uuid, p_validated_date timestamptz default null) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
  v_project_id uuid;
  v_status text;
  v_authorized boolean;
  v_actual_completion date;
  v_submitted_on timestamptz;
  v_completion_ref date;
  v_new_date date;
begin
  select assignee_id, project_id, status, actual_completion_date, submitted_on
    into v_assignee_id, v_project_id, v_status, v_actual_completion, v_submitted_on
    from tasks where id = p_task_id;
  if v_project_id is null then
    raise exception 'task not found';
  end if;
  if v_status <> 'Done' then
    raise exception 'only a Done task can be validated';
  end if;

  if v_assignee_id is not null and v_assignee_id = my_person_id() then
    if nearest_active_manager(v_assignee_id) is not null then
      raise exception 'you can''t validate your own work -- ask your manager to validate this task';
    end if;
    v_authorized := true;
  else
    select
      my_access_level() = 'full'
      or exists (select 1 from projects where id = v_project_id and owner_id = my_person_id())
      or (v_assignee_id is not null and exists (select 1 from people where id = v_assignee_id and reports_to = my_person_id()))
      or (v_assignee_id is not null and nearest_active_manager(v_assignee_id) = my_person_id())
    into v_authorized;
  end if;

  if not coalesce(v_authorized, false) then
    raise exception 'not authorized to validate this task';
  end if;

  v_new_date := coalesce(p_validated_date::date, v_actual_completion, v_submitted_on::date, now()::date);
  v_completion_ref := coalesce(v_actual_completion, v_submitted_on::date);
  if v_completion_ref is not null and v_new_date < v_completion_ref then
    raise exception 'validation date (%) can''t be earlier than the actual completion date (%)', v_new_date, v_completion_ref;
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  update tasks set
    validated_completion_date = v_new_date::timestamptz,
    validated_by = my_person_id(),
    validation_performed_at = now()
  where id = p_task_id;
end;
$$;

grant execute on function validate_task_completion(uuid, timestamptz) to authenticated;

-- reopen_task clears validation_performed_at alongside the other
-- validation fields it already clears, same "reopening wipes the slate"
-- convention as validated_completion_date/validated_by.
create or replace function reopen_task(p_task_id uuid) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
  v_authorized boolean;
begin
  select assignee_id into v_assignee_id from tasks where id = p_task_id;
  if not found then
    raise exception 'task not found';
  end if;

  select
    my_access_level() = 'full'
    or (v_assignee_id is not null and exists (select 1 from people where id = v_assignee_id and reports_to = my_person_id()))
    or (v_assignee_id is not null and nearest_active_manager(v_assignee_id) = my_person_id())
  into v_authorized;

  if not coalesce(v_authorized, false) then
    raise exception 'not authorized to reopen this task';
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  perform set_config('app.bypass_status_baseline_lock', 'on', true);
  update tasks set
    validated_completion_date = null,
    validated_by = null,
    validation_performed_at = null,
    status = 'In Progress',
    submitted_on = null,
    submitted_by = null
  where id = p_task_id;
end;
$$;

grant execute on function reopen_task(uuid) to authenticated;
