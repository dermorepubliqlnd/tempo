-- phase227 (2026-10-23): For Revision needs the reviewer's review time logged first (new-flow projects).
create or replace function public.r2_return_task(p_review_task_id uuid, p_work_task_id uuid, p_comment text) returns int
language plpgsql security definer set search_path = public as $$
declare
  rv record;
  wk record;
  v_me uuid := public.my_person_id();
  v_round int;
  v_between uuid[];
  v_ret timestamptz;
  v_ret_work uuid;
  v_since timestamptz;
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

  -- phase227 (2026-10-23, Sandra): on new-flow projects the reviewer logs
  -- review time before sending work back -- and, after a resubmission, time
  -- logged since it came back to them.
  -- PREVIEW ONLY until approved for live (remove the channel check then).
  if v_me is not null and exists (select 1 from projects p where p.id = rv.project_id and p.lifecycle_version = 2)
     and coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-tempo-channel', '') = 'preview' then
    select e.created_at, e.task_id into v_ret, v_ret_work from task_review_events e
      where e.review_task_id = p_review_task_id and e.action = 'returned' order by e.created_at desc limit 1;
    if v_ret is not null then
      select coalesce(min(e.created_at), v_ret) into v_since from task_review_events e
        where e.task_id = v_ret_work and e.action = 'completed' and e.created_at > v_ret;
    end if;
    if not exists (select 1 from time_entries te where te.task_id = p_review_task_id and not coalesce(te.is_archived, false)
                    and (v_since is null or te.created_at > v_since)) then
      raise exception 'Log the time you spent reviewing this before sending it back.';
    end if;
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
  -- phase214: review steps in between stay Done -- the back-and-forth is
  -- between the approver and the doer; the sign-off waits for the doer.
  perform set_config('app.r2_review_return', 'off', true);

  -- phase212: the review / sign-off step that returned it stays In Progress.
  insert into task_review_events (task_id, review_task_id, action, round, comment, actor_id)
  values (p_work_task_id, p_review_task_id, 'returned', v_round, btrim(p_comment), v_me);
  return v_round;
end;
$$;
select position('phase227' in prosrc) > 0 from pg_proc where proname = 'r2_return_task';

-- RELEASED 2026-10-23: preview-only channel check removed (rule now applies on live).
