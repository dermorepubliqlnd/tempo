-- phase213 (2026-10-22, Sandra): For Revision from a sign-off goes back to the
-- person who did the work (the doer), not to the reviewer. Any review steps in
-- between reopen and wait for the revised work, so it is reviewed again before
-- the sign-off sees it.
create or replace function public.r2_is_check_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select w.name in ('Quality Assurance', 'Sign-Off') from tasks t join work_types w on w.id = t.work_type_id where t.id = p_task_id),
    (select coalesce(t.name, '') ~* '\m(review|qa|q\.a\.|quality check|check|sign[- ]?off|approv\w*|validat\w*|feedback)\M' from tasks t where t.id = p_task_id),
    false);
$$;

create or replace function public.r2_return_task(p_review_task_id uuid, p_work_task_id uuid, p_comment text) returns int
language plpgsql security definer set search_path = public as $$
declare
  rv record;
  wk record;
  v_me uuid := public.my_person_id();
  v_round int;
  v_between uuid[];
begin
  if coalesce(btrim(p_comment), '') = '' then
    raise exception 'Add a comment so the owner knows what to change.';
  end if;
  select t.*, pr.wbs_status as p_wbs into rv from tasks t join projects pr on pr.id = t.project_id where t.id = p_review_task_id;
  select * into wk from tasks where id = p_work_task_id;
  if rv.id is null or wk.id is null then raise exception 'Task not found.'; end if;

  -- The work task must sit upstream of this review, either directly or through
  -- other review / sign-off steps (e.g. Sign-Off -> Review -> the work).
  with recursive up(id, path) as (
    select d.depends_on_task_id, array[]::uuid[] from task_dependencies d where d.task_id = p_review_task_id
    union
    select d.depends_on_task_id, up.path || up.id
      from up join task_dependencies d on d.task_id = up.id
     where public.r2_is_check_task(up.id) and up.id <> p_work_task_id and cardinality(up.path) < 6
  )
  select path into v_between from up where id = p_work_task_id order by cardinality(path) limit 1;
  if v_between is null then
    raise exception 'You can only return work that this review or sign-off depends on.';
  end if;

  if rv.p_wbs = 'closed' then raise exception 'This project is closed.'; end if;
  if wk.status <> 'Done' then raise exception 'Only a finished (Done) task can be returned.'; end if;
  if not (rv.assignee_id = v_me or public.can_manage_wbs(rv.project_id) or public.my_access_level() = 'full') then
    raise exception 'Only the reviewer, the project owner or Full Access can return this task.';
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  perform set_config('app.bypass_status_baseline_lock', 'on', true);
  perform set_config('app.r2_review_return', 'on', true);
  update tasks set
    validated_completion_date = null, completion_adjustment_reason = null,
    validated_by = null, validation_performed_at = null,
    status = 'In Progress',
    submitted_on = null, submitted_by = null, actual_completion_date = null,
    revision_count = coalesce(revision_count, 0) + 1
  where id = p_work_task_id
  returning revision_count into v_round;
  -- Review steps in between reopen: they check the revised work again.
  if cardinality(v_between) > 0 then
    update tasks set
      validated_completion_date = null, completion_adjustment_reason = null,
      validated_by = null, validation_performed_at = null,
      status = 'In Progress', submitted_on = null, submitted_by = null, actual_completion_date = null
    where id = any(v_between) and status = 'Done';
  end if;
  perform set_config('app.r2_review_return', 'off', true);

  -- phase212: the review / sign-off step that returned it stays In Progress.
  insert into task_review_events (task_id, review_task_id, action, round, comment, actor_id)
  values (p_work_task_id, p_review_task_id, 'returned', v_round, btrim(p_comment), v_me);
  return v_round;
end;
$$;
grant execute on function public.r2_return_task(uuid, uuid, text) to authenticated;
