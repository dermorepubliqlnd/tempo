-- phase211 (2026-10-22, UAT): deleting a parent task with sub-tasks (e.g. Needs
-- Analysis) left the next step (Scope Statement) linked only to archived
-- tasks, so it showed "None". Re-link now walks back through archived tasks
-- to the nearest live ones (Discovery Call). Milestone links move the same way.
create or replace function public.trg_r2_close_chain_on_archive() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
begin
  if coalesce(old.is_archived, false) or not coalesce(new.is_archived, false) then return null; end if;
  if not exists (select 1 from projects where id = new.project_id and lifecycle_version = 2) then return null; end if;
  with recursive back(id) as (
    select d.depends_on_task_id from task_dependencies d where d.task_id = new.id
    union
    select d.depends_on_task_id
      from back b join tasks x on x.id = b.id and coalesce(x.is_archived, false)
      join task_dependencies d on d.task_id = b.id
  ), live_prev as (
    select b.id from back b join tasks x on x.id = b.id where not coalesce(x.is_archived, false)
  )
  insert into task_dependencies (task_id, depends_on_task_id)
  select nxt.task_id, lp.id
  from task_dependencies nxt
  join tasks t on t.id = nxt.task_id and not coalesce(t.is_archived, false)
  cross join live_prev lp
  where nxt.depends_on_task_id = new.id and nxt.task_id <> lp.id
  on conflict do nothing;

  with recursive back(id) as (
    select d.depends_on_task_id from task_dependencies d where d.task_id = new.id
    union
    select d.depends_on_task_id
      from back b join tasks x on x.id = b.id and coalesce(x.is_archived, false)
      join task_dependencies d on d.task_id = b.id
  )
  insert into milestone_dependencies (milestone_id, task_id)
  select md.milestone_id, b.id
  from milestone_dependencies md
  cross join back b
  join tasks pt on pt.id = b.id and not coalesce(pt.is_archived, false)
  where md.task_id = new.id
  on conflict do nothing;
  return null;
end;
$function$;

-- Repair: live tasks on new projects whose only links point at archived tasks
-- get linked to the nearest live predecessors.
with recursive stuck as (
  select t.id as task_id from tasks t join projects p on p.id = t.project_id
  where p.lifecycle_version = 2 and not coalesce(t.is_archived, false)
    and exists (select 1 from task_dependencies d join tasks a on a.id = d.depends_on_task_id where d.task_id = t.id and coalesce(a.is_archived, false))
    and not exists (select 1 from task_dependencies d join tasks a on a.id = d.depends_on_task_id where d.task_id = t.id and not coalesce(a.is_archived, false))
), walk(task_id, id) as (
  select s.task_id, d.depends_on_task_id from stuck s join task_dependencies d on d.task_id = s.task_id
  union
  select w.task_id, d.depends_on_task_id from walk w join tasks x on x.id = w.id and coalesce(x.is_archived, false)
    join task_dependencies d on d.task_id = w.id
)
insert into task_dependencies (task_id, depends_on_task_id)
select w.task_id, w.id from walk w join tasks x on x.id = w.id and not coalesce(x.is_archived, false)
where w.task_id <> w.id
on conflict do nothing;

select t.project_id, t.name, string_agg(p.name, ', ') as now_depends_on
from tasks t join task_dependencies d on d.task_id = t.id join tasks p on p.id = d.depends_on_task_id and not coalesce(p.is_archived, false)
join projects pr on pr.id = t.project_id
where pr.project_number = 128 group by t.project_id, t.name;
