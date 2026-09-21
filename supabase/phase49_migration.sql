-- Phase 49 (2026-09-21): default the Validated Date to the assignee's own
-- actual completion date instead of "today" (Sandra: "can it by default
-- capture the actual task completion date, the user or validator can just
-- adjust if ever the actual completion is not correct").
--
-- Previously, clicking the plain "Validate" button (Projects.tsx) calls
-- this RPC with no p_validated_date at all, and the function fell back to
-- now()::date -- i.e. whatever day the validator happened to click the
-- button, which is very often NOT the day the work actually finished.
-- The validator could always fix it afterward via the editable date field
-- (InlineDate, only once already validated) -- but the common case (the
-- self-reported actual_completion_date is correct) meant re-typing a date
-- that was already sitting right there on the row.
--
-- New default order when no explicit p_validated_date is passed:
--   1. actual_completion_date (assignee's own self-reported completion date)
--   2. submitted_on (auto-stamped the instant Status flipped to Done)
--   3. now() (last resort -- neither of the above exists)
-- An explicit p_validated_date (still how the editable Validated Date
-- field itself calls this RPC) always wins over all three, so a validator
-- adjusting the date because the self-reported one was wrong is untouched
-- by this change.
--
-- Also folds the "can't validate earlier than actual completion" check and
-- the actual write onto the SAME resolved date (v_new_date) -- previously
-- the earlier-than-completion check computed its own default and the final
-- UPDATE recomputed coalesce(p_validated_date, now()) separately; they
-- happened to agree before this change only because both defaulted to
-- now(), and would have silently diverged the moment one of them changed
-- without the other.
--
-- Identical to phase48_migration.sql's validate_task_completion otherwise
-- (self-validation exemption for "no manager above me" is unchanged).

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
    -- No active manager anywhere above this person -- "ask your manager"
    -- literally doesn't apply, so self-validation is the one exception.
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

  -- Default order when no explicit date is given: actual_completion_date,
  -- then submitted_on, then (only if neither exists) today.
  v_new_date := coalesce(p_validated_date::date, v_actual_completion, v_submitted_on::date, now()::date);
  v_completion_ref := coalesce(v_actual_completion, v_submitted_on::date);
  if v_completion_ref is not null and v_new_date < v_completion_ref then
    raise exception 'validation date (%) can''t be earlier than the actual completion date (%)', v_new_date, v_completion_ref;
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  update tasks set validated_completion_date = v_new_date::timestamptz, validated_by = my_person_id() where id = p_task_id;
end;
$$;

grant execute on function validate_task_completion(uuid, timestamptz) to authenticated;
