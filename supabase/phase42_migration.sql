-- Phase 42 (2026-09-07): Parent task Status is now fully computed
-- Sandra (re: the "Revise deck" parent task in Dermorepubliq Corporate
-- 2026 Deck, blocked from Done by the logged-hours gate meant for leaf
-- tasks): "isn't [parent status] supposed to be In Progress if all sub
-- tasks are in progress or [some] done, and auto compute to Done when
-- all sub tasks are done?" Confirmed via AskUserQuestion: Not Started
-- only when EVERY child is Not Started, Done only when EVERY child is
-- Done, In Progress for any other mix -- and it's fully computed/
-- read-only from here on (no manual dropdown), matching how Work Type
-- and Dates/Scoped Hours already behave for parent rows in the app.
--
-- This is a one-time backfill of every EXISTING parent task's status to
-- match its current children -- going forward, the client
-- (recomputeAncestorStatus in Projects.tsx) keeps it in sync on every
-- child status change instead.
with child_agg as (
  select
    parent_task_id,
    bool_and(status = 'Done') as all_done,
    bool_and(status is null or status = 'Not Started') as all_not_started
  from tasks
  where parent_task_id is not null
  group by parent_task_id
)
update tasks t
set status = case
  when ca.all_done then 'Done'
  when ca.all_not_started then 'Not Started'
  else 'In Progress'
end
from child_agg ca
where t.id = ca.parent_task_id
  and t.status is distinct from (case
    when ca.all_done then 'Done'
    when ca.all_not_started then 'Not Started'
    else 'In Progress'
  end);
