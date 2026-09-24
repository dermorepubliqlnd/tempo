-- Phase 115 (2026-09-24): KB Properties -> Health definition updated for
-- Completed on time / Completed late / Work complete (Health stays computed
-- on screen; no schema change). Old wording kept in History.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Properties' and not is_archived;

update kb_entries set content = replace(content,
$old$**Formula:**
- Completed or Cancelled status → shows the status itself (no health calculation needed)
- Paused → {purple:Paused}
- Still in Draft (before baseline approval) → {neutral:Not started}, regardless of dates
- Task progress has reached 100% → {success:Completed}$old$,
$new$**Formula:**
- **Completed** status → the final schedule outcome, comparing the project's completion date (the latest Actual Completion Date of its Done tasks) with its End Date (which already reflects any approved Rebaseline or Project Timeline Extension):
  - finished on or before the End Date → {success:Completed on time}
  - finished after the End Date → {gold:Completed late}
  - still has open tasks → {warning:Completed – open tasks} (finish or cancel them, or set the project back to In Progress)
- **Cancelled** status → shows {neutral:Cancelled}
- Paused → {purple:Paused}
- Still in Draft (before baseline approval) → {neutral:Not started}, regardless of dates
- Task progress has reached 100% but Status isn't Completed yet → {success:Work complete} (set Status to Completed)$new$),
  updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
where title = 'Properties' and not is_archived;
