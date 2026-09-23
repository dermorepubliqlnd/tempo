-- Phase 67 (2026-09-23): Auto-generated Task ID
-- Sandra: "can we add task ids leaving it up to you to assign IDs to all
-- task existng. If deleted hard or soft, no need to reacyble the number
-- to not break sequence. a deleted will show as mssing task ID and it's
-- ok." -- exactly the same idea as project_number (see phase41_migration.sql),
-- applied to tasks. tasks.created_at already exists (default now()) --
-- no backfill of created_at is needed here, unlike phase41's project_number
-- (projects had no created_at at all at the time).
--
-- task_number: a stable integer assigned once to existing tasks by
-- row_number() over (order by created_at, id) -- earliest created_at gets
-- #1 -- then driven by a real sequence for every task created from here
-- on. Because it's a real sequence (never reused, nextval always issues
-- a number after the highest one handed out), a hard-deleted OR archived
-- task simply leaves a gap -- exactly what Sandra asked for, no special
-- handling needed. Display format (mirrors Project ID): "T-0007"
-- (4-digit, zero-padded).

-- Backfilling task_number is an UPDATE on every task row, including ones
-- that belong to a closed project -- enforce_closed_project_lock()
-- (phase26_migration.sql) blocks exactly that ("this project is closed
-- -- its tasks are final and can no longer be added or changed"). This
-- migration is a one-time system backfill, not a real edit to a closed
-- project's plan, so bypass it the same way phase65's archive_time_entry
-- bypasses enforce_time_entry_lock. 'false' (not 'true') so it holds for
-- the whole session/script, not just one statement/transaction.
select set_config('app.bypass_closed_project_lock', 'on', false);

alter table tasks add column if not exists task_number integer;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn from tasks
)
update tasks t set task_number = numbered.rn from numbered where numbered.id = t.id and t.task_number is null;

create sequence if not exists task_number_seq;
select setval('task_number_seq', coalesce((select max(task_number) from tasks), 0) + 1, false);

alter table tasks alter column task_number set default nextval('task_number_seq');
alter table tasks alter column task_number set not null;

create unique index if not exists tasks_task_number_key on tasks(task_number);

select set_config('app.bypass_closed_project_lock', 'off', false);
