-- phase156 KB (2026-10-05): deck glance/portfolio/pipeline rules.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Reports — L&D Weekly Report (deck)';
update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = content || $md$

### Week at a glance, Portfolio overview and Starting this week (October 5 update)
- **Week at a glance** has two cards. **Delivery** lists the **projects completed last week**, each marked on time or late (no task counts). **Pipeline** covers projects starting, new intake and paused projects. The Utilization card was removed; last week's logged vs expected hours, unlogged hours by person and non-project time are now in the **Team utilization** slide's notes.
- **Portfolio overview** separates the numbers cleanly: **Total projects this year** (completed this year + open today), **Active projects** (In Progress project work as of today, the same number as the Health chart) and **Training Delivery** (ongoing, session-based training). **Portfolio movement** is a monthly line chart.
- **Starting this week** counts only projects whose **Start Project is approved**. Drafts planned for this week stay in the pipeline as "+N awaiting Start Project approval" and are listed in the notes.
$md$
where title = 'Reports — L&D Weekly Report (deck)' and content not like '%October 5 update%';
select 'phase156' t, (select content like '%October 5 update%' from kb_entries where title = 'Reports — L&D Weekly Report (deck)') ok;
