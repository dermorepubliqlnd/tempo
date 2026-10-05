-- phase155 KB (2026-10-05): weekly deck slides 3-4 redesigned (YTD).
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Reports — L&D Weekly Report (deck)';
update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = content || $md$

### Portfolio overview and Work mix (year to date)
- **Portfolio overview** shows **Total projects year to date** (completed in the year + open projects started by the report week's Friday) and **Active now**. Active includes ongoing Training Delivery projects, with a soft note saying how many. Next to them is **Portfolio movement**, the projects started vs. completed **per month** (months before Tempo has any data are skipped). Completed, Not started, Paused and Overdue cards were removed from this slide.
- **Work mix & effort allocation** comes right after. On the left is a stacked bar of **Scoped Hours year to date by Project Type, split by Planning Type**, using the same method as the Executive Dashboard: task estimates spread over working days, counting only days this year. On the right are **Active project health** and **Active project phase** for In Progress projects, excluding Training Delivery. This replaces the old Portfolio mix (Development vs Trainer) slide.
$md$
where title = 'Reports — L&D Weekly Report (deck)' and content not like '%Work mix & effort allocation** comes right after%';
select 'phase155' t, (select content like '%Work mix & effort allocation** comes right after%' from kb_entries where title = 'Reports — L&D Weekly Report (deck)') ok;
