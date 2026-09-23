-- ============================================================
-- Phase 83 (2026-09-23): "My Work Today" -- Hide from Today.
--
-- A per-person-per-day dismissal for the new My Work Today section on
-- the Personal Dashboard. Deliberately its OWN small table, separate
-- from tasks/time_entries -- hiding a task from today's list must never
-- touch the task row itself (status, dates, assignee, planned hours,
-- utilization, reporting all stay exactly as they are), and must not
-- suppress the task from Needs My Attention / overdue anywhere else.
-- Confirmed via research this session: no existing hide/dismiss table
-- or pattern exists anywhere in the app to reuse.
-- ============================================================

create table if not exists task_daily_hidden (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  hidden_date date not null,
  created_at timestamptz not null default now(),
  unique (person_id, task_id, hidden_date)
);

alter table task_daily_hidden enable row level security;

-- Same broad `using (true)` convention as the app's other low-sensitivity
-- per-person preference tables (e.g. deleted_person_day_points) -- this
-- table holds no sensitive content (just "I hid task X on date Y"), and
-- the app already relies on client-side `isMe` gating rather than RLS
-- for this class of self-service preference (see person_availability).
create policy task_daily_hidden_select on task_daily_hidden for select using (true);
create policy task_daily_hidden_insert on task_daily_hidden for insert with check (true);
create policy task_daily_hidden_delete on task_daily_hidden for delete using (true);
