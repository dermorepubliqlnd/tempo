-- phase188 (2026-10-13, Sandra): Return / request revision + revision history.
-- A reviewer can send a finished task back to its owner with a comment:
--   * the work task reopens (same field reset as the live reopen_task),
--   * tasks.revision_count goes up by 1,
--   * task_review_events logs every completion and every return (with the
--     reviewer's comment and round number) for reports (first-pass rate etc.).
-- Additive: existing tasks get revision_count 0; nothing else changes.

alter table public.tasks add column if not exists revision_count int not null default 0;

create table if not exists public.task_review_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  review_task_id uuid references public.tasks(id) on delete set null,
  action text not null check (action in ('completed', 'returned')),
  round int not null default 0,
  comment text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists task_review_events_task_idx on public.task_review_events(task_id, created_at desc);
alter table public.task_review_events enable row level security;
drop policy if exists task_review_events_select on public.task_review_events;
create policy task_review_events_select on public.task_review_events for select to authenticated
  using (public.can_see_task_plan(task_id));
-- No insert/update/delete policies: rows are written only by the trigger and RPC below.

-- Log every time a task is marked Done (round = how many returns it had).
create or replace function public.trg_log_task_completed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Done' and old.status is distinct from 'Done' then
    insert into task_review_events (task_id, action, round, actor_id)
    values (new.id, 'completed', coalesce(new.revision_count, 0), public.my_person_id());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_log_task_completed on public.tasks;
create trigger trg_log_task_completed after update of status on public.tasks
  for each row execute function public.trg_log_task_completed();

-- Return a finished task to its owner.
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
  update tasks set
    validated_completion_date = null, completion_adjustment_reason = null,
    validated_by = null, validation_performed_at = null,
    status = 'In Progress',
    submitted_on = null, submitted_by = null, actual_completion_date = null,
    revision_count = coalesce(revision_count, 0) + 1
  where id = p_work_task_id
  returning revision_count into v_round;

  -- The review waits again until the work is resubmitted.
  if rv.status = 'In Progress' then
    update tasks set status = 'Not Started' where id = p_review_task_id;
  end if;

  insert into task_review_events (task_id, review_task_id, action, round, comment, actor_id)
  values (p_work_task_id, p_review_task_id, 'returned', v_round, btrim(p_comment), v_me);
  return v_round;
end;
$$;
grant execute on function public.r2_return_task(uuid, uuid, text) to authenticated;
