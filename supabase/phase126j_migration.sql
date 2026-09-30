-- phase126j (2026-10-01): a baseline (Start Project) can't be requested or
-- approved while any LEAF task has no assignee. Parent tasks (have
-- sub-tasks) are exempt; archived/Cancelled tasks skip.
create or replace function baseline_request_requires_assignees() returns trigger
language plpgsql as $$
declare n int;
begin
  if NEW.status in ('pending','approved') and (TG_OP = 'INSERT' or OLD.status is distinct from NEW.status) then
    select count(*) into n from tasks t
     where t.project_id = NEW.project_id
       and not coalesce(t.is_archived, false)
       and coalesce(t.status, '') <> 'Cancelled'
       and t.assignee_id is null
       and not exists (select 1 from tasks c where c.parent_task_id = t.id and not coalesce(c.is_archived, false));
    if n > 0 then
      raise exception '% task(s) still need an Assignee before this project can start (parent tasks are exempt)', n;
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_baseline_request_requires_assignees on project_baseline_requests;
create trigger trg_baseline_request_requires_assignees
  before insert or update of status on project_baseline_requests
  for each row execute function baseline_request_requires_assignees();
select 'X' t, (select count(*) from pg_trigger where tgname = 'trg_baseline_request_requires_assignees') trg,
  (select string_agg(title, ' ; ') from kb_entries where content ilike '%Output Type%' and content ilike '%Start Project%') kb_hits;
