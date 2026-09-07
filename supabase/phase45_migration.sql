-- Phase 45 (2026-09-07): Actual Close Date + Lessons Learned on Closure --
-- Sandra: "confirm when the project was actually closed but capture sign
-- off date -- that's when the project was tagged as closed. But the
-- actual closed date is like validation, when it was really closed, as
-- the sign off maybe later. Say actual close was yesterday but just
-- signed off today." + "ask for lesson learned, what worked and what did
-- not work."
--
-- Sign Off date needs NO new column -- project_closeouts.closed_at
-- already captures exactly that (stamped by decide_wbs_closure at
-- approval time), it just wasn't surfaced anywhere in the WBS UI until
-- now (see WbsPlanning.tsx's new "Signed off ..." status-banner badge).
--
-- Actual Close Date is the new, distinct, requester-set date -- same
-- split as a task's actual_completion_date (when the work genuinely
-- wrapped) vs validated_completion_date (when a manager signed off on
-- it), just at the project level instead of the task level.
--
-- Lessons Learned is two free-text fields (What Worked / What Didn't
-- Work), Sandra's explicit choice over one combined field so closed
-- projects can be scanned for recurring themes later.
--
-- All three are required before closure can be requested or approved
-- (see handleRequestClosure/handleDecideClosure's missingProjectFields
-- gate in WbsPlanning.tsx), same treatment as Description.

alter table projects add column if not exists actual_close_date date;
alter table projects add column if not exists lessons_learned_worked text;
alter table projects add column if not exists lessons_learned_not_worked text;
