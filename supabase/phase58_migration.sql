-- Phase 58 (2026-09-22, Sandra: "tag actual completion date first before
-- the status auto changes to done") -- Actual Completion Date is now what
-- drives a task into Done (see Projects.tsx's Status/Actual Completion
-- column changes shipped alongside this migration), instead of Done
-- being set manually and Actual Completion Date being an optional
-- afterthought. reopen_task already wipes validated_completion_date/
-- validated_by/validation_performed_at/submitted_on/submitted_by on
-- reopen ("reopening wipes the slate" convention) -- it just never
-- included actual_completion_date, because until now that field could
-- outlive a reopen without causing confusion. Under the new rule it's
-- the thing that puts a task INTO Done, so a reopened task needs it
-- cleared too, or the stale date could look like it's still "confirmed"
-- pending re-completion.
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
    submitted_by = null,
    actual_completion_date = null
  where id = p_task_id;
end;
$$;

grant execute on function reopen_task(uuid) to authenticated;
