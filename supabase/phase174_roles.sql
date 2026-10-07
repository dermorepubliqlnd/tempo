-- phase174 (2026-10-08, Sandra): Roles & Permissions.
-- Roles are created in Site Settings > Roles & Permissions; each person gets
-- ONE role in User Management (no automatic roles, no per-person exceptions).
-- A role sets: Full Access, approval rights, admin pages, sidebar pages and
-- System Views. Assigning a role copies those into the person's existing
-- columns (access_level, can_approve_*, can_access_*, can_view_team_dashboard)
-- so every existing database rule keeps working unchanged.
-- Seeded so that everyone keeps EXACTLY the access they have today.

create table if not exists public.app_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order int not null default 0,
  full_access boolean not null default false,
  can_approve_start boolean not null default false,
  can_approve_close boolean not null default false,
  can_access_user_management boolean not null default false,
  can_access_reports boolean not null default false,
  can_access_site_settings boolean not null default false,
  pages jsonb not null default '{}'::jsonb,
  system_views jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.app_roles enable row level security;
drop policy if exists app_roles_select on public.app_roles;
create policy app_roles_select on public.app_roles for select to authenticated using (true);
drop policy if exists app_roles_write on public.app_roles;
create policy app_roles_write on public.app_roles for all to authenticated
  using (my_access_level() = 'full') with check (my_access_level() = 'full');

alter table public.people add column if not exists role_id uuid references public.app_roles(id) on delete restrict;

-- person <- role
create or replace function public.apply_role_to_person() returns trigger
language plpgsql security definer set search_path = public as $$
declare r app_roles;
begin
  if NEW.role_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW.role_id is not distinct from OLD.role_id and not coalesce(current_setting('app.role_resync', true), '') = 'on' then
    return NEW;
  end if;
  select * into r from app_roles where id = NEW.role_id;
  NEW.access_level := case when r.full_access then 'full' else 'limited' end;
  NEW.can_approve_rebaseline := r.can_approve_start;
  NEW.can_approve_closures := r.can_approve_close;
  NEW.can_access_user_management := r.can_access_user_management;
  NEW.can_access_reports := r.can_access_reports;
  NEW.can_access_site_settings := r.can_access_site_settings;
  NEW.can_view_team_dashboard := coalesce((r.pages ->> 'team_dashboard')::boolean, false);
  return NEW;
end $$;
drop trigger if exists zz_apply_role_to_person on public.people;
create trigger zz_apply_role_to_person before insert or update on public.people
  for each row execute function public.apply_role_to_person();

-- role edited -> everyone with that role updated
create or replace function public.resync_role_people() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.role_resync', 'on', true);
  update people set role_id = role_id where role_id = NEW.id;
  perform set_config('app.role_resync', 'off', true);
  return NEW;
end $$;
drop trigger if exists resync_role_people on public.app_roles;
create trigger resync_role_people after update on public.app_roles
  for each row execute function public.resync_role_people();

-- seeds (matching today's access exactly)
insert into public.app_roles (name, description, sort_order, full_access, can_approve_start, can_approve_close,
  can_access_user_management, can_access_reports, can_access_site_settings, pages, system_views)
values
 ('Team Member', 'Does the work: their own tasks and projects, logs time, requests extensions.', 1, false, false, false, false, false, false,
  '{"team_dashboard":false,"utilization":false,"productivity":false,"time_off":true,"archive":false,"knowledge_base":true,"feedback":true}',
  '["system_my_active_portfolio","system_my_full_portfolio","system_active_project_portfolio","system_tasks_my_open","system_tasks_my_calendar","system_tasks_my_done","system_tasks_owner_open","system_tasks_owner_at_risk"]'),
 ('Supervisor', 'Leads a team: approves their time, extensions and validations, sees team dashboards. Full Access.', 2, true, false, false, true, true, true,
  '{"team_dashboard":true,"utilization":true,"productivity":true,"time_off":true,"archive":true,"knowledge_base":true,"feedback":true}',
  '["system_my_active_portfolio","system_my_full_portfolio","system_active_project_portfolio","system_all_projects","system_tasks_my_open","system_tasks_my_calendar","system_tasks_owner_open","system_tasks_owner_at_risk","system_tasks_org_open"]'),
 ('Director', 'Runs L&D: everything a Supervisor has, plus approves Start Project and Close Project.', 3, true, true, true, true, true, true,
  '{"team_dashboard":true,"utilization":true,"productivity":true,"time_off":true,"archive":true,"knowledge_base":true,"feedback":true}',
  '["system_my_active_portfolio","system_my_full_portfolio","system_active_project_portfolio","system_all_projects","system_tasks_my_open","system_tasks_my_calendar","system_tasks_owner_open","system_tasks_owner_at_risk","system_tasks_org_open"]'),
 ('Executive', 'Leadership viewer: dashboards, reports and the whole portfolio. Full Access, no approvals.', 4, true, false, false, true, true, true,
  '{"team_dashboard":true,"utilization":true,"productivity":true,"time_off":true,"archive":false,"knowledge_base":true,"feedback":true}',
  '["system_active_project_portfolio","system_all_projects","system_tasks_org_open","system_tasks_my_open"]')
on conflict (name) do nothing;

-- assign everyone the role that matches their current access
update public.people p set role_id = r.id
  from public.app_roles r
 where p.role_id is null and p.is_active and r.name = case
   when p.access_level = 'full' and p.can_approve_rebaseline then 'Director'
   when p.access_level = 'full' and exists (select 1 from people x where x.reports_to = p.id and x.is_active) then 'Supervisor'
   when p.access_level = 'full' then 'Executive'
   else 'Team Member' end;
