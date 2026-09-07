-- Phase 43 (2026-09-07): bugfix -- reopening a parent's own validation
-- left its (now fully computed, see phase42_migration.sql) Status
-- permanently stuck. Sandra: "reopening validation gets it back to In
-- Progress and can't be changed."
--
-- Root cause: the "Revise deck" parent task (Dermorepubliq Corporate
-- 2026 Deck) had been independently Validated, then Reopened -- both of
-- which only ever made sense for a leaf task's own reported work, not a
-- parent whose completion is entirely derived from its sub-tasks.
-- reopen_task's server-side "status = 'In Progress'" write bypassed the
-- client-side recomputeAncestorStatus cascade entirely (it's a plain
-- RPC call, not a client updateTask()), and with parent Status now
-- read-only in the UI (phase42), there was no way left to fix it by
-- hand. Fixed in code: parent rows are now excluded from Validate/
-- Reopen/Actual Completion Date entirely (Projects.tsx), same "N/A"
-- treatment Work Type already gets.
--
-- One-time data fixes:
-- 1. "Revise deck" itself: its own status was corrected back to Done
--    directly (all 4 of its sub-tasks are Done) via a separate ad-hoc
--    UPDATE run live in the SQL editor before this file was written.
-- 2. Any OTHER parent task anywhere in the DB that had picked up its own
--    validated_completion_date/validated_by/validated_locked_at (from
--    before this fix existed) gets it cleared here -- one row found live
--    ("Sprout HR EN Alpha Development" in the Revise: Sprout HR
--    project), also fixed ad-hoc before this file was written. This
--    statement is the durable, re-runnable version of that same fix.
select set_config('app.bypass_validation_rpc', 'on', true);

update tasks
set validated_completion_date = null, validated_by = null, validated_locked_at = null
where exists (select 1 from tasks c where c.parent_task_id = tasks.id)
  and (validated_completion_date is not null or validated_by is not null or validated_locked_at is not null);
