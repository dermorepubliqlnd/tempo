-- Phase 52 migration (2026-09-21): in-app Reopen for closed projects,
-- Full Access only.
--
-- Until now, closure was one-way in the app -- the only way to reopen a
-- closed project was Claude manually running
-- `update projects set wbs_status = 'baseline_locked'` in the SQL editor
-- (see the P-0028 investigation / [[project_capaciq_closure_actual_date_signoff_lessons_learned_2026_09_07]]
-- for the first time this happened). Sandra asked to "allow admin
-- permission to re-open projects" instead of that being a support-ticket-
-- only action.
--
-- Deliberately restricted to Full Access (not project owner, not
-- can_approve_closures) -- reopening undoes a FINAL, signed-off state,
-- which is a bigger deal than deciding a closure the first time, so this
-- intentionally does NOT reuse canDecideClosure's broader authorization.
--
-- Sets wbs_status back to 'baseline_locked' (never 'changed_after_baseline'
-- directly) -- same reasoning as the manual fix: record_wbs_edit only
-- auto-opens a fresh project_revisions row when it sees 'baseline_locked'
-- with no revision already in progress, so this keeps the Audit Trail
-- correctly picking up whatever gets edited next. project_closeouts /
-- project_closure_requests rows from the original closure are left
-- untouched as historical record (unchanged from the manual precedent).
--
-- reopened_at/reopened_by are new columns so the WBS page can show "this
-- project was reopened by X on Y" -- otherwise a reopened project looks
-- identical to one that was never closed, silently losing that history.

alter table projects add column if not exists reopened_at timestamptz;
alter table projects add column if not exists reopened_by uuid references people(id);

create or replace function reopen_wbs_closure(p_project_id uuid) returns void
language plpgsql security definer as $$
declare
  v_wbs_status text;
begin
  if my_access_level() <> 'full' then
    raise exception 'only Full Access users can reopen a closed project';
  end if;

  select wbs_status into v_wbs_status from projects where id = p_project_id;
  if v_wbs_status is null then
    raise exception 'project not found';
  end if;
  if v_wbs_status <> 'closed' then
    raise exception 'project is not closed (current status: %)', v_wbs_status;
  end if;

  update projects
  set wbs_status = 'baseline_locked', reopened_at = now(), reopened_by = my_person_id()
  where id = p_project_id;
end;
$$;

grant execute on function reopen_wbs_closure(uuid) to authenticated;
