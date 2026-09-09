-- Phase 48 (2026-09-08): self-validation exemption for "no manager above me" --
-- Sandra: "allow me to validate my own [tasks] only since I have no one
-- up -- is that ok, or tag me as full admin access, not sure if that's a
-- separate layer of permission." Confirmed via AskUserQuestion: NOT a
-- blanket Full Access exemption (every Full Access person would then be
-- able to self-validate, which is broader than what she asked and
-- contradicts the whole point of the phase44 self-validation block) --
-- narrower, matches the original rule's own spirit ("only the one up
-- should validate"): self-validation is allowed ONLY when
-- nearest_active_manager (phase10_migration.sql) finds nobody active
-- anywhere above the assignee at all, i.e. the rule literally has nobody
-- left to apply to. Full Access people who DO have an active manager set
-- are still blocked from self-validating, same as before.
--
-- Identical to phase44_migration.sql's validate_task_completion otherwise.

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

  v_new_date := coalesce(p_validated_date, now())::date;
  v_completion_ref := coalesce(v_actual_completion, v_submitted_on::date);
  if v_completion_ref is not null and v_new_date < v_completion_ref then
    raise exception 'validation date (%) can''t be earlier than the actual completion date (%)', v_new_date, v_completion_ref;
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  update tasks set validated_completion_date = coalesce(p_validated_date, now()), validated_by = my_person_id() where id = p_task_id;
end;
$$;

grant execute on function validate_task_completion(uuid, timestamptz) to authenticated;
