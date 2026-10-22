-- phase212 (2026-10-22, UAT): after For Revision, the review / sign-off step
-- stayed "Not Started" even though the reviewer had logged time. It now stays
-- In Progress (waiting on the revised work); on resubmit it shows Pass QA /
-- Approve again. Existing review steps in that state are repaired.
create or replace function public.r2_return_task(p_review_task_id uuid, p_work_task_id uuid, p_comment text) returns int
language plpgsql security definer set search_path = public as $$
declare
  rv record;
  wk record;
  v_me uuid := public.my_person_id();
  v_round int;
begin
  if coalesce(btrim(p_comment), '') = '' then
    raise exception 'Add a comment so the owner knows what to change.';
  end if;
  select t.*, pr.wbs_status as p_wbs into rv from tasks t join projects pr on pr.id = t.project_id where t.id = p_review_task_id;
  select * into wk from tasks where id = p_work_task_id;
  if rv.id is null or wk.id is null then raise exception 'Task not found.'; end if;
  if not exists (select 1 from task_dependencies where task_id = p_review_task_id and depends_on_task_id = p_work_task_id) then
    raise exception 'You can only return a task that this review depends on.';
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
  perform set_config('app.r2_review_return', 'off', true);

  -- phase212 (2026-10-22, Sandra): the review step stays In Progress while the
  -- work is revised -- it has started (time logged) and resumes on resubmit.

  insert into task_review_events (task_id, review_task_id, action, round, comment, actor_id)
  values (p_work_task_id, p_review_task_id, 'returned', v_round, btrim(p_comment), v_me);
  return v_round;
end;
$$;
grant execute on function public.r2_return_task(uuid, uuid, text) to authenticated;

update public.tasks r set status = 'In Progress'
where r.status = 'Not Started' and not coalesce(r.is_archived, false)
  and exists (select 1 from public.task_review_events e where e.review_task_id = r.id and e.action = 'returned')
  and exists (select 1 from public.time_entries te where te.task_id = r.id and not coalesce(te.is_archived, false));

select t.name, t.status from public.tasks t join public.projects p on p.id = t.project_id where p.project_number = 128 order by t.sort_order;
