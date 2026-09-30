-- phase126i: data-cutoff note + setting rename in KB.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
update kb_entries set updated_at = now(), content = replace(replace(replace(content,
  'In **User management**, each person has an **Expected to log time** setting (default Yes). People set to **No** show a {neutral:No time logging} tag.',
  'In **User management**, each person has a **Capacity and Time Tracking** checkbox (default ticked). People unticked show an {neutral:Excluded} tag.'),
  '| **Logged Hours** | Finalized time only',
  '| **Logged Hours** | Counted from the Time tracking start date (see Data start date below). Finalized time only'),
  '### Comparison lines',
  $md$### Data start date: September 1, 2026
Tempo went live mid-September 2026. **August and early-September time logs were backtracked and entered manually during the migration, so their accuracy can't be guaranteed.** To keep the numbers trustworthy, **Expected Hours, Logged Hours, "% of expected" and Missing Hours only count from September 1, 2026.** Earlier logs still exist in Time Tracking, but the dashboard leaves them out.

The date is set in **Site settings → Time tracking start date** (Full Access). Project counts, Scoped Hours and Utilization are not affected.

### Comparison lines$md$)
 where title = 'Team Dashboard (L&D Executive Dashboard)';
select 'X' t, (content like '%Data start date: September 1, 2026%') a, (content like '%Capacity and Time Tracking** checkbox%') b, (content like '%Counted from the Time tracking start date%') c from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
