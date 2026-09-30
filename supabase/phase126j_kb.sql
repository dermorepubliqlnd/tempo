insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0';
update kb_entries set updated_at = now(), content = content || $md$

### What's required before Start Project
A project can't be sent for baseline approval until:
- **Project:** Category, Source, Complexity and Description are filled in.
- **Every task:** has a real name, Scoped Hours, and an Output Type.
- **Every task has an Assignee** (added Oct 1, 2026). Tasks without one are invisible to Utilization and capacity planning. **Parent tasks are exempt** — they take their assignees from their sub-tasks, which can be different people. Cancelled tasks are skipped.

The Assignee rule is also enforced by the database, so it applies even if a request is made another way.
$md$
 where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0' and content not like '%What''s required before Start Project%';
select 'X' t, (content like '%What''s required before Start Project%') ok from kb_entries where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0';
