-- phase129: "Re-baseline" approval right relabeled "Project Start"
-- (label only; column can_approve_rebaseline unchanged). KB text synced.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries
where not is_archived and content ilike '%re-baseline%';

update kb_entries set content =
  replace(replace(replace(replace(content,
    '(Start Project / Re-baseline)', '(Start Project)'),
    '{accent:Re-baseline}', '{accent:Project Start}'),
    '**Re-baseline** and **Project Close** checkboxes', '**Project Start** and **Project Close** checkboxes'),
    'Re-baseline right', 'Project Start right'),
  updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
where not is_archived and content ilike '%re-baseline%';

-- leftovers to review
select title, substring(content from greatest(position('Re-baseline' in content) - 80, 1) for 200) as ctx
from kb_entries where not is_archived and content ilike '%re-baseline%';
