-- Phase 51 migration (2026-09-21): Task "Created At" + "Created By" --
-- Sandra: a team member's Utilization looks fine when planned ahead, but
-- an urgent task added later that same day (with a due date that
-- overlaps a day already fully scoped) silently makes that day
-- overloaded in reality even though nothing on the schedule itself
-- "moved." She needs a way to tell "this task was planned last week" from
-- "this task was just added today" -- exactly what a creation timestamp
-- (and who created it) gives her.
--
-- tasks currently has NO created_at/created_by at all (confirmed live --
-- unlike projects, which already has both a created_at column and a
-- "Created" column in the UI). Adding both here, mirroring that shape.
--
-- Backfill for EXISTING tasks: a plain `default now()` on the ALTER would
-- stamp every pre-existing task with "right now" (Postgres evaluates a
-- volatile default like now() once per existing row at ALTER time), which
-- would make every task ever created look like it was added today --
-- exactly the false signal Sandra is trying to get AWAY from. Instead,
-- back-filling from `sort_order`, which createBlankTask/addSubtask have
-- always set to `Date.now()` (epoch milliseconds) at the moment a task is
-- created (see Projects.tsx) -- a real, if slightly noisy, proxy for the
-- original creation time, even for tasks manually reordered since (drag-
-- reorder only interpolates a NEW sort_order between its neighbors'
-- existing values, so it stays in the same epoch-ms neighborhood rather
-- than resetting to some arbitrary number). Only trusted when it falls in
-- a sane range (this app's earliest possible task is 2026-01-01); any
-- row outside that range (or with no sort_order) falls back to now() as
-- the least-bad guess for that handful of edge cases.
--
-- created_by has no historical signal to backfill from at all (nothing
-- has ever recorded who added a task) -- existing rows are left NULL,
-- rendering as "—" in the UI; only tasks created from here on will have
-- it populated (createBlankTask/addSubtask now pass created_by: my_person_id()-
-- equivalent, i.e. the signed-in person's id, on insert).

alter table tasks add column if not exists created_at timestamptz;
alter table tasks add column if not exists created_by uuid references people(id);

update tasks
set created_at = to_timestamp(sort_order / 1000.0)
where created_at is null
  and sort_order is not null
  and sort_order between 1735689600000 and (extract(epoch from now()) * 1000);

update tasks
set created_at = now()
where created_at is null;

alter table tasks alter column created_at set not null;
alter table tasks alter column created_at set default now();
