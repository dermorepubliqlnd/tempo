-- phase135 (Sandra, 2026-10-04)
-- 1) Cancel dates: projects.cancelled_at / tasks.cancelled_at stamped
--    automatically when status becomes Cancelled (cleared on un-cancel).
--    Utilization counts a cancelled project/task only up to this date.
-- 2) A project with no tasks can't be Completed or Closed ("if there are
--    no tasks, nothing happened" -- add the tasks, or delete the project).

alter table projects add column if not exists cancelled_at timestamptz;
alter table tasks    add column if not exists cancelled_at timestamptz;

create or replace function stamp_cancelled_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'Cancelled' then
    if tg_op = 'INSERT' or old.status is distinct from 'Cancelled' or new.cancelled_at is null then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;
  else
    new.cancelled_at := null;
  end if;
  return new;
end $$;

drop trigger if exists projects_stamp_cancelled_at on projects;
create trigger projects_stamp_cancelled_at
  before insert or update of status on projects
  for each row execute function stamp_cancelled_at();

drop trigger if exists tasks_stamp_cancelled_at on tasks;
create trigger tasks_stamp_cancelled_at
  before insert or update of status on tasks
  for each row execute function stamp_cancelled_at();

-- Backfill: no history exists for when the 17 already-cancelled tasks were
-- cancelled, so stamp them "now" -- their past utilization stays exactly
-- as it shows today and stops from here on.
select set_config('app.bypass_closed_project_lock', 'on', false);
update tasks set cancelled_at = now() where status = 'Cancelled' and cancelled_at is null;
update projects set cancelled_at = now() where status = 'Cancelled' and cancelled_at is null;
select set_config('app.bypass_closed_project_lock', 'off', false);

create or replace function enforce_project_has_tasks() returns trigger
language plpgsql as $$
begin
  if ((new.status = 'Completed' and old.status is distinct from 'Completed')
      or (new.wbs_status = 'closed' and old.wbs_status is distinct from 'closed'))
     and not exists (select 1 from tasks t where t.project_id = new.id and not t.is_archived) then
    raise exception 'This project has no tasks, so it can''t be completed or closed. If work happened, add the tasks first; if nothing happened, delete the project instead.';
  end if;
  return new;
end $$;

drop trigger if exists projects_require_tasks_to_close on projects;
create trigger projects_require_tasks_to_close
  before update of status, wbs_status on projects
  for each row execute function enforce_project_has_tasks();
