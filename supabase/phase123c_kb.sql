-- Phase 123c KB: timers start from the "Start non-project timer" button
-- (Time Tracking + My Dashboard); Add Time is manual logging only.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where id = 'da3e192a-c6d0-4698-96b3-e980d02e3bd1';

update kb_entries set updated_at = now(), content =
  replace(replace(replace(replace(content,
    'Click **Add Time > Non-project**, then choose:', 'There are two ways to log it:'),
    '| **Start timer** |', '| **Start non-project timer** button (top of Time Tracking or My Dashboard) |'),
    '| **Log manual time** |', '| **Add Time > Non-project** (manual log) |'),
    '**Shortcut:** on My Dashboard, click **Start non-project timer** and pick the Activity Type. One click and it''s running.',
    '**Starting a timer:** click **Start non-project timer** at the top of Time Tracking or My Dashboard and pick the Activity Type. **Add Time** is for manual logs only (project or non-project).')
 where id = 'da3e192a-c6d0-4698-96b3-e980d02e3bd1';

select title, length(content), (content like '%Add Time** is for manual logs only%') ok from kb_entries where id = 'da3e192a-c6d0-4698-96b3-e980d02e3bd1';
