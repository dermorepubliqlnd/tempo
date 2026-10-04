-- phase136 KB (2026-10-04): everything shipped 10-03 / 10-04, including the
-- WBS / Overview / Utilization work built 10-03 with ChatGPT and QA-fixed 10-04.

insert into kb_categories (name, sort_order) values ('Release Notes', 0) on conflict (name) do nothing;

-- 1) Projects & Tasks page: tabs + views -----------------------------------
insert into kb_entries (category_id, title, content, sort_order)
select id, 'Projects & Tasks: Tabs and Views', $md$## Projects & Tasks: Tabs and Views

The page has two tabs: **Projects** and **Tasks**. Tempo remembers the last tab you used. Links from My Dashboard and Team Dashboard open the right tab for you.

- **Add New Project** (top right) is the only place to create a project. It shows on the Projects tab.
- The KPI cards (My Portfolio, Projects Owned, Contributing To, Active & Attention) are always **your own** numbers and don't change with the view you pick.

### Choosing a view (Projects tab)
Click the view name (for example **My Active Projects ★ ▾**) to open the view list. It has three groups:

| Group | Views |
|---|---|
| **My Projects** | My Active Projects ★ · My Active Portfolio · All Projects I Own · My Full Portfolio |
| **Team Views** | Active Project Portfolio · All Projects |
| **My Views** | Any views you created or duplicated |

**+ Add view** sits beside the selector. Filter, Sort, Group and Properties are on the right.

### Your default view
Click the **☆** next to any view in the list to make it your default (it turns into **★**). Projects opens on your default every time. Everyone starts with **My Active Projects** until they choose another.

### System views
System views are built into Tempo and are the same for everyone.

| You can change freely (kept for you) | Asks you to **Save as New View** |
|---|---|
| Drag columns into a new order | Hide or show columns |
| Resize columns, freeze columns | Sort by a **different** field |
| Flip a sort between ascending and descending | Filters, grouping, display formats |

Rows can't be dragged into a manual order in a system view.

**Use a system view as a template:** select it, click **⋯** beside the selector, then **Duplicate as my view**. You get a personal copy under My Views with the same projects, columns, sort and grouping, which you can rename and change any way you like.

### What each system view shows
| View | Projects | Columns | Order |
|---|---|---|---|
| **My Active Projects** | You own, In Progress | Project ID, Project, WBS Status, Status, Health, Phase, Due, Progress, Priority, Scoped Hrs, Spent Hrs, Hours Variance, Days Extended | Project ID |
| **All Projects I Own** | You own, any status | Same as above | Project ID |
| **My Active Portfolio** | You own or have an open task in, In Progress | Project ID, Project, Owner, WBS Status, Health, Due, Progress, **My Open Tasks, My Next Due, My Hours** | Grouped by **My Role** (Owner / Contributor), soonest Due first |
| **My Full Portfolio** | Same, any status | As My Active Portfolio, plus Status | Same |
| **Active Project Portfolio** | Everyone's, In Progress | Owner-view columns + Owner, Category, Planning Type, Project Type | Project ID |
| **All Projects** | Everyone's, any status | Same as above | Project ID |

**My Role:** **Owner** = projects you own (accountable for the whole project). **Contributor** = someone else's project where you have tasks (accountable for your part). A project where your only tasks are cancelled doesn't count as contributing.
$md$, 0 from kb_categories where name = 'Projects'
and not exists (select 1 from kb_entries where title = 'Projects & Tasks: Tabs and Views');

-- 2) Project Overview ---------------------------------------------------------
insert into kb_entries (category_id, title, content, sort_order)
select id, 'Project Overview Page', $md$## Project Overview Page

Clicking a project's name opens its **Overview**. Use the **Overview | WBS** tabs at the top to switch to planning.

| Section | What it shows |
|---|---|
| **Header** | Project ID, category, owner, phase, priority and status. A Draft project always shows **Not Started**. |
| **Project Health** | The same Health as the Projects table (On track, At risk, Off track, Overdue, Done late, and so on). |
| **Task Progress** | Completed / In Progress / Not Started / Cancelled counts and the progress donut. |
| **Schedule Snapshot** | Baseline Start and End vs Forecast End. **Variance is in working days** (Mon–Fri minus holidays). |
| **Project Risks & Attention** | Overdue tasks, overallocated assignees, pending extension requests, and **Changed after baseline: Yes / No**. |
| **Hours** | Scoped Hours and **Logged Hours**. Logged Hours includes time from deleted tasks (shown as "incl. Xh from deleted tasks"), so it matches Spent Hrs on Projects. |
| **Assignee load (next 2 weeks)** | Each assignee's planned load across **started** projects (same as Utilization's default Committed view) plus this project. |

An archived project shows **"This project is in the Archive"** with a link to the Archive instead of its Overview. Restore it to view it again.
$md$, 1 from kb_categories where name = 'Projects'
and not exists (select 1 from kb_entries where title = 'Project Overview Page');

-- 3) WBS: building & editing tasks -------------------------------------------
insert into kb_entries (category_id, title, content, sort_order)
select id, 'WBS: Building & Editing Tasks', $md$## WBS: Building & Editing Tasks

### Header buttons
**Save Draft / Save & Continue / Save Changes**, **Request Start Project**, **Request Project Closure** and **Reopen** sit at the top right. The request buttons are disabled while you have unsaved changes.

### Project Information
- A new project needs **Project Name, Owner and Start Date** before its first save. The rest of the WBS appears after that.
- **Start Project** also needs **Priority, Planning Type and Project Type** (plus Category, Source, Complexity and Description). The approver's check includes them too.
- **Close Date** and **Lessons Learned** appear only after you click Request Project Closure.
- The **Available bandwidth** snapshot is off by default. Turn it on with the toggle.

### Working with task rows
- Press **Enter** in a task name to add the next row.
- Dropdowns (Assignee, Work Type, Output Type and others) are **searchable**: start typing to filter.
- **Output Type** stays greyed out until a **Work Type** is chosen (hover for the reason).
- **Freeze columns:** right-click a column header.
- **Esc** closes menus and pop-ups.

### Row menu (⋯)
| Action | Rules |
|---|---|
| **Add sub-task / Add task below** | In a started project you'll be asked for an assignee. |
| **Duplicate** | Open tasks without sub-tasks only. In a started project the copy must have an assignee. |
| **Move up / down** | Within the same parent. |
| **Move to parent… / Move to top level** | See the move rules below. |
| **Delete** | Follows the normal delete permissions. Undo is available for 7 seconds. |
| **Cancel task** | Any task without sub-tasks, with a reason. |
| **Uncancel task** | The only option shown on a cancelled task. |

### Selecting several tasks
Tick the row checkboxes to open the bulk bar: **Move, Assign, Duplicate, Delete** (Draft projects) or **Cancel** (started projects).

### Move rules
A move is blocked when:
- the project is **closed**, or the task is **Done** or **Cancelled**;
- the task has sub-tasks (move those first);
- the new parent is Done or Cancelled, or isn't a top-level task;
- the new parent has **logged time** and no sub-tasks yet (its hours would be stuck on a summary row);
- in a started project, the move would leave the old parent with no sub-tasks and **no assignee**.

You'll see the reason for anything that wasn't moved.
$md$, 2 from kb_categories where name = 'Projects'
and not exists (select 1 from kb_entries where title = 'WBS: Building & Editing Tasks');

-- 4) Sign-in & automatic sign-out --------------------------------------------
insert into kb_entries (category_id, title, content, sort_order)
select id, 'Signing In & Automatic Sign-Out', $md$## Signing In & Automatic Sign-Out

Tempo signs **everyone out at 10:00 PM Philippine time** every day, so each workday starts with a fresh sign-in.

- If Tempo is open at 10:00 PM, you're signed out within a minute.
- If your laptop was closed, you're signed out the moment you open Tempo the next day.
- The sign-in page explains: *"You were signed out automatically at 10:00 PM."*
- Signing in after 10:00 PM is fine. That session lasts until the next 10:00 PM.

**Running timers are not stopped by sign-out.** Stop your timer before you finish for the day.
$md$, 9 from kb_categories where name = 'Access & Permissions'
and not exists (select 1 from kb_entries where title = 'Signing In & Automatic Sign-Out');

-- 5) Completing & Closing: no-task rule (snapshot first) --------------------
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where id::text like 'dd94009e%';
update kb_entries set updated_at = now(),
  content = replace(content,
    '- A project can be set to **Completed** only when every task is **Done** or **Cancelled**.',
    '- A project can be set to **Completed** only when every task is **Done** or **Cancelled**.
- A project with **no tasks** can''t be Completed or closed: no tasks means nothing happened. If work was done, add the tasks first; if not, **delete** the project (Tempo offers both options).')
 where id::text like 'dd94009e%';

-- 6) Utilization glossary: stop dates, planning rules, page controls --------
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where id::text like '661ccf1f%';
update kb_entries set updated_at = now(), content = content || $md$

### When stopped work stops counting (from 2026-10-04)
Work counts on the days it was active, and nothing after it stopped:

| Item | Counts through |
|---|---|
| Cancelled task | The day it was cancelled |
| Done task | Its Actual Completion date |
| Cancelled project | The day it was cancelled |
| Completed / closed project | Its completion / close date |

Tasks already cancelled before this rule were stamped 2026-10-04, so their past numbers didn't change.

### Planning rules
- Task hours never land **before the project's Start date**.
- A task with **no Start date** puts all its hours on its due date.
- **Committed** = started (approved) projects only. Turn on **Include pending projects** in Advanced Filters to add Draft projects.

### Page controls
- **Capacity View:** Committed (planned %) or Available Bandwidth (free hours).
- **Time View**, **Display** and the date range (pick **Custom** for your own dates).
- **Advanced Filters:** Project, Include pending projects, Show inactive team members. A **+ inactive** tag appears next to the view name when inactive people are shown.
- A saved view that filters by role shows a **Role: … ×** chip. Click it to clear.
- Over capacity, the Team Bandwidth card reads **"X% over capacity"**.
- **Esc** or clicking outside closes Advanced Filters and the Legend.
$md$
 where id::text like '661ccf1f%';

-- 7) Release notes -------------------------------------------------------------
insert into kb_entries (category_id, title, content, sort_order)
select id, 'October 3–4, 2026', $md$## What's new: October 3–4, 2026

### Projects & Tasks
- **Projects** and **Tasks** are now separate tabs.
- One **view selector** replaces the row of view tabs, grouped into My Projects, Team Views and My Views.
- Set **your own default view** with the ☆ in the list (everyone starts on My Active Projects).
- **Duplicate as my view** turns any system view into an editable personal copy.
- Portfolio views are grouped by **My Role** and show **My Open Tasks, My Next Due, My Hours**.
- System views show **WBS Status** and **Days Extended**.
- "New project" rows at the bottom of tables are gone; use **Add New Project** at the top right.
- Personal KPI cards at the top of Projects.

### Project Overview (new)
Clicking a project opens its Overview: health, progress, schedule vs baseline (working days), risks, hours and assignee load. See **Project Overview Page**.

### WBS
Header buttons, required Priority / Planning Type / Project Type to start, searchable fields, ⋯ row menu, bulk actions, Undo, and move rules. See **WBS: Building & Editing Tasks**.

### Rules
- A project with **no tasks** can't be completed or closed.
- Cancelled and finished work stops counting in Utilization from the day it stopped.
- Everyone is signed out at **10:00 PM PH time**.

### Utilization & My Dashboard
- Utilization controls are now dropdowns, with Advanced Filters.
- **Missing Hours** on My Dashboard counts completed days only (not today).
$md$, 0 from kb_categories where name = 'Release Notes'
and not exists (select 1 from kb_entries where title = 'October 3–4, 2026');
