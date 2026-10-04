-- phase146 KB (Sandra, 2026-10-04): drop the "stop running timers" line
-- (timers don't auto-stop at sign-out, so don't imply anything about them).
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries
where title in ('October 4 Release', 'Signing In & Automatic Sign-Out');

update kb_entries set updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1),
  content = replace(content, ' Stop running timers before you finish.', '')
where title = 'October 4 Release';

update kb_entries set updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1),
  content = replace(content, E'\n\n**Running timers are not stopped by sign-out.** Stop your timer before you finish for the day.', '')
where title = 'Signing In & Automatic Sign-Out';
