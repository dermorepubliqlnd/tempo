-- phase138 KB (2026-10-04): release notes restructured (high-level summary +
-- contextual sections) and topic articles brought up to date.

-- helper: snapshot before every update
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries
where title in ('October 3–4, 2026', 'Projects & Tasks: Tabs and Views', 'WBS: Building & Editing Tasks', 'Project Overview Page', 'Tasks: Terms & Columns', 'Projects: Terms & Columns');

-- 1) Release notes ------------------------------------------------------------
update kb_entries set updated_at = now(), content = $md$## What's new: October 3–4, 2026

**At a glance:** Projects and Tasks now have their own tabs, and each has one tidy view selector with ready-made views for your own work, your team, and your saved layouts. Every project opens on a new **Overview** page. You can leave **notes** on any project or task from anywhere in Projects & Tasks. Planning in the WBS is faster and safer. Utilization now only counts work while it was active. And Tempo signs everyone out at **10:00 PM** each night.

### Projects and Tasks are now in separate tabs
The Projects & Tasks page has a **Projects** tab and a **Tasks** tab. Tempo remembers the last one you used, and dashboard links open the right one.
- Each tab has **one view selector** instead of a row of view tabs, grouped into ready-made views for you, views for the team, and **My Views** (your own).
- Pick your **default view** with the ☆ in the list. Everyone starts on **My Active Projects** and **My Open Tasks**.
- **Duplicate as my view** turns any ready-made view into your own editable copy.
- Ready-made views keep simple layout tweaks (column order, widths, asc/desc). Bigger changes ask you to save a new view.
→ *Projects & Tasks: Tabs and Views*

### Quick numbers at the top of each tab
Both tabs have KPI cards with your own numbers. On Tasks, **click a card** (Overdue, Due This Week, Awaiting Validation…) to see just those tasks; click **× Back** to return.

### Longer lists are easier to scan
Tables now show **pages** (Projects 25 / 50 / 100 rows, Tasks 50 / 100 / 150) instead of a scroll box, and the **column headers stay pinned** as you scroll.

### Notes on projects and tasks
Leave a note (with @mentions and replies) on any **project or task**: from the Projects and Tasks tables, board and calendar cards, the project **Overview**, and the **WBS**. A project's notes include its task notes.
→ *Notes on Projects & Tasks*

### Every project opens on an Overview
One page with health, progress, schedule vs baseline (in working days), risks, hours and who's loaded. **Overview | WBS** tabs switch to planning.
→ *Project Overview Page*

### Faster, safer WBS planning
Clearer header buttons, required Priority / Planning Type / Project Type before Start, searchable fields, a ⋯ menu on each row, bulk actions, Undo, and rules that stop moves from breaking the plan. Picking a **Work Type with only one Output Type** now fills the Output Type for you.
→ *WBS: Building & Editing Tasks*

### Rules that keep the data honest
- A project with **no tasks** can't be completed or closed. Add the tasks, or delete the project.
- **Utilization** counts cancelled or finished work only up to the day it stopped.
- **Work Types** were tidied: Instructional Design tasks are now **Learning Design & Analysis**, and Training Preparation tasks are now **Training Delivery**.
→ *Completing & Closing a Project* · *Utilization: Terms & Numbers*

### Automatic sign-out at 10:00 PM
Everyone is signed out at 10:00 PM Philippine time, so each day starts with a fresh sign-in. Stop running timers before you finish.
→ *Signing In & Automatic Sign-Out*
$md$ where title = 'October 3–4, 2026';

-- 2) Projects & Tasks: Tabs and Views (full rewrite) -------------------------
update kb_entries set updated_at = now(), content = $md$## Projects & Tasks: Tabs and Views

The page has two tabs, **Projects** and **Tasks**. Tempo remembers the last tab you used, and links from My Dashboard and Team Dashboard open the right one. **Add New Project** (top right, Projects tab) is the only place to create a project.

### KPI cards
Each tab starts with cards showing **your own** numbers. They don't change with the view you pick.

| Projects tab | Tasks tab |
|---|---|
| My Portfolio · Projects Owned · Contributing To · Active Owned · Active Contributions · Needs Attention | My Open Tasks · Overdue · Due This Week · Awaiting Validation · At Risk in My Projects (project owners only) |

**On Tasks, click a card** to open a quick list of just those tasks in a layout that suits them, for example At Risk shows the Assignee. A chip shows **"Showing: … (n)"**. Click **× Back to [view]** or the card again to return. Nothing is saved.

### Choosing a view
Click the view name (for example **My Open Tasks ★ ▾**) to open the list.

| Projects tab | Tasks tab |
|---|---|
| **My Projects:** My Active Projects ★, My Active Portfolio, All Projects I Own, My Full Portfolio | **My Tasks:** My Open Tasks ★, My Tasks by Project, My Task Calendar, My Completed Tasks, Tasks in My Projects, At-Risk Tasks in My Projects |
| **Team Views:** Active Project Portfolio, All Projects | **Team Views:** All Open Tasks, All Tasks |
| **My Views:** views you created or duplicated | **My Views:** views you created or duplicated |

**Your default:** click the **☆** next to any view to make it your default (it turns **★**). The page opens on it every time.

**Use a ready-made view as a template:** select it, click **⋯** beside the selector, then **Duplicate as my view**.

### Editing a ready-made (system) view
| Changes freely (kept for you) | Asks you to **Save as New View** |
|---|---|
| Drag columns into a new order | Hide or show columns |
| Resize or freeze columns | Sort by a **different** field |
| Flip a sort between ascending and descending | Filters, grouping, display formats |

Rows can't be dragged into a manual order in a ready-made view.

### What the Projects views show
| View | Projects | Columns | Order |
|---|---|---|---|
| **My Active Projects** | You own, In Progress | Project ID, Project, WBS Status, Status, Health, Phase, Due, Progress, Priority, Scoped Hrs, Spent Hrs, Hours Variance, Days Extended | Project ID |
| **All Projects I Own** | You own, any status | Same | Project ID |
| **My Active Portfolio** | You own or have an open task in, In Progress | Project ID, Project, Owner, WBS Status, Health, Due, Progress, **My Open Tasks, My Next Due, My Hours** | By **My Role**, soonest Due first |
| **My Full Portfolio** | Same, any status | As above, plus Status | Same |
| **Active Project Portfolio / All Projects** | Everyone's | Owner-view columns + Owner, Category, Planning Type, Project Type | Project ID |

**My Role:** **Owner** = projects you own. **Contributor** = someone else's project where you have tasks (cancelled-only doesn't count).

### What the Tasks views show
| View | Tasks | Grouped by |
|---|---|---|
| **My Open Tasks** | Yours, not Done or Cancelled | **Due Window**: Overdue, Today, This week, Next week, Later, No due date (weeks run Mon–Sun) |
| **My Tasks by Project** | Same | Project |
| **My Task Calendar** | Same | Calendar by due date |
| **My Completed Tasks** | Yours, Done | **Awaiting validation / Validated** |
| **Tasks in My Projects** | Open tasks in projects you own | Assignee |
| **At-Risk Tasks in My Projects** | Open tasks in projects you own that are Overdue, Due soon (≤ 3 days) or unassigned | Project |
| **All Open Tasks / All Tasks** | Everyone's | Assignee / Project |

### Long lists
Tables show **pages**, with Prev / Next and **Rows per page** underneath (Projects 25 / 50 / 100; Tasks 50 / 100 / 150). Your choice is remembered. A parent task is never split from its sub-tasks across pages. **Column headers stay pinned** under the toolbar as you scroll.

### Notes
Click the 💬 bubble on a project or task to read or add notes. See **Notes on Projects & Tasks**.
$md$ where title = 'Projects & Tasks: Tabs and Views';

-- 3) New: Notes article -------------------------------------------------------
insert into kb_entries (category_id, title, content, sort_order)
select id, 'Notes on Projects & Tasks', $md$## Notes on Projects & Tasks

Leave notes for your team on any **project** or **task**: updates, decisions, questions. Type **@** and a name to tag someone, and use **Reply** to keep a thread together.

### Where to find them
| Place | How |
|---|---|
| **Projects tab** (table, board, timeline, calendar) | 💬 bubble next to the project name |
| **Tasks tab** (table, board) | 💬 bubble next to the task name |
| **Tasks calendar** | 💬 bubble on tasks that already have notes |
| **Project Overview** | **Notes** button beside the Overview / WBS tabs |
| **WBS** | **Notes** button (project notes); **⋯ → Add note** on a row (task notes); 💬 bubble on rows that have notes |

The bubble shows how many notes there are.

### Project notes vs task notes
- **Task notes** stay with that task.
- **Project notes** show everything for the project, **including its task notes**, each tagged "On task: T-0123 · …". Replying to a task note keeps the reply on that task.
- If a task is deleted, its notes stay on the project.
- Tempo also adds **System** notes for events such as pausing or resuming a project.

Anyone who can see a project can read and add its notes. Press **Esc** to close the notes panel.
$md$, 3 from kb_categories where name = 'Projects'
and not exists (select 1 from kb_entries where title = 'Notes on Projects & Tasks');

-- 4) WBS article: notes + output auto-fill ----------------------------------
update kb_entries set updated_at = now(), content = replace(content,
  '- **Output Type** stays greyed out until a **Work Type** is chosen (hover for the reason).',
  '- **Output Type** stays greyed out until a **Work Type** is chosen (hover for the reason).
- If the Work Type has **only one** Output Type (set in Site Settings → Work Types), Tempo **fills it in for you**, e.g. Training Delivery → Session. Existing tasks keep what they have.
- **Notes:** the **Notes** button at the top opens the project''s notes; **⋯ → Add note** on a row opens that task''s notes. Rows with notes show a 💬 bubble.')
where title = 'WBS: Building & Editing Tasks';

-- 5) Overview article: notes button ------------------------------------------
update kb_entries set updated_at = now(), content = content || $md$

**Notes:** the **Notes** button beside the Overview / WBS tabs opens the project's notes, including notes left on its tasks.
$md$ where title = 'Project Overview Page' and content not like '%**Notes:** the **Notes** button%';

-- 6) Glossaries ------------------------------------------------------------------
update kb_entries set updated_at = now(), content = content || $md$

### Views & groupings (added 2026-10-04)
| Term | Definition |
|---|---|
| **Due Window** | Groups tasks by when they're due: Overdue, Today, This week, Next week, Later, No due date. Weeks run Monday to Sunday. |
| **Validation** | Groups Done tasks into **Awaiting validation** (not yet confirmed by the supervisor/owner) and **Validated**. |
| **At risk (task)** | An open task in a project you own that is Overdue, Due soon (due within 3 days) or has no assignee. |
| **Quick list** | The temporary list you get by clicking a KPI card on the Tasks tab. Nothing is saved. |
| **Notes bubble** | 💬 next to a task name. The number is how many notes the task has. |
$md$ where title = 'Tasks: Terms & Columns' and content not like '%Views & groupings (added 2026-10-04)%';

update kb_entries set updated_at = now(), content = content || $md$

### Portfolio columns (added 2026-10-04)
| Term | Definition |
|---|---|
| **My Role** | **Owner** (you own the project) or **Contributor** (someone else's project where you have tasks). |
| **My Open Tasks** | Your tasks on that project that aren't Done or Cancelled. "—" if you have none. |
| **My Next Due** | Your soonest open task due date on that project. Red when overdue. |
| **My Hours** | Your logged hours (approved / confirmed) vs your scoped hours on that project, e.g. "6.5 / 12h". |
| **Days Extended** | Working days the project's End Date has moved past its baseline through approved extensions. |
$md$ where title = 'Projects: Terms & Columns' and content not like '%Portfolio columns (added 2026-10-04)%';
