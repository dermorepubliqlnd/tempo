-- Phase 122 (2026-09-25): Task completion validation -- three distinct dates.
--   Target Due Date           = tasks.current_due_date (includes approved extensions)
--   Reported Completion Date  = tasks.actual_completion_date (assignee; never changed by validation)
--   Confirmed Completion Date = tasks.validated_completion_date (approver)
--   Validated At / By         = validation_performed_at / validated_by (audit only)
-- When Confirmed <> Reported, a Reason for adjustment is required (earlier OR later).
-- The old "Confirmed can't be earlier than Reported" rule is replaced by:
-- Confirmed can't be in the future (Manila date) or before the task's start date.
-- Project Health is intentionally unchanged (Sandra, 2026-09-25).

alter table tasks add column if not exists completion_adjustment_reason text;

-- Only the validation RPCs may write the reason (same bypass flag as validated_*).
create or replace function enforce_adjustment_reason_rpc() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'UPDATE'
     and NEW.completion_adjustment_reason is distinct from OLD.completion_adjustment_reason
     and coalesce(current_setting('app.bypass_validation_rpc', true), '') <> 'on' then
    raise exception 'completion_adjustment_reason can only be changed via validate_task_completion or reopen_task';
  end if;
  return NEW;
end;
$$;
drop trigger if exists tasks_adjustment_reason_rpc_lock on tasks;
create trigger tasks_adjustment_reason_rpc_lock
  before update on tasks
  for each row execute function enforce_adjustment_reason_rpc();

-- New signature (adds p_adjustment_reason) -> drop the 2-arg version first.
drop function if exists validate_task_completion(uuid, timestamptz);

create or replace function validate_task_completion(
  p_task_id uuid,
  p_validated_date timestamptz default null,
  p_adjustment_reason text default null
) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
  v_project_id uuid;
  v_status text;
  v_authorized boolean;
  v_reported date;
  v_submitted_on timestamptz;
  v_start date;
  v_new_date date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_reason text := nullif(btrim(coalesce(p_adjustment_reason, '')), '');
begin
  select assignee_id, project_id, status, actual_completion_date, submitted_on, start_date
    into v_assignee_id, v_project_id, v_status, v_reported, v_submitted_on, v_start
    from tasks where id = p_task_id;
  if v_project_id is null then
    raise exception 'task not found';
  end if;
  if v_status <> 'Done' then
    raise exception 'only a Done task can be validated';
  end if;

  if v_assignee_id is not null and v_assignee_id = my_person_id() then
    if nearest_active_manager(v_assignee_id) is not null then
      raise exception 'you can''t validate your own work -- ask your Immediate Supervisor to validate this task';
    end if;
    v_authorized := true;
  else
    v_authorized := can_full_access_approve(v_assignee_id) or (v_assignee_id is not null and is_approver_for(v_assignee_id));
  end if;
  if not coalesce(v_authorized, false) then
    raise exception 'not authorized to validate this task -- only the assignee''s Immediate Supervisor (or someone above them) can';
  end if;

  v_new_date := coalesce(p_validated_date::date, v_reported, v_submitted_on::date, v_today);

  if v_new_date > v_today then
    raise exception 'Confirmed Completion Date (%) can''t be in the future', v_new_date;
  end if;
  if v_start is not null and v_new_date < v_start then
    raise exception 'Confirmed Completion Date (%) can''t be before the task''s start date (%)', v_new_date, v_start;
  end if;

  if v_reported is not null and v_new_date <> v_reported then
    if v_reason is null then
      raise exception 'a Reason for adjustment is required when the Confirmed Completion Date differs from the Reported Completion Date';
    end if;
    if length(v_reason) > 500 then
      raise exception 'Reason for adjustment must be 500 characters or fewer';
    end if;
  else
    v_reason := null;   -- accepted as reported: no note stored
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  update tasks set
    validated_completion_date = v_new_date::timestamptz,
    validated_by = my_person_id(),
    validation_performed_at = now(),
    completion_adjustment_reason = v_reason
  where id = p_task_id;
end;
$$;
grant execute on function validate_task_completion(uuid, timestamptz, text) to authenticated;

-- reopen_task: clear the reason together with the validation (live-def patch).
do $$
declare
  v_def text;
  v_old text := 'validated_completion_date = null,';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reopen_task';
  if position(v_old in v_def) = 0 then
    raise exception 'phase122: pattern not found in reopen_task';
  end if;
  if position('completion_adjustment_reason' in v_def) = 0 then
    execute replace(v_def, v_old, v_old || ' completion_adjustment_reason = null,');
  end if;
end;
$$;

-- Backfill: already-validated tasks whose Confirmed date differs from Reported.
do $$
begin
  perform set_config('app.bypass_validation_rpc', 'on', true);
  perform set_config('app.bypass_closed_project_lock', 'on', true);  -- audit-only field
  update tasks set completion_adjustment_reason = 'Adjusted before reasons were required'
   where validated_completion_date is not null
     and actual_completion_date is not null
     and validated_completion_date::date <> actual_completion_date
     and completion_adjustment_reason is null;
end;
$$;

select 'phase122 ok · backfilled ' || count(*) as result
  from tasks where completion_adjustment_reason = 'Adjusted before reasons were required';
