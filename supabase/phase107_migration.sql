-- Phase 107 (2026-09-24): Knowledge Base redesign (search-first home,
-- topic cards, Frequently Used, Recently Updated). Three optional,
-- additive fields -- nothing existing changes:
--   kb_categories.description / icon / color  (topic cards)
--   kb_entries.is_pinned                       (Frequently Used)
alter table kb_categories add column if not exists description text;
alter table kb_categories add column if not exists icon text;
alter table kb_categories add column if not exists color text;
alter table kb_entries add column if not exists is_pinned boolean not null default false;

-- Starter descriptions/icons for existing topics (only fills blanks).
update kb_categories k set
  description = coalesce(k.description, v.description),
  icon = coalesce(k.icon, v.icon),
  color = coalesce(k.color, v.color)
from (values
  ('Projects', 'Project setup, task management and project-related guides.', 'Folder', 'accent'),
  ('Time Tracking', 'Logging time, corrections and time-related processes.', 'Clock', 'purple'),
  ('Productivity', 'Logged hours, productivity views and reporting.', 'BarChart3', 'success'),
  ('Access & Permissions', 'Roles, approval rights and access rules.', 'Lock', 'gold'),
  ('Utilization', 'Capacity, scheduled hours and utilization.', 'Gauge', 'accent'),
  ('Time Off & Holidays', 'Time off, holidays and non-working days.', 'Palmtree', 'pink')
) as v(name, description, icon, color)
where k.name = v.name;

-- Starter Frequently Used pins.
update kb_entries set is_pinned = true
 where title in ('Approval Rights & Permissions Matrix', 'Daily Activity & Per Task Views', 'Non-Project Time', 'Properties');
