-- phase126h: not-expected-to-log people also leave Utilization / capacity. Expected hours from Sep 1.
update app_settings set time_tracking_start_date = '2026-09-01' where id = true;
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
update kb_entries set updated_at = now(), content = replace(content,
  'They are left out of expected hours, "% of expected" and Missing Hours. Their capacity and utilization still count, and any time they do log still appears in Logged Hours.',
  'They are left out of expected hours, "% of expected", Missing Hours, **and** Utilization / capacity (Planned Utilization, Available Capacity, Overallocated Members, and the Utilization page). Any time they do log still appears in Logged Hours.')
 where title = 'Team Dashboard (L&D Executive Dashboard)';
select 'X' t, (content like '%and** Utilization / capacity%') ok from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
