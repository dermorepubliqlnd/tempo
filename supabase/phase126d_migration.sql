-- phase126d (2026-09-30): per-person "Expected to log time" tag (User management).
alter table people add column if not exists tracks_time boolean not null default true;
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
update kb_entries set updated_at = now(), content = content || $md$

### Who counts toward expected hours
In **User management**, each person has an **Expected to log time** setting (default Yes). People set to **No** show a {neutral:No time logging} tag. They are left out of expected hours, "% of expected" and Missing Hours. Their capacity and utilization still count, and any time they do log still appears in Logged Hours.
$md$
 where title = 'Team Dashboard (L&D Executive Dashboard)' and content not like '%Who counts toward expected hours%';
select 'X' t, (select count(*) from people where tracks_time) trackers, (content like '%Who counts toward expected hours%') kb from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
