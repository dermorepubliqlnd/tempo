-- Phase 55 migration (2026-09-21): Knowledge Base.
--
-- Sandra: "next we want to create some sort of a knowledge base. starting
-- off with definitions of properties... Add a knowledge base page
-- accessible to everyone, then start Project then properties of a
-- project." -- a top-level reference area, readable by every logged-in
-- user, organized as Categories > Entries (starting with a "Projects"
-- category and a "Properties" entry defining every Project field).
--
-- Editable in-app (not developer-maintained) per Sandra: "in app editor
-- but start off now in app editor for the future" -- so Full Access
-- people can create/edit entries themselves without a code change, same
-- as every other admin-configurable list in this app (Categories,
-- Sources, Work Types, etc. in SiteSettings.tsx). Edit access is Full
-- Access only (her explicit answer), read access is everyone (select
-- using (true), same convention as baseline_decline_reasons in
-- phase46_migration.sql).
--
-- kb_entry_versions is a lightweight snapshot-on-edit history so an
-- in-app edit never silently destroys the prior wording -- the client
-- inserts the entry's current row here immediately before applying an
-- update (see KnowledgeBase.tsx). Versions are Full-Access-only to read
-- (it's an editorial audit trail, not end-user-facing content).

create table if not exists kb_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references people(id)
);

alter table kb_categories enable row level security;

create policy kb_categories_select on kb_categories for select using (true);
create policy kb_categories_insert on kb_categories for insert with check (my_access_level() = 'full');
create policy kb_categories_update on kb_categories for update using (my_access_level() = 'full') with check (my_access_level() = 'full');
create policy kb_categories_delete on kb_categories for delete using (my_access_level() = 'full');

create table if not exists kb_entries (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references kb_categories(id) on delete cascade,
  title text not null,
  -- markdown-lite: #/##/### headers, **bold**, *italic*, "- " bullets,
  -- "1. " numbered lists, "| a | b |" tables, blank-line paragraphs --
  -- rendered client-side, no HTML/rich-text stored (matches the
  -- plain-text-body convention already used for project notes, see
  -- NotesSidebar.tsx).
  content text not null default '',
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references people(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references people(id)
);

-- lets a seed insert use ON CONFLICT to stay idempotent if this file is re-run
alter table kb_entries add constraint kb_entries_category_title_key unique (category_id, title);

alter table kb_entries enable row level security;

create policy kb_entries_select on kb_entries for select using (true);
create policy kb_entries_insert on kb_entries for insert with check (my_access_level() = 'full');
create policy kb_entries_update on kb_entries for update using (my_access_level() = 'full') with check (my_access_level() = 'full');
create policy kb_entries_delete on kb_entries for delete using (my_access_level() = 'full');

create table if not exists kb_entry_versions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references kb_entries(id) on delete cascade,
  title text not null,
  content text not null,
  edited_at timestamptz not null default now(),
  edited_by uuid references people(id)
);

alter table kb_entry_versions enable row level security;

create policy kb_entry_versions_select on kb_entry_versions for select using (my_access_level() = 'full');
create policy kb_entry_versions_insert on kb_entry_versions for insert with check (my_access_level() = 'full');

-- Seed: Projects > Properties -- definitions for every field shown on
-- the Projects table/WBS page, grounded in how each one actually behaves
-- in this app (not generic PM glossary text).
insert into kb_categories (name, sort_order) values ('Projects', 1)
on conflict (name) do nothing;

insert into kb_entries (category_id, title, content, sort_order)
select id, 'Properties', $md$## Project Properties

Definitions for every field on the Projects table and WBS page.

| Property | Definition |
|---|---|
| **Project ID** | Auto-generated identifier (e.g. P-0001), assigned once at Start Project. Not editable. |
| **Description** | Required free-text summary of what the project is and why it exists. Required at Start Project and again at Closure. |
| **Status** | The project's lifecycle state: Not Started, In Progress, Completed, Paused, or Cancelled. Locked to "Not Started" while the project is still in Draft (before baseline approval). |
| **Phase** | The current stage of work within Status (e.g. Queued, Scoping, Design, Development, Evaluation, Done). Editable only while a project is in Draft/Not Started; after baseline lock it advances automatically based on task progress. |
| **Health** | A computed indicator of whether the project is tracking to plan: On Track, Off Track, Overdue, or At Risk. Derived from due dates and task status, not manually set. |
| **Priority** | A relative urgency marker (shown as an up/down/level arrow) used to help the team decide what to work on first. |
| **Actual Progress** | The percentage of the project's scoped work that is complete, rolled up from task completion. |
| **Planning Type** | Whether the project was Planned (scoped and scheduled in advance) or Ad Hoc (raised outside the normal planning cycle). |
| **Project Type** | Whether the work is BAU (business-as-usual, recurring) or Development (new/one-off build work). |
| **Owner** | The person accountable for the project overall -- distinct from a task Assignee, who owns an individual task within it. |
| **Category** | An admin-configurable tag describing the subject area of the work (e.g. Onboarding, Leadership, Technical & Systems). Managed in Site Settings. |
| **Source** | Where the project request originated -- e.g. L&D Initiative (internal, planned) or Intake (an external/ad hoc request). Managed in Site Settings. |
| **Complexity** | A scoping-time estimate of how involved the work is (Level 1 = straightforward, Level 2 = more complex), set before Start Project. |
| **Start / Due** | The project's planned start and due dates, set at scoping and locked once the baseline is approved (extensions go through the Extension Request workflow). |
| **Scoped Hours** | The total estimated effort for the project, rolled up from every task's Scoped Hours. |
| **Spent Hrs** | Actual hours logged against the project's tasks via Time Tracking. |
| **Hrs Variance / Hrs Variance %** | Spent Hrs minus Scoped Hours, and that difference as a percentage of Scoped Hours -- negative means under budget, positive means over. |
| **Days Extended** | The cumulative number of days the project's due date has been pushed out via approved Extension Requests. |
| **Baseline Approved By / On** | Who approved the project's baseline (locking its scope, dates and hours) and when. Blank until the project leaves Draft. |
| **Actual Close Date** | The date the project was actually closed out, captured at Closure -- distinct from the originally planned Due date. |
$md$, 1
from kb_categories where name = 'Projects'
on conflict (category_id, title) do nothing;
