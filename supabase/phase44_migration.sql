-- Phase 44 (2026-09-07): block self-validation
-- Sandra: "ensure that the person cannot validate his or her own work.
-- Only the one up or direct report should be able to validate" -- i.e.
-- the assignee's immediate manager (or, as fallback, the nearest active
-- manager further up their chain -- unchanged from the existing
-- skip-level design), never the assignee themselves.
--
-- validate_task_completion's authorization previously OR'd together
-- Full Access / project owner / immediate manager / nearest active
-- manager with no check on who the assignee actually was -- so an
-- assignee who ALSO happened to be Full Access or the project owner
-- (a solo contributor project, or someone wearing both hats) could
-- validate their own Done task. Same fix applied client-side in
-- canValidateTask (Projects.tsx) so the button doesn't even show; this
-- is the authoritative server-side gate.
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
    raise exception 'you can''t validate your own work -- ask your manager to validate this task';
  end if;

  select
    my_access_level() = 'full'
    or exists (select 1 from projects where id = v_project_id and owner_id = my_person_id())
    or (v_assignee_id is not null and exists (select 1 from people where id = v_assignee_id and reports_to = my_person_id()))
    or (v_assignee_id is not null and nearest_active_manager(v_assignee_id) = my_person_id())
  into v_authorized;

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
