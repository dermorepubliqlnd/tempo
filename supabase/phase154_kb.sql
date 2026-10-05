-- phase154 KB (2026-10-05): one rule everywhere -- Training Delivery projects
-- COUNT in portfolio numbers (dashboards + deck); only Health leaves them out.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title in ('Operational Projects & Training Sessions', 'Reports — L&D Weekly Report (deck)');

update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = replace(content,
  '| **Projects Portfolio KPIs and health** | Included | Kept out; shown in the **Training Delivery** section |',
  '| **Portfolio counts** (Executive Dashboard, Projects Portfolio, weekly deck) | Included | **Included**, marked "incl. N Training Delivery" |
| **Health charts and Overdue** | Included | Left out (health is always "Ongoing"), with a note "excludes N Training Delivery" |')
where title = 'Operational Projects & Training Sessions';

update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = replace(content,
  'Both slides now say so, and so do the notes.',
  'Both slides now say so, and so do the notes. The Executive Dashboard and Projects Portfolio follow the same rule. Projects planned to start this week but **Paused** are listed under Paused, not under Starting this week.')
where title = 'Reports — L&D Weekly Report (deck)';

select 'phase154' t,
 (select content like '%marked "incl. N Training Delivery"%' from kb_entries where title = 'Operational Projects & Training Sessions') op,
 (select content like '%follow the same rule%' from kb_entries where title = 'Reports — L&D Weekly Report (deck)') deck;
