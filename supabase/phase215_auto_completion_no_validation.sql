-- phase215 (2026-10-22, Sandra): new projects (created from 13 Oct) -- no manual
-- completion date and no separate validation. The review chain is the check.
-- * When a task is set to Done, its completion date is the day it was marked
--   Done / submitted / passed / approved (Manila time), and it is validated
--   on the spot (validated by the person who finished it).
-- * When work is sent back For Revision the dates clear (r2_return_task), and
--   the next submission sets them again -- so the last one counts.
-- * Every completion and send-back stays in task_review_events (history).
-- Older projects keep the manual date and validation.
create or replace function public.trg_r2_auto_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_created timestamptz;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if new.status is distinct from 'Done' or old.status is not distinct from 'Done' then return new; end if;
  -- New-lifecycle projects only (the live site's projects are untouched until release).
  select created_at into v_created from projects where id = new.project_id and lifecycle_version = 2;
  if v_created is null or (v_created at time zone 'Asia/Manila')::date < date '2026-10-13' then return new; end if;
  if exists (select 1 from tasks c where c.parent_task_id = new.id and not coalesce(c.is_archived, false)) then return new; end if;
  new.actual_completion_date := v_today;
  new.submitted_on := coalesce(new.submitted_on, now());
  new.submitted_by := coalesce(new.submitted_by, public.my_person_id());
  new.validated_completion_date := v_today::timestamptz;
  new.validated_by := public.my_person_id();
  new.validation_performed_at := now();
  new.validated_locked_at := now();
  new.validated_locked_by := public.my_person_id();
  new.completion_adjustment_reason := null;
  new.validation_hold := false;
  new.auto_validated := true;
  return new;
end;
$$;
-- Named to run after every other BEFORE trigger on tasks (they fire in name order).
drop trigger if exists zzzz_r2_auto_complete on public.tasks;
create trigger zzzz_r2_auto_complete before update of status on public.tasks
  for each row execute function public.trg_r2_auto_complete();

-- Backfill: Done tasks on new projects still waiting for validation.
do $$
begin
  perform set_config('app.bypass_validation_rpc', 'on', true);
  update public.tasks t set
    actual_completion_date = coalesce(t.actual_completion_date, (coalesce(t.submitted_on, now()) at time zone 'Asia/Manila')::date),
    validated_completion_date = coalesce(t.actual_completion_date, (coalesce(t.submitted_on, now()) at time zone 'Asia/Manila')::date)::timestamptz,
    validation_performed_at = now(), validated_locked_at = now(), auto_validated = true, validation_hold = false
  from public.projects p
  where p.id = t.project_id and p.lifecycle_version = 2 and (p.created_at at time zone 'Asia/Manila')::date >= date '2026-10-13'
    and t.status = 'Done' and t.validated_completion_date is null and not coalesce(t.is_archived, false)
    and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and not coalesce(c.is_archived, false));
end $$;

select count(*) filter (where t.validated_completion_date is null) as still_unvalidated, count(*) as done_on_new_projects
from public.tasks t join public.projects p on p.id = t.project_id
where p.lifecycle_version = 2 and (p.created_at at time zone 'Asia/Manila')::date >= date '2026-10-13' and t.status = 'Done' and not coalesce(t.is_archived, false);
