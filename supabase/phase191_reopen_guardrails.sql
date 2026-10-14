-- phase191 (2026-10-14, Sandra): watertight reopen guardrails for new projects
-- (created on/after 13 Oct 2026, Manila). Mirrors the app rules:
--   * Once a later step built on a task is Done, nobody can move the task off
--     Done -- the only way back is For Revision from that later step.
--   * A finished hand-off (work that a review depends on, or a review / sign-off
--     step) can only be reopened by Full Access, the project owner, or someone
--     above the assignee in the reporting line -- not by the assignee.
--   * For Revision (r2_return_task) is always allowed: it is the proper way back.
-- Older projects, parent rows and system jobs (no signed-in person) are untouched.

-- 1. For Revision marks its own update so the guard lets it through.
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

  if rv.status = 'In Progress' then
    update tasks set status = 'Not Started' where id = p_review_task_id;
  end if;

  insert into task_review_events (task_id, review_task_id, action, round, comment, actor_id)
  values (p_work_task_id, p_review_task_id, 'returned', v_round, btrim(p_comment), v_me);
  return v_round;
end;
$$;
grant execute on function public.r2_return_task(uuid, uuid, text) to authenticated;

-- 2. The guard.
create or replace function public.trg_r2_reopen_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.my_person_id();
  v_created timestamptz;
  v_owner uuid;
  v_later text;
  v_is_review boolean;
  v_handed_over boolean;
  c_review_re constant text := '\m(review|qa|q\.a\.|quality check|check|sign[- ]?off|approv\w*|validat\w*|feedback)\M';
begin
  if old.status is distinct from 'Done' or new.status = 'Done' then return new; end if;
  if coalesce(current_setting('app.r2_review_return', true), '') = 'on' then return new; end if;
  if v_me is null then return new; end if; -- system jobs / service role
  select created_at, owner_id into v_created, v_owner from projects where id = new.project_id;
  if v_created is null or (v_created at time zone 'Asia/Manila')::date < date '2026-10-13' then return new; end if;
  if exists (select 1 from tasks c where c.parent_task_id = new.id and not coalesce(c.is_archived, false)) then return new; end if;

  -- A later step built on this task is already Done.
  select l.name into v_later
  from task_dependencies d join tasks l on l.id = d.task_id
  where d.depends_on_task_id = new.id and l.status = 'Done' and not coalesce(l.is_archived, false)
  limit 1;
  if v_later is not null then
    raise exception '"%" is already done on top of this task. To change it now, that step has to send it back For Revision.', v_later;
  end if;

  -- A finished hand-off: only Full Access, the owner, or the assignee''s chain can reopen it.
  v_is_review := coalesce(old.name, '') ~* c_review_re
                 and exists (select 1 from task_dependencies d where d.task_id = new.id);
  v_handed_over := v_is_review or exists (
    select 1 from task_dependencies d join tasks r on r.id = d.task_id
    where d.depends_on_task_id = new.id and r.status <> 'Cancelled' and not coalesce(r.is_archived, false)
      and coalesce(r.name, '') ~* c_review_re);
  if v_handed_over
     and not (public.my_access_level() = 'full' or v_owner = v_me or public.is_approver_for(old.assignee_id)) then
    raise exception 'This task was handed over. Ask the reviewer to send it back For Revision, or ask the project owner.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_r2_reopen_guard on public.tasks;
create trigger trg_r2_reopen_guard before update of status on public.tasks
  for each row execute function public.trg_r2_reopen_guard();
