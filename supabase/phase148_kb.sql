-- phase148 KB (2026-10-04): release note mentions KB IDs + related links.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'October 4 Release';
update kb_entries set updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1),
  content = replace(content, '### Rules that keep the data honest', $md$### Knowledge Base articles now have IDs
Every article has a permanent ID like **KB-0012**, shown next to its title. Search by the ID to jump straight to it, and use **Related article** links at the end of sections to open connected articles.

### Rules that keep the data honest$md$)
where title = 'October 4 Release' and content not like '%articles now have IDs%';
