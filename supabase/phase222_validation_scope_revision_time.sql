-- phase222 (2026-10-23, Sandra):
-- 1. Automatic validation only for work that went through the review chain:
--    review / sign-off steps themselves, and work that a review or sign-off
--    checks. Tasks with no review after them (e.g. Discovery Call) keep the
--    normal manual validation. The completion date is still set automatically.
-- 2. Resubmitting after For Revision needs time logged after it was sent back.
create or replace function public.trg_r2_auto_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_created timestamptz;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_returned timestamptz;
  v_in_chain boolean;
begin
  if new.status is distinct from 'Done' or old.status is not distinct from 'Done' then return new; end if;
  -- New-lifecycle projects only (the live site's projects are untouched until release).
  select created_at into v_created from projects where id = new.project_id and lifecycle_version = 2;
  if v_created is null or (v_created at time zone 'Asia/Manila')::date < date '2026-10-13' then return new; end if;
  if exists (select 1 from tasks c where c.parent_task_id = new.id and not coalesce(c.is_archived, false)) then return new; end if;

  -- Resubmitting after For Revision: time must be logged after it came back.
  if public.my_person_id() is not null then
    select max(e.created_at) into v_returned from task_review_events e where e.task_id = new.id and e.action = 'returned';
    if v_returned is not null and not exists (
      select 1 from time_entries te where te.task_id = new.id and not coalesce(te.is_archived, false) and te.created_at > v_returned
    ) then
      raise exception 'This came back For Revision. Log the time you spent on the revision, then resubmit.';
    end if;
  end if;

  new.actual_completion_date := v_today;
  new.submitted_on := coalesce(new.submitted_on, now());
  new.submitted_by := coalesce(new.submitted_by, public.my_person_id());

  v_in_chain := public.r2_is_check_task(new.id) or exists (
    select 1 from task_dependencies d join tasks c on c.id = d.task_id
    where d.depends_on_task_id = new.id and not coalesce(c.is_archived, false) and coalesce(c.status, '') <> 'Cancelled'
      and public.r2_is_check_task(c.id)
  );
  if v_in_chain then
    new.validated_completion_date := v_today::timestamptz;
    new.validated_by := public.my_person_id();
    new.validation_performed_at := now();
    new.validated_locked_at := now();
    new.validated_locked_by := public.my_person_id();
    new.completion_adjustment_reason := null;
    new.validation_hold := false;
    new.auto_validated := true;
  end if;
  return new;
end;
$$;

-- Tasks already auto-validated that never had a review after them go back to
-- manual validation (new-lifecycle projects only).
do $$
begin
  perform set_config('app.bypass_validation_rpc', 'on', true);
  update public.tasks t set validated_completion_date = null, validated_by = null, validation_performed_at = null,
         validated_locked_at = null, validated_locked_by = null, auto_validated = false
  from public.projects p
  where p.id = t.project_id and p.lifecycle_version = 2 and t.status = 'Done' and coalesce(t.auto_validated, false)
    and not coalesce(t.is_archived, false)
    and not public.r2_is_check_task(t.id)
    and not exists (select 1 from public.task_dependencies d join public.tasks c on c.id = d.task_id
                    where d.depends_on_task_id = t.id and not coalesce(c.is_archived, false) and public.r2_is_check_task(c.id));
end $$;

select count(*) filter (where t.validated_completion_date is null) awaiting_manual, count(*) done_tasks
from public.tasks t join public.projects p on p.id = t.project_id
where p.lifecycle_version = 2 and t.status = 'Done' and not coalesce(t.is_archived, false);
