-- Phase 75 (2026-09-23, Sandra: "non-project entries don't get a task
-- ID -- should we assign one too? pull from existing sequence or a
-- different prefix like NP-xxx") -- non-project time entries (Activity
-- Type instead of a task) get their own sequence-backed integer ID,
-- displayed as NP-0007 style, same padding convention as task_number's
-- T-0007. Sandra chose: one ID per LOG ENTRY (not one shared per
-- Activity Type), and a SEPARATE sequence/prefix rather than reusing
-- task_number_seq -- reusing it would make NP- codes look like they
-- share a table with real tasks, which they don't.

alter table time_entries add column if not exists non_project_entry_number integer;

create sequence if not exists non_project_entry_number_seq;

-- Backfilling touches every non-project row, including finalized
-- (confirmed/approved) ones -- enforce_time_entry_lock() blocks ANY
-- update to those unless app.bypass_time_entry_lock is 'on' first (same
-- gotcha task_number's backfill hit with enforce_closed_project_lock,
-- see phase67_migration.sql). 'false' scope so it holds for the whole
-- script, not just one statement.
select set_config('app.bypass_time_entry_lock', 'on', false);

-- Backfill existing non-project entries in creation order, same
-- approach phase67_migration.sql used for task_number.
with numbered as (
  select id, row_number() over (order by created_at) as rn
  from time_entries
  where activity_type_id is not null and non_project_entry_number is null
)
update time_entries t
  set non_project_entry_number = numbered.rn
  from numbered
  where numbered.id = t.id;

select setval('non_project_entry_number_seq', coalesce((select max(non_project_entry_number) from time_entries), 0) + 1, false);

create unique index if not exists time_entries_non_project_entry_number_key
  on time_entries(non_project_entry_number)
  where non_project_entry_number is not null;

select set_config('app.bypass_time_entry_lock', 'off', false);

-- Auto-assign going forward, only for non-project rows (activity_type_id
-- set) -- a project-task entry's Task ID column shows the task's own
-- task_number instead, so it never needs one of these.
create or replace function assign_non_project_entry_number() returns trigger
language plpgsql as $$
begin
  if new.activity_type_id is not null and new.non_project_entry_number is null then
    new.non_project_entry_number := nextval('non_project_entry_number_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_non_project_entry_number on time_entries;
create trigger trg_assign_non_project_entry_number
  before insert on time_entries
  for each row execute function assign_non_project_entry_number();
