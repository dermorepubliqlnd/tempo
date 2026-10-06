-- phase158 (2026-10-06): Draft = Planning, pre-launch extras.
-- 1) projects.started_at: stamped when a project leaves Draft (Start Project
--    approved). Drives "New assignments" for contributors (7 days).
-- 2) project_activity: last planning activity per project (task insert/
--    update/delete or project update) -> "Idle 14+ days" on Draft reminders.
--    Separate table so no project lock triggers fire on task edits.
-- 3) my_planned_involvement(): project-level only (no tasks/dates/hours) for
--    contributors planned on Draft projects they can't see yet.

alter table public.projects add column if not exists started_at timestamptz;
update public.projects p set started_at = b.first_at
from (select project_id, min(captured_at) first_at from public.project_baselines group by 1) b
where b.project_id = p.id and p.started_at is null and coalesce(p.wbs_status, 'draft') <> 'draft';

create or replace function public.stamp_project_started_at() returns trigger
language plpgsql as $$
begin
  if coalesce(old.wbs_status, 'draft') = 'draft' and coalesce(new.wbs_status, 'draft') <> 'draft' and new.started_at is null then
    new.started_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stamp_project_started_at on public.projects;
create trigger trg_stamp_project_started_at before update of wbs_status on public.projects
for each row execute function public.stamp_project_started_at();

create table if not exists public.project_activity (
  project_id uuid primary key references public.projects(id) on delete cascade,
  last_activity_at timestamptz not null default now()
);
alter table public.project_activity enable row level security;
drop policy if exists project_activity_select on public.project_activity;
create policy project_activity_select on public.project_activity for select to authenticated using (true);

insert into public.project_activity (project_id, last_activity_at)
select p.id, greatest(p.created_at, coalesce(max(t.created_at), p.created_at))
from public.projects p left join public.tasks t on t.project_id = p.id
group by p.id
on conflict (project_id) do nothing;

create or replace function public.touch_project_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := case when tg_table_name = 'projects' then coalesce(new.id, old.id) else coalesce(new.project_id, old.project_id) end;
  if v_pid is not null then
    insert into public.project_activity (project_id, last_activity_at) values (v_pid, now())
    on conflict (project_id) do update set last_activity_at = excluded.last_activity_at;
  end if;
  return null;
exception when foreign_key_violation then
  return null;
end;
$$;
drop trigger if exists trg_touch_activity_tasks on public.tasks;
create trigger trg_touch_activity_tasks after insert or update or delete on public.tasks
for each row execute function public.touch_project_activity();
drop trigger if exists trg_touch_activity_projects on public.projects;
create trigger trg_touch_activity_projects after insert or update on public.projects
for each row execute function public.touch_project_activity();

create or replace function public.my_planned_involvement()
returns table (project_id uuid, project_number int, project_name text, owner_name text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, p.project_number::int, p.name, o.name
  from public.tasks t
  join public.projects p on p.id = t.project_id
  left join public.people o on o.id = p.owner_id
  where t.assignee_id = public.my_person_id()
    and not coalesce(t.is_archived, false)
    and coalesce(t.status, '') <> 'Cancelled'
    and not coalesce(p.is_archived, false)
    and not coalesce(p.is_unsaved, false)
    and coalesce(p.wbs_status, 'draft') = 'draft'
    and coalesce(p.status, '') <> 'Cancelled'
    and not public.can_see_project_plan(p.id)
$$;
grant execute on function public.my_planned_involvement() to authenticated;
