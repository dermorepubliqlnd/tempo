-- ---------------------------------------------------------------------
-- Phase 49 migration (2026-09-10): Cancelled task status revived.
--
-- Cancelled was deliberately removed as a task status (see notionOptions.ts's
-- TASK_STATUS_GROUPED comment) in favor of the app's own Archive/Delete
-- system -- but deleting a task destroys logged-hours history and breaks
-- dependency references, which turned out to be a real cost once teams
-- started actually needing to cancel scoped-but-abandoned work. Cancelled
-- comes back as a first-class, non-destructive status: distinct from
-- Done/Complete, excluded from scheduling exactly like Done, and locked +
-- reversible exactly like Done (reopen_task now un-cancels too).
--
-- No CHECK constraint added to tasks.status -- it was already free text
-- pre-existing (see schema.sql), so "Cancelled" needs no schema change
-- there; this migration only adds the reason column + lookup table and
-- extends the two existing Done-only triggers/RPC.
-- ---------------------------------------------------------------------

-- 1. Task Cancellation Reasons -- admin-configurable lookup, same
--    name/sort_order/is_active CRUD shape as baseline_decline_reasons
--    (phase46_migration.sql) and Time Logging Reasons (phase37).
--    Free text, not an FK: cancellation_reason on tasks stores the
--    picked reason's NAME directly (or the typed note when "Other" is
--    picked), same convention baseline_decline_reasons' sibling columns
--    use -- so a reason can be renamed/deactivated later without
--    rewriting historical tasks.

create table if not exists task_cancellation_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table task_cancellation_reasons enable row level security;

drop policy if exists task_cancellation_reasons_select on task_cancellation_reasons;
create policy task_cancellation_reasons_select on task_cancellation_reasons for select using (true);

drop policy if exists task_cancellation_reasons_insert on task_cancellation_reasons;
create policy task_cancellation_reasons_insert on task_cancellation_reasons for insert with check (my_access_level() = 'full');

drop policy if exists task_cancellation_reasons_update on task_cancellation_reasons;
create policy task_cancellation_reasons_update on task_cancellation_reasons for update using (my_access_level() = 'full') with check (my_access_level() = 'full');

drop policy if exists task_cancellation_reasons_delete on task_cancellation_reasons;
create policy task_cancellation_reasons_delete on task_cancellation_reasons for delete using (my_access_level() = 'full');

insert into task_cancellation_reasons (name, sort_order) values
  ('No longer needed / scope changed', 1),
  ('Duplicate task', 2),
  ('Superseded by other work', 3),
  ('Project cancelled or paused', 4),
  ('Created in error', 5),
  ('Other', 6)
on conflict (name) do nothing;

-- 2. tasks.cancellation_reason -- required (enforced client-side via the
--    cancel dialog, same optional-notes-except-Other pattern as the
--    Start Project decline dialog) whenever status = 'Cancelled'.
alter table tasks add column if not exists cancellation_reason text;

-- 3. Done-task DB lock (enforce_done_task_lock, phase9/phase12) now also
--    covers Cancelled -- re-created here with the one added condition,
--    everything else byte-identical to phase12's version. A cancelled
--    task's scoping fields freeze exactly the way a Done task's do.
create or replace function enforce_done_task_lock() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'UPDATE' and OLD.status in ('Done', 'Cancelled') and NEW.status = OLD.status then
    if coalesce(current_setting('app.bypass_done_task_lock', true), '') <> 'on' then
      if NEW.name is distinct from OLD.name
         or NEW.estimated_hours is distinct from OLD.estimated_hours
         or NEW.effort is distinct from OLD.effort
         or NEW.work_type_id is distinct from OLD.work_type_id
         or NEW.assignee_id is distinct from OLD.assignee_id
         or NEW.start_date is distinct from OLD.start_date
         or NEW.start_date_full is distinct from OLD.start_date_full
         or NEW.start_date_standard is distinct from OLD.start_date_standard
         or NEW.start_full_auto is distinct from OLD.start_full_auto
         or NEW.start_standard_auto is distinct from OLD.start_standard_auto
      then
        raise exception 'this task is % -- its scoping fields (name, estimated hours, effort, work type, assignee, start date) are locked. Reopen it first (Full Access, from the Status column on the main Tasks page, or the row action in WBS Planning) to make changes.', OLD.status;
      end if;
    end if;
  end if;
  return NEW;
end;
$$;
-- (trigger tasks_done_lock itself is unchanged and already bound to this
-- function -- create or replace is enough, no drop/create needed.)

-- 4. reopen_task now un-cancels too, not just un-Dones -- same RPC, same
--    authorization rule, same field resets, plus clearing
--    cancellation_reason (harmless no-op when the task was never
--    Cancelled in the first place). Byte-identical to phase22's version
--    otherwise.
create or replace function reopen_task(p_task_id uuid) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
  v_authorized boolean;
begin
  select assignee_id into v_assignee_id from tasks where id = p_task_id;
  if not found then
    raise exception 'task not found';
  end if;

  select
    my_access_level() = 'full'
    or (v_assignee_id is not null and exists (select 1 from people where id = v_assignee_id and reports_to = my_person_id()))
    or (v_assignee_id is not null and nearest_active_manager(v_assignee_id) = my_person_id())
  into v_authorized;

  if not coalesce(v_authorized, false) then
    raise exception 'not authorized to reopen this task';
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  perform set_config('app.bypass_status_baseline_lock', 'on', true);
  perform set_config('app.bypass_done_task_lock', 'on', true);
  update tasks set
    validated_completion_date = null,
    validated_by = null,
    status = 'In Progress',
    submitted_on = null,
    submitted_by = null,
    cancellation_reason = null
  where id = p_task_id;
end;
$$;
