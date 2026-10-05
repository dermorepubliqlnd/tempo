-- phase152 KB (2026-10-05): Sandra -- Training Delivery stays in the deck's
-- portfolio counts and mix; the Training delivery slide is the drill-down.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title in ('Operational Projects & Training Sessions', 'Reports — L&D Weekly Report (deck)');

update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = replace(content,
  'Operational projects are left out of the deck''s portfolio, health and mix slides.',
  'In the deck, operational projects still count in the Portfolio overview and Portfolio mix; only the date-based Active project health slide leaves them out. The Training delivery slide is the drill-down.')
where title = 'Operational Projects & Training Sessions';

update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = replace(content,
  'Training Delivery projects are operational, so they''re left out of the Portfolio overview, Active project health and Portfolio mix slides.',
  'Training Delivery projects still count in the **Portfolio overview** and **Portfolio mix** slides; this slide is their drill-down. Only **Active project health** leaves them out, since their health is always "Ongoing".')
where title = 'Reports — L&D Weekly Report (deck)';

select 'phase152' t,
 (select content like '%still count in the Portfolio overview%' from kb_entries where title = 'Operational Projects & Training Sessions') op,
 (select content like '%still count in the **Portfolio overview**%' from kb_entries where title = 'Reports — L&D Weekly Report (deck)') deck;
