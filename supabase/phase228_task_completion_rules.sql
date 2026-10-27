-- phase228 (2026-10-27, Sandra): task completion rules (briefs/Tempo_Task_Completion_Rules_Brief.md).
-- Applies to ALL projects (new-flow and older) for tasks a person marks Done from
-- release onward. No backfill. QA / Sign-Off chain on new-flow projects unchanged.
--   Early (before due)               -> today; manual validation (existing queue)
--   On the due date                  -> today; On Time, validated now
--   Grace (after due, up to the next business day, PH holidays skipped):
--       answer Yes -> due date saved as actual_completion_date (On Time, so the
--                     phase226 late-finish shift does NOT move dependents)
--       answer No  -> today; Late, validated now
--   Later                            -> today; Late, validated now
--   Logged late (phase198: created after its due date, e.g. a session logged
--   afterwards)                      -> due date; On Time, validated now
--                                       (phase198 confirmation for >3 working days still applies)
-- Skipped: system jobs (no person), parent tasks, closed projects, Draft projects
-- (date still set automatically), no due date, new-flow review-chain tasks.
-- The real click time stays in submitted_on. Runs last (zzzzz_) so it sees what
-- zz_auto_validate_late_completion / zzzz_r2_auto_complete did and settles it.
alter table public.tasks add column if not exists completion_timing text;
alter table public.tasks drop constraint if exists tasks_completion_timing_check;
alter table public.tasks add constraint tasks_completion_timing_check
  check (completion_timing in ('early', 'on_time', 'grace_on_time', 'late', 'logged_late'));
-- Set by the app with the Done update on a grace day: true = "Yes, completed by the due date".
alter table public.tasks add column if not exists completion_grace_answer boolean;

create or replace function public.trg_completion_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_due date;
  v_proj record;
  v_kind text;
  v_date date;
begin
  -- Leaving Done (reopen / For Revision): clear the classification.
  if old.status is not distinct from 'Done' and new.status is distinct from 'Done' then
    new.completion_timing := null;
    new.completion_grace_answer := null;
    return new;
  end if;
  if new.status is distinct from 'Done' or old.status is not distinct from 'Done' then return new; end if;
  if public.my_person_id() is null then return new; end if;                       -- system jobs
  if exists (select 1 from tasks c where c.parent_task_id = new.id and not coalesce(c.is_archived, false)) then return new; end if;
  select p.lifecycle_version, coalesce(p.wbs_status, 'draft') as wbs into v_proj from projects p where p.id = new.project_id;
  if v_proj.wbs = 'closed' then return new; end if;
  if v_proj.wbs = 'draft' then
    new.actual_completion_date := v_today;                                          -- Draft: system date, no classification
    return new;
  end if;
  -- New-flow review chain (QA / Sign-Off and the work they check): unchanged.
  if v_proj.lifecycle_version = 2 and (public.r2_is_check_task(new.id) or exists (
        select 1 from task_dependencies d join tasks c on c.id = d.task_id
        where d.depends_on_task_id = new.id and not coalesce(c.is_archived, false) and coalesce(c.status, '') <> 'Cancelled'
          and public.r2_is_check_task(c.id))) then
    return new;
  end if;
  v_due := new.current_due_date::date;
  if v_due is null then
    new.actual_completion_date := v_today;
    return new;
  end if;

  if new.late_log_kind = 'logged_late' then
    v_kind := 'logged_late'; v_date := v_due;
  elsif v_today < v_due then
    v_kind := 'early'; v_date := v_today;
  elsif v_today = v_due then
    v_kind := 'on_time'; v_date := v_today;
  elsif v_today <= public.next_working_day(v_due) then
    if coalesce(new.completion_grace_answer, false) then
      v_kind := 'grace_on_time'; v_date := v_due;
    else
      v_kind := 'late'; v_date := v_today;
    end if;
  else
    v_kind := 'late'; v_date := v_today;
  end if;
  if v_kind <> 'grace_on_time' then
    new.completion_grace_answer := case when v_today > v_due and v_today <= public.next_working_day(v_due) and v_kind = 'late' then false else null end;
  end if;

  new.actual_completion_date := v_date;
  new.completion_timing := v_kind;
  new.submitted_on := coalesce(new.submitted_on, now());
  new.submitted_by := coalesce(new.submitted_by, public.my_person_id());
  if v_kind = 'early' then
    -- Existing manual validation (Approval Center).
    new.validated_completion_date := null;
    new.validated_by := null;
    new.validation_performed_at := null;
    new.validated_locked_at := null;
    new.validated_locked_by := null;
    new.auto_validated := false;
  else
    new.validated_completion_date := v_date::timestamptz;
    new.validated_by := null;
    new.validation_performed_at := now();
    new.validated_locked_at := now();
    new.validated_locked_by := null;
    new.completion_adjustment_reason := null;
    new.validation_hold := false;
    new.auto_validated := true;
  end if;
  return new;
end;
$$;
drop trigger if exists zzzzz_completion_rules on public.tasks;
create trigger zzzzz_completion_rules before update of status on public.tasks
  for each row execute function public.trg_completion_rules();

select 'installed: ' || exists(select 1 from pg_trigger where tgname = 'zzzzz_completion_rules')::text;

-- APPLIED TO LIVE 2026-10-27 (Sandra: "build in live now"). Columns first, then the
-- app (commit 59a295b), then this trigger. Rollback: drop trigger zzzzz_completion_rules
-- on public.tasks; app rollback = tag backup-pre-completion-rules (77955c2).
-- Dry runs (rolled back) on ZZ TEST projects, 27 Oct 2026 (Tue):
--   older project: early (due 10/30) -> early, unvalidated; on time (due 10/27) -> on_time,
--   validated; grace No (due 10/26) -> late; grace Yes (due 10/26) -> grace_on_time,
--   actual 10/26, its dependent NOT shifted; late (due 10/22, typed 10/22 ignored) -> late,
--   actual 10/27, dependent shifted 10/26 -> 10/29 (1 task_schedule_shifts row).
--   new-flow: review-chain work -> unchanged (no completion_timing, chain-validated);
--   regular task due today -> on_time; logged late (created after due) -> logged_late,
--   actual = due; reopen_task -> completion_timing cleared.
--   next_working_day('2026-10-30') = 2026-11-03 (Nov 2 holiday skipped).
