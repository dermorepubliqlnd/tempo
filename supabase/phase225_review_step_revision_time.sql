-- phase225 (2026-10-23): review/sign-off steps log time again after a resubmission (preview only until release).
create or replace function public.trg_r2_auto_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_created timestamptz;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_returned timestamptz;
  v_in_chain boolean;
  v_work uuid;
  v_since timestamptz;
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

  -- phase225 (2026-10-23, Sandra): a review / sign-off step that sent work
  -- back must log time again after the work is resubmitted.
  -- PREVIEW ONLY until release (remove the channel check at release).
  if public.my_person_id() is not null and public.r2_is_check_task(new.id)
     and coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-tempo-channel', '') = 'preview' then
    v_returned := null;
    select e.created_at, e.task_id into v_returned, v_work from task_review_events e
      where e.review_task_id = new.id and e.action = 'returned' order by e.created_at desc limit 1;
    if v_returned is not null then
      select coalesce(min(e.created_at), v_returned) into v_since from task_review_events e
        where e.task_id = v_work and e.action = 'completed' and e.created_at > v_returned;
      if not exists (select 1 from time_entries te where te.task_id = new.id and not coalesce(te.is_archived, false) and te.created_at > v_since) then
        raise exception 'This was resubmitted after you sent it back. Log the time you spent reviewing it, then finish.';
      end if;
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
select position('phase225' in prosrc) > 0 from pg_proc where proname = 'trg_r2_auto_complete';

-- RELEASED 2026-10-23: preview-only channel check removed (rule now applies on live).
