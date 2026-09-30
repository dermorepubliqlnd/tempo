-- phase126l (2026-10-01): a task created in a STARTED project (WBS not Draft)
-- must have an Assignee from the moment it's inserted.
create or replace function require_assignee_on_insert_after_start() returns trigger
language plpgsql as $$
declare v_wbs text;
begin
  if NEW.assignee_id is null and coalesce(NEW.status, '') <> 'Cancelled' then
    select wbs_status into v_wbs from projects where id = NEW.project_id;
    if coalesce(v_wbs, 'draft') <> 'draft' then
      raise exception 'This project has started -- new tasks need an Assignee.';
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_require_assignee_on_insert_after_start on tasks;
create trigger trg_require_assignee_on_insert_after_start
  before insert on tasks
  for each row execute function require_assignee_on_insert_after_start();
update kb_entries set updated_at = now(), content = replace(content,
  'a task''s Assignee can be **changed** to someone else but never **removed** (parent and Cancelled tasks excepted).',
  'a task''s Assignee can be **changed** to someone else but never **removed** (parent and Cancelled tasks excepted), and **any new task added to a started project must be assigned when it''s created** — Tempo asks you to pick the Assignee before the task is added.')
 where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0';
select 'X' t, (select count(*) from pg_trigger where tgname = 'trg_require_assignee_on_insert_after_start') trg,
 (select content like '%must be assigned when it''s created%' from kb_entries where id = 'be14889f-201d-4f67-a363-1cd1c0eacfc0') kb;
