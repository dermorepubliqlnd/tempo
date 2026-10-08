-- phase176 HOTFIX (2026-10-08, P-0031): a sub-task depended on its OWN parent
-- (T-0685 -> T-0684). The link was made while T-0685 was still top-level,
-- then the task was moved under T-0684. The WBS forecast then chased itself:
-- the parent's end = max(children), and the child starts after the parent
-- ends, so every render pushed the dates further (forecast grew like a timer)
-- and a task saved during that time got a 2028 start date.
--
-- DB guard for every path (WBS, Projects page, RPCs):
--  1) a dependency between a task and its own parent/sub-task is refused;
--  2) moving a task under a parent drops any dependency between the two.

create or replace function public.refuse_parent_child_dependency() returns trigger
language plpgsql as $$
begin
  if new.task_id = new.depends_on_task_id then
    raise exception 'A task can''t depend on itself.';
  end if;
  if exists (select 1 from public.tasks a join public.tasks b on b.id = new.depends_on_task_id
              where a.id = new.task_id and (a.parent_task_id = b.id or b.parent_task_id = a.id)) then
    raise exception 'A parent task and its own sub-task can''t depend on each other -- the parent''s dates already come from its sub-tasks.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_refuse_parent_child_dependency on public.task_dependencies;
create trigger trg_refuse_parent_child_dependency
  before insert or update on public.task_dependencies
  for each row execute function public.refuse_parent_child_dependency();

create or replace function public.drop_parent_child_dependency_on_move() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_task_id is not null and new.parent_task_id is distinct from old.parent_task_id then
    delete from public.task_dependencies
     where (task_id = new.id and depends_on_task_id = new.parent_task_id)
        or (task_id = new.parent_task_id and depends_on_task_id = new.id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_drop_parent_child_dependency_on_move on public.tasks;
create trigger trg_drop_parent_child_dependency_on_move
  after update of parent_task_id on public.tasks
  for each row execute function public.drop_parent_child_dependency_on_move();

-- Data fix applied 2026-10-08: removed T-0685 -> T-0684; T-0693 start 2028-07-04
-- -> 2026-10-08 (start/full/standard); T-0685 forecast starts 2027-02 -> 2026-10-08.
