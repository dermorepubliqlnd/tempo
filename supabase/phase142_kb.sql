-- phase142 KB (2026-10-04): "→ *Article*" cross-references become clickable
-- "Related article:" links ([[Title]] syntax, rendered by KnowledgeBase.tsx).
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries
where content ~ '(^|\n)→ \*' or content like '%See **Notes on Projects & Tasks**%';

update kb_entries set updated_at = now(), content =
  regexp_replace(
    regexp_replace(content, '^→ \*([^*\n]+)\* · \*([^*\n]+)\*$', '**Related articles:** [[\1]] · [[\2]]', 'gn'),
    '^→ \*([^*\n]+)\*$', '**Related article:** [[\1]]', 'gn')
where content ~ '(^|\n)→ \*';

update kb_entries set updated_at = now(),
  content = replace(content, 'See **Notes on Projects & Tasks**.', 'See [[Notes on Projects & Tasks]].')
where content like '%See **Notes on Projects & Tasks**%';
