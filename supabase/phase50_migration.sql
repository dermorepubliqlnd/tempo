-- Phase 50 migration (2026-09-21): Project Type -- admin-configurable
-- lookup for "is this project BAU (operational -- running already-built
-- training sessions, or a program deployment/rollout) or Development
-- (building new content)" (Sandra: "I want to add another project type
-- or tagging if it's BAU or Development"). Mirrors project_planning_types'
-- own table/RLS shape exactly (see phase38_migration.sql) -- a real FK
-- lookup (not a plain-text tag like Category/Phase) so a future rename
-- never needs the cascade-rename machinery those two required, and so
-- Sandra can add more values later (e.g. a separate "Program Deployment"
-- tier) from Site Settings without any code change. Seeded with the 2
-- values she asked for (BAU / Development).

create table if not exists project_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

alter table project_types enable row level security;

drop policy if exists project_types_select on project_types;
create policy project_types_select on project_types for select using (true);

drop policy if exists project_types_insert on project_types;
create policy project_types_insert on project_types for insert
  with check (my_access_level() = 'full');

drop policy if exists project_types_update on project_types;
create policy project_types_update on project_types for update
  using (my_access_level() = 'full')
  with check (my_access_level() = 'full');

drop policy if exists project_types_delete on project_types;
create policy project_types_delete on project_types for delete
  using (my_access_level() = 'full');

insert into project_types (name, sort_order) values
  ('BAU', 1),
  ('Development', 2)
on conflict (name) do nothing;

alter table projects add column if not exists project_type_id uuid references project_types(id);
