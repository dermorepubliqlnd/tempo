-- phase159 KB (2026-10-06): October 9 release batch.
-- Topic articles updated/created now; "October 9 Release" saved as DRAFT
-- (is_active = false) until Sandra announces it.
-- Sandra = e7e52a30-4c13-449b-889d-280dc0ca16c6

-- snapshots
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where article_number in (23, 26, 28, 22, 11, 10, 4);

-- KB-0023 Projects & Tasks: Tabs and Views -------------------------------
update kb_entries set content = replace(content,
  substring(content from position('### Editing a ready-made (system) view' in content) for position('### What the Projects views show' in content) - position('### Editing a ready-made (system) view' in content)),
$md$### Changing a ready-made (system) view
Ready-made views can be adjusted for you. Some changes stay on the view just for you; others need your own copy.

| Kept for you on the ready-made view | Needs **Save as Personal View** |
|---|---|
| Sort, group and sub-group, hidden groups, counts | Filters (Status, Owner / Assigned to, My role, Project owner, Attention) |
| Column order, width and freeze | Showing or hiding columns |
| Display formats (e.g. progress as bar or %) and timeline settings | Card fields on boards |
| | Switching layout (Table, Board, Timeline, Calendar) |

- The first time you change the sort or grouping of a ready-made view, Tempo asks **"Modify this System View?"**. Choose **Yes, keep my changes**. Only you see the change; everyone else keeps the standard layout.
- **↺ Restore default** (next to the layout buttons) puts the view back to the standard layout.
- For anything in the right-hand column, Tempo offers **Cancel** or **Save as Personal View**. Your copy is saved as "*View name* - Personal" under **My Views**.
- Rows can't be dragged into a manual order in a ready-made view.

### Filters are always visible
Every view decides which projects or tasks it shows with **Filters** you can see in the **Filtered:** pill, never with hidden rules. Click **Filter** to change them on your own views.
- **Projects:** Owner, Status, **My role** (Owner / Contributor).
- **Tasks:** Assigned to, Status, **Project owner**, **Attention** (At risk = overdue, due soon or unassigned).

Personal views you copied from a ready-made view now show the filter they came with, for example *Status: In Progress* from Active Project Portfolio. Click **×** on the pill to clear it.

### Switching layout
The **Table / Board / Timeline / Calendar** buttons beside the view name change the layout of the view you're on. On your own views this updates the **same** view (no new view is created). On a ready-made view it offers **Save as Personal View**.

$md$),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 23 and content like '%### Editing a ready-made (system) view%';

update kb_entries set content = replace(replace(replace(replace(content,
  '| You own, In Progress |', '| Filters: My role Owner · Status In Progress |'),
  '| You own, any status |', '| Filters: My role Owner |'),
  '| You own or have an open task in, In Progress |', '| Filters: My role Owner + Contributor · Status In Progress |'),
  'Later, No due date (weeks run Mon–Sun) |', 'Later, **Draft timeline**, No due date (weeks run Mon–Sun) |')
  || $md$

**Draft timeline** groups tasks on projects that haven't started yet. Their dates are tentative, so they never count as overdue or due. See [[Draft Projects: Planning Before Start]].
$md$,
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 23 and content not like '%**Draft timeline** groups tasks%';

-- KB-0026 Operational Projects & Training Sessions -------------------------
update kb_entries set content = replace(content,
  substring(content from position('1. Go to **Projects & Tasks › Tasks** and click **Add Session**' in content) for position('Each session is its own task' in content) - position('1. Go to **Projects & Tasks › Tasks** and click **Add Session**' in content)),
$md$1. Open this quarter's Training Delivery project and go to its **WBS**.
2. Click **Add Session** (on operational projects it replaces Add Task).
3. Type the **session name** (e.g. "GMP Refresher – Production Batch 3"), the **Session Start Date** and **Session End Date** (the same date for a one-day session) and the **scoped hours** (total for the session).
4. Click **Add session**, or **Save & add another** to plot several in a row.

**Project owners:** **Bulk Upload Sessions** (WBS header) loads a list of sessions from a CSV in one go (session, start date, end date, hours, trainer). Rows that look like duplicates are flagged before import.

$md$),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 26 and content like '%1. Go to **Projects & Tasks › Tasks** and click **Add Session**%';

update kb_entries set content = replace(content,
  'Session moved? Click the session''s **Due** date and use **Reschedule session**. No extension request is needed.',
  'Session moved? Click the session''s **Due** date and use **Reschedule session** to set the new start and end dates. No extension request is needed.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 26;

-- KB-0028 Trainers: Logging Your Training Sessions ------------------------
update kb_entries set content = replace(replace(replace(replace(replace(content,
  '1. **Add the session**: Projects & Tasks › Tasks › **Add Session**',
  '1. **Add the session**: your Training Delivery project › **WBS** › **Add Session**'),
  '1. Go to **Projects & Tasks** and open the **Tasks** tab.
2. Click **Add Session** (top right).',
  '1. Go to **Projects & Tasks**, open this quarter''s **Training Delivery** project and click **WBS**.
2. Click **Add Session** (top of the task list).'),
  '   - **Date**: the day you''ll deliver it.',
  '   - **Session Start Date / End Date**: the day(s) you''ll deliver it. Use the same date for a one-day session.'),
  '**Tip:** Add one session per batch, per day. A 2-day program for one batch = 2 sessions.',
  '**Tip:** Add one session per batch. If a session runs over several days, set the end date; the scoped hours are the total for the whole session.'),
  '| **Session moved** to another date | Click the session''s **Due** date › **Reschedule session** › pick the new date. No extension request needed. |',
  '| **Session moved** to other dates | Click the session''s **Due** date › **Reschedule session** › set the new start and end dates › **Save dates**. No extension request needed. |'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 28;

-- KB-0022 WBS --------------------------------------------------------------
update kb_entries set content = content || $md$

### Draft plans are private until Start Project
While a project is in Draft, only the **Project Owner**, the owner's **reporting line** and **Full Access** see its tasks. People you assign can't see them yet, so plan freely. See [[Draft Projects: Planning Before Start]].

### Start Project checks for past dates
When you click **Start Project** (and again when the approver approves), Tempo checks for open tasks whose dates are **already in the past**. You can **Re-plan dates** first (recommended) or **Start anyway**. Otherwise those tasks would show as Overdue for your team the day the project starts.
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 22 and content not like '%### Start Project checks for past dates%';

-- KB-0011 Utilization glossary ---------------------------------------------
update kb_entries set content = content || $md$

### Committed vs Planned / Pipeline
| Term | Meaning |
|---|---|
| **Committed load** | Scoped hours on **started** projects. This is what Utilization on My Dashboard and Team Dashboard shows. |
| **Planned / Pipeline load** | Scoped hours on **Draft** projects (including those awaiting Start Project approval). Tentative, not yet an assignment. |
| **Include Planned / Pipeline (Draft projects)** | Utilization page filter (Advanced Filters). Adds Draft hours on top of committed load; a dashed **Incl. Planned / Pipeline** chip shows while it's on. Off by default. |
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 11 and content not like '%### Committed vs Planned / Pipeline%';

-- KB-0010 Tasks glossary ---------------------------------------------------
update kb_entries set content = content || $md$

### Draft timeline
| Term | Meaning |
|---|---|
| **Draft timeline** (Timing) | The task belongs to a project that hasn't started. Its dates are tentative: no Overdue / Due soon, Days +/- stays blank, and it isn't counted in Overdue, Due this week or At Risk. |
| **New assignments** | Tasks that became yours in the last 7 days because their project was started (My Dashboard). |
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 10 and content not like '%### Draft timeline%';

-- KB-0004 Approval Rights ----------------------------------------------------
update kb_entries set content = content || $md$

### Awaiting My Approval on My Dashboard
If you can approve, **My Dashboard** shows an **Awaiting My Approval** card under the first row of cards: the number of requests waiting for you, how old the oldest one is, and one card per type (Task Validations, Time Entries, Extension Requests…). The numbers are the same as **Approval Center › Mine to approve**. Click a card to open the Approval Center filtered to that type.

### Draft projects
The Owner's reporting line can review a Draft project's WBS and tasks before approving **Start Project**. Contributors can't see Draft tasks until the project starts. See [[Draft Projects: Planning Before Start]].
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 4 and content not like '%### Awaiting My Approval on My Dashboard%';

-- NEW: Draft Projects: Planning Before Start -------------------------------
insert into kb_entries (category_id, title, content, sort_order, is_active, created_by, updated_by)
select 'aae479c1-34d4-4fc7-b728-7c77ceae94e7', 'Draft Projects: Planning Before Start', $md$Until a project is started, its WBS is a **plan**, not a commitment. Tempo treats it that way everywhere: who can see it, how its dates count, and how its hours show in utilization.

### Who can see a Draft project's tasks
| Person | While Draft | After Start Project |
|---|---|---|
| **Project Owner** | Full WBS: build tasks, assign people, set tentative dates and hours | Full |
| **Owner's supervisor and everyone above** | Can open and review the WBS and tasks | Full |
| **Full Access** | Can see all | Full |
| **People assigned to tasks** | **Don't see the tasks yet.** My Dashboard shows the project under **Planned projects (Draft)**, with no tasks, dates or hours | See their tasks in **My Tasks** |
| **Everyone else** | See the project row only, marked Draft | As usual |

Being assigned to a Draft task doesn't make it visible or count as work yet. "Draft" includes projects waiting for Start Project approval.

### Draft dates are tentative
- Draft tasks show **Draft timeline** instead of Overdue or Due soon, and **Days +/-** stays blank.
- They aren't counted in Overdue, Due today, Due this week or At Risk.
- If someone without access opens a Draft project's WBS, they see a short notice instead of tasks.

### Planning reminders on My Dashboard
| Reminder | Who sees it | What it means |
|---|---|---|
| **Draft projects · Start Project pending** | Owner and their reporting line | Drafts waiting to be started. The list shows the owner, number of tasks and when it was last updated; **Idle N days** (red) after 14 days without changes. **Review Draft** opens the WBS. |
| **Planned projects (Draft)** | People assigned in a Draft | You're in the plan; nothing to do until it starts. |
| **New assignments** | People with tasks on a project started in the last 7 days | The tasks that just became yours, with due dates. |

### Starting the project
**Start Project** is the one switch from planning to commitment. Once it's approved:
- people see their tasks in My Tasks;
- Due, Overdue and Needs Attention rules start;
- the plan becomes the project's baseline.

Before you request it (and again before the approver approves), Tempo checks for open tasks with dates **already in the past** and offers **Re-plan dates** or **Start anyway**.

### Utilization: committed vs planned
Utilization on My Dashboard and Team Dashboard counts **committed** work only (started projects). On the **Utilization** page, **Include Planned / Pipeline (Draft projects)** adds Draft hours so leaders can see upcoming load.

**Related articles:** [[WBS: Building & Editing Tasks]] · [[Utilization: Terms & Numbers]] · [[Approval Rights & Permissions Matrix]]
$md$, 5, true, 'e7e52a30-4c13-449b-889d-280dc0ca16c6', 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where not exists (select 1 from kb_entries where title = 'Draft Projects: Planning Before Start');

-- DRAFT: October 9 Release (is_active = false until announced) ---------------
insert into kb_entries (category_id, title, content, sort_order, is_active, created_by, updated_by)
select 'bc5dda9d-1b96-472d-a1ac-72f8b8ccc150', 'October 9 Release', $md$**At a glance:** This week Tempo separates **planning from commitment**. Draft projects are now a private planning space for the owner and their leaders, and work only reaches people's task lists when the project starts. My Dashboard now shows approvals, new assignments and planning reminders in one place. Views are easier to trust: every filter is visible, and you can personalise ready-made views. Trainers now plot sessions from the Training Delivery WBS with start and end dates.

### Draft projects are now private until they start
While a project is in Draft, only the owner, their reporting line and Full Access see its tasks. People assigned in the plan don't see those tasks (or get reminders about them) until **Start Project** is approved.
**Related article:** [[Draft Projects: Planning Before Start]]

### Draft dates no longer show as overdue
Tasks on Draft projects show **Draft timeline** instead of Overdue or Due soon, and they're left out of Overdue, Due this week and At Risk counts.
**Related articles:** [[Draft Projects: Planning Before Start]] · [[Tasks: Terms & Columns]]

### Start Project now checks for past dates
Before a project starts, Tempo flags open tasks whose dates have already passed, so you can re-plan them instead of starting with overdue work.
**Related article:** [[WBS: Building & Editing Tasks]]

### See what's waiting for your approval on My Dashboard
Approvers get an **Awaiting My Approval** card with the same numbers as Approval Center › Mine to approve. Click a type to go straight to it.
**Related article:** [[Approval Rights & Permissions Matrix]]

### New reminders on My Dashboard
**New assignments** (tasks from a project that just started), **Planned projects (Draft)** (projects you're planned on) and **Draft projects · Start Project pending** for owners and leaders, with idle Drafts flagged after 14 days.
**Related article:** [[Draft Projects: Planning Before Start]]

### Utilization shows committed work; Draft hours are labelled Planned / Pipeline
My Dashboard and Team Dashboard count started projects only. The Utilization page can add Draft hours as **Planned / Pipeline**.
**Related article:** [[Utilization: Terms & Numbers]]

### Ready-made views remember your sort and grouping
Change the sort or grouping of a ready-made view and it stays that way for you, with **↺ Restore default** to go back. Filters, columns and layout changes are saved as your own personal view.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Every view's filters are now visible
Views no longer use hidden rules to decide what they show. Each one uses filters you can see and change, including new **My role**, **Project owner** and **At risk** filters.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Switch a view between Table, Board, Timeline and Calendar
New layout buttons beside the view name. On your own views the same view is updated.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Training Delivery: trainers plot sessions from the WBS
Sessions are added from the Training Delivery project's **WBS** (**Add Session**), with a **start and end date**, and can be rescheduled without an extension. Project owners can **bulk upload** sessions from a CSV.
**Related articles:** [[Trainers: Logging Your Training Sessions]] · [[Operational Projects & Training Sessions]]

### Training Delivery projects show as Ongoing
Project Types can be marked **Operational** (Site Settings). Training Delivery projects show Health and WBS Status as **Ongoing**, have their own summary on **Projects Portfolio**, and their own slide in the weekly report.
**Related articles:** [[Operational Projects & Training Sessions]] · [[Reports — L&D Weekly Report (deck)]]

### Weekly report deck refresh
Week at a glance now shows Delivery and Pipeline; Portfolio overview separates Total projects this year, Active projects and Training Delivery; every slide has speaker notes with the names and reasons behind the numbers.
**Related article:** [[Reports — L&D Weekly Report (deck)]]

### New non-project activity: RICA CMC Reviews
Log time spent on L&D's review of company-wide SOP revisions and new SOPs under **Non-Project Time › RICA CMC Reviews**.
**Related article:** [[Non-Project Time]]
$md$, 0, false, 'e7e52a30-4c13-449b-889d-280dc0ca16c6', 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where not exists (select 1 from kb_entries where title = 'October 9 Release');

select article_number, title, is_active,
  (content like '%### Filters are always visible%') a23,
  (content like '%Bulk Upload Sessions%') a26,
  (content like '%Training Delivery** project and click **WBS**%') a28,
  (content like '%Reschedule session** to set the new start%') a26b,
  (content like '%Filters: My role Owner%') a23b
from kb_entries where article_number in (23, 26, 28) or title in ('Draft Projects: Planning Before Start', 'October 9 Release') order by article_number;
