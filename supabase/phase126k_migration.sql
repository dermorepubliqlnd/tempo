-- phase126k (2026-10-01): once a project has started (WBS no longer Draft),
-- a leaf task's Assignee can be CHANGED but never REMOVED. Parent tasks
-- (have sub-tasks) and Cancelled tasks are exempt.
create or replace function prevent_assignee_removal_after_start() returns trigger
language plpgsql as $$
declare v_wbs text;
begin
  if OLD.assignee_id is not null and NEW.assignee_id is null
     and coalesce(NEW.status, '') <> 'Cancelled'
     and not coalesce(NEW.is_archived, false) then
    select wbs_status into v_wbs from projects where id = NEW.project_id;
    if coalesce(v_wbs, 'draft') <> 'draft'
       and not exists (select 1 from tasks c where c.parent_task_id = NEW.id and not coalesce(c.is_archived, false)) then
      raise exception 'This project has started -- a task''s Assignee can be changed to someone else, but not removed.';
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_prevent_assignee_removal_after_start on tasks;
create trigger trg_prevent_assignee_removal_after_start
  before update of assignee_id on tasks
  for each row execute function prevent_assignee_removal_after_start();

insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0';
update kb_entries set updated_at = now(), content = replace(content,
  'The Assignee rule is also enforced by the database, so it applies even if a request is made another way.',
  'The Assignee rule is also enforced by the database, so it applies even if a request is made another way. **After the project starts**, a task''s Assignee can be **changed** to someone else but never **removed** (parent and Cancelled tasks excepted).')
 where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0';
select 'X' t, (select count(*) from pg_trigger where tgname = 'trg_prevent_assignee_removal_after_start') trg,
 (select content like '%never **removed**%' from kb_entries where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0') kb;
