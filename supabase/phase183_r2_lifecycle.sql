-- phase183 (2026-10-13, Sandra): R2.1 L&D lifecycle -- phases + milestones.
-- NEW PROJECTS ONLY (projects.lifecycle_version = 2). Existing projects keep
-- lifecycle_version NULL and behave exactly as before.
--
-- Additive only, safe to run while main is live:
--   * lifecycle_phases lookup (5 standard phases, mapped to today's
--     project_phases names; renamed later in phase183b at release)
--   * projects.lifecycle_version (default 2 for NEW rows only)
--   * tasks.wbs_phase (which phase group a task sits in)
--   * project_milestones (one per phase; owner chooses which phases apply
--     while Draft -- "not every project needs scoping or design")
--   * milestone_dependencies (the tasks a milestone waits for)
--   * r2_recompute(project): marks milestones reached and moves the
--     project's Phase forward, skipping phases the project doesn't use.

-- 1. Phases -----------------------------------------------------------
create table if not exists public.lifecycle_phases (
  key text primary key,
  label text not null,
  sort_order int not null,
  project_phase text not null,          -- value written to projects.phase
  milestone_name text not null,
  milestone_kind text not null check (milestone_kind in ('start', 'deliverables', 'close'))
);
insert into public.lifecycle_phases (key, label, sort_order, project_phase, milestone_name, milestone_kind) values
  ('analysis',    'Analysis & Scoping',        1, 'Scoping',     'Scope Confirmed',    'start'),
  ('design',      'Learning Design',           2, 'Design',      'Design Approved',    'deliverables'),
  ('development', 'Learning Development',      3, 'Development', 'Materials Approved', 'deliverables'),
  ('delivery',    'Implementation / Delivery', 4, 'Delivery',    'Program Delivered',  'deliverables'),
  ('evaluation',  'Evaluation & Closure',      5, 'Evaluation',  'Project Closed',     'close')
on conflict (key) do nothing;
alter table public.lifecycle_phases enable row level security;
drop policy if exists lifecycle_phases_select on public.lifecycle_phases;
create policy lifecycle_phases_select on public.lifecycle_phases for select to authenticated using (true);
drop policy if exists lifecycle_phases_write on public.lifecycle_phases;
create policy lifecycle_phases_write on public.lifecycle_phases for all to authenticated
  using (public.my_access_level() = 'full') with check (public.my_access_level() = 'full');

-- 2. New columns -------------------------------------------------------
-- Added without a default first so EXISTING rows stay NULL (old model);
-- the default then applies to new projects only.
alter table public.projects add column if not exists lifecycle_version smallint;
alter table public.projects alter column lifecycle_version set default 2;
alter table public.tasks add column if not exists wbs_phase text references public.lifecycle_phases(key);

-- 3. Milestones --------------------------------------------------------
create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase_key text not null references public.lifecycle_phases(key),
  name text not null,
  kind text not null check (kind in ('start', 'deliverables', 'close')),
  sort_order int not null,
  is_included boolean not null default true,   -- false = this project skips the phase
  reached_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, phase_key)
);
create index if not exists project_milestones_project_idx on public.project_milestones(project_id);

create table if not exists public.milestone_dependencies (
  milestone_id uuid not null references public.project_milestones(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  primary key (milestone_id, task_id)
);
create index if not exists milestone_dependencies_task_idx on public.milestone_dependencies(task_id);

alter table public.project_milestones enable row level security;
alter table public.milestone_dependencies enable row level security;
drop policy if exists project_milestones_select on public.project_milestones;
create policy project_milestones_select on public.project_milestones for select to authenticated
  using (public.can_see_project(project_id) and public.can_see_project_plan(project_id));
drop policy if exists project_milestones_write on public.project_milestones;
create policy project_milestones_write on public.project_milestones for all to authenticated
  using (public.can_manage_wbs(project_id)) with check (public.can_manage_wbs(project_id));
drop policy if exists milestone_dependencies_select on public.milestone_dependencies;
create policy milestone_dependencies_select on public.milestone_dependencies for select to authenticated
  using (exists (select 1 from public.project_milestones m where m.id = milestone_id
                 and public.can_see_project(m.project_id) and public.can_see_project_plan(m.project_id)));
drop policy if exists milestone_dependencies_write on public.milestone_dependencies;
create policy milestone_dependencies_write on public.milestone_dependencies for all to authenticated
  using (exists (select 1 from public.project_milestones m where m.id = milestone_id and public.can_manage_wbs(m.project_id)))
  with check (exists (select 1 from public.project_milestones m where m.id = milestone_id and public.can_manage_wbs(m.project_id)));

-- Phase choices lock at Start Project (changes after that go through a WBS revision later).
create or replace function public.r2_guard_milestone_scope() returns trigger
language plpgsql as $$
declare v_status text;
begin
  if new.is_included is distinct from old.is_included then
    select coalesce(wbs_status, 'draft') into v_status from public.projects where id = new.project_id;
    if v_status <> 'draft' and coalesce(current_setting('app.r2_internal', true), '') <> 'on' then
      raise exception 'The phases for this project were set at Start Project and can''t be changed now.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_r2_guard_milestone_scope on public.project_milestones;
create trigger trg_r2_guard_milestone_scope before update on public.project_milestones
  for each row execute function public.r2_guard_milestone_scope();

-- 4. Seed the five milestones for every new (v2) project ------------------
create or replace function public.r2_seed_milestones(p_project_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into project_milestones (project_id, phase_key, name, kind, sort_order)
  select p_project_id, key, milestone_name, milestone_kind, sort_order from lifecycle_phases
  on conflict (project_id, phase_key) do nothing;
$$;

-- 5. Recompute milestones + Phase ------------------------------------------
create or replace function public.r2_recompute(p_project_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p record;
  v_phase text;
begin
  select id, lifecycle_version, coalesce(wbs_status, 'draft') as wbs_status, status, phase
    into p from projects where id = p_project_id;
  if p.id is null or p.lifecycle_version is distinct from 2 then return; end if;
  perform set_config('app.r2_internal', 'on', true);

  -- Start gate: reached once Start Project is approved.
  update project_milestones set reached_at = case when p.wbs_status <> 'draft' then coalesce(reached_at, now()) end
   where project_id = p_project_id and kind = 'start';
  -- Close gate: reached once the project is closed.
  update project_milestones set reached_at = case when p.wbs_status = 'closed' then coalesce(reached_at, now()) end
   where project_id = p_project_id and kind = 'close';
  -- Deliverable milestones: reached when they have at least one linked task
  -- and every linked (non-archived) task is Done or Cancelled.
  update project_milestones m set reached_at =
    case when p.wbs_status <> 'draft'
          and exists (select 1 from milestone_dependencies d join tasks t on t.id = d.task_id
                      where d.milestone_id = m.id and not coalesce(t.is_archived, false))
          and not exists (select 1 from milestone_dependencies d join tasks t on t.id = d.task_id
                          where d.milestone_id = m.id and not coalesce(t.is_archived, false)
                            and coalesce(t.status, '') not in ('Done', 'Cancelled'))
         then coalesce(m.reached_at, now()) end
   where m.project_id = p_project_id and m.kind = 'deliverables';

  -- Phase: only while Active (Draft / Closed keep the existing stage rules;
  -- Paused / Cancelled freeze Phase where it is).
  if p.wbs_status in ('draft', 'closed') or coalesce(p.status, '') in ('Paused', 'Cancelled') then return; end if;
  select lp.project_phase into v_phase
    from project_milestones m join lifecycle_phases lp on lp.key = m.phase_key
   where m.project_id = p_project_id and m.is_included and m.kind <> 'start' and m.reached_at is null
   order by m.sort_order limit 1;
  if v_phase is null then  -- every included phase is done: sit in the last included one until Close
    select lp.project_phase into v_phase
      from project_milestones m join lifecycle_phases lp on lp.key = m.phase_key
     where m.project_id = p_project_id and m.is_included and m.kind <> 'start'
     order by m.sort_order desc limit 1;
  end if;
  if v_phase is not null and v_phase is distinct from p.phase then
    update projects set phase = v_phase where id = p_project_id;
  end if;
end;
$$;
grant execute on function public.r2_recompute(uuid) to authenticated;

-- 6. Triggers ----------------------------------------------------------------
create or replace function public.trg_r2_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.lifecycle_version = 2 then perform public.r2_seed_milestones(new.id); end if;
    return null;
  end if;
  perform public.r2_recompute(new.id);
  return null;
end;
$$;
drop trigger if exists trg_r2_project_ins on public.projects;
create trigger trg_r2_project_ins after insert on public.projects
  for each row execute function public.trg_r2_project();
drop trigger if exists trg_r2_project_upd on public.projects;
create trigger trg_r2_project_upd after update of wbs_status, status on public.projects
  for each row when (new.lifecycle_version = 2) execute function public.trg_r2_project();

create or replace function public.trg_r2_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform public.r2_recompute(old.project_id); end if;
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then perform public.r2_recompute(new.project_id); end if;
  return null;
end;
$$;
drop trigger if exists trg_r2_task_upd on public.tasks;
create trigger trg_r2_task_upd after update of status, is_archived, project_id on public.tasks
  for each row execute function public.trg_r2_task();
drop trigger if exists trg_r2_task_del on public.tasks;
create trigger trg_r2_task_del after delete on public.tasks
  for each row execute function public.trg_r2_task();

create or replace function public.trg_r2_milestone_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_mid uuid := coalesce(new.milestone_id, old.milestone_id);
begin
  perform public.r2_recompute((select project_id from project_milestones where id = v_mid));
  return null;
end;
$$;
drop trigger if exists trg_r2_milestone_dep on public.milestone_dependencies;
create trigger trg_r2_milestone_dep after insert or delete on public.milestone_dependencies
  for each row execute function public.trg_r2_milestone_change();

create or replace function public.trg_r2_milestone_scope() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.r2_internal', true), '') <> 'on' then perform public.r2_recompute(new.project_id); end if;
  return null;
end;
$$;
drop trigger if exists trg_r2_milestone_scope on public.project_milestones;
create trigger trg_r2_milestone_scope after update of is_included on public.project_milestones
  for each row execute function public.trg_r2_milestone_scope();
