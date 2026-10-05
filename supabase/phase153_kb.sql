-- phase153 KB (2026-10-05): weekly deck speaker notes + Active vs health count.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Reports — L&D Weekly Report (deck)';
update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = content || $md$

### Speaker notes on every slide
Each slide's **Notes** (in PowerPoint) list the names and reasons behind its numbers, so you can answer follow-up questions. For example:
- **Week at a glance:** projects completed (on time or late), tasks done by project, tasks finished after their due date, who has 2h+ not logged, non-project time by activity, tasks that ran 25%+ over estimate, projects starting this week, new intake, and paused projects with **pause reason** and expected resume. The **Asks for Brad** are added at the end.
- **Active project health:** overdue projects with **why they slipped** (scope added, date changes, extension reasons, notes), plus off track, at risk, close pending and due this week.
- **Pipeline, Utilization, Training delivery:** the projects, people and sessions behind each count.

Open **Speaker notes** on the Reports page to read or edit them before you click Generate.

### Why Active (Portfolio overview) and the Health count differ
**Active** on the Portfolio overview counts every In Progress project, including Training Delivery projects. **Active project health** leaves out Training Delivery projects because their health is always "Ongoing". For example, 18 active with 12 on the health slide means 6 are Training Delivery. Both slides now say so, and so do the notes.
$md$
where title = 'Reports — L&D Weekly Report (deck)' and content not like '%Speaker notes on every slide%';
select 'phase153' t, (select content like '%Speaker notes on every slide%' from kb_entries where title = 'Reports — L&D Weekly Report (deck)') ok;
