-- phase150 KB (2026-10-05): Operational projects & training sessions.
-- New article, October 5 Release note, Properties (Health) + Due Dates articles updated.

insert into kb_entries (category_id, title, content, sort_order, updated_by)
select id, 'Operational Projects & Training Sessions', $md$Some work never "finishes" like a project does: trainers deliver sessions all quarter long. **Operational projects** are open, cumulative containers for that work, e.g. one **Training Delivery – Q4 2026** project per quarter. Trainers plot each session into it and log their time as usual, so sessions and hours count towards productivity and utilization.

### What makes a project operational
A project is operational when its **Project Type** is flagged **Operational** in Site Settings › Project Types (click **Standard / Operational** on the type). **Training Delivery** is operational, so every Training Delivery project follows the rules below.

| | Standard project | Operational project |
|---|---|---|
| **Health** | On track / At risk / Overdue… from dates | **Ongoing** (no date-based health) |
| **WBS Status after Start Project** | Baseline Locked → Changed After Baseline | **Ongoing** (no baseline variance) |
| **Adding tasks after Start Project** | Project owner / Full Access in WBS | **Anyone can add their own sessions** (Add Session) |
| **Moving a due date** | Extension request + approval | **Reschedule session** — no approval |
| **Task Completion Validation** | Required | **Required (unchanged)** |
| **Projects Portfolio KPIs and health** | Included | Kept out; shown in the **Training Delivery** section |

### Set up the quarter (project owner)
1. Create the project (e.g. **Training Delivery – Q4 2026**) with Project Type **Training Delivery**, Start and End dates for the quarter.
2. Add any sessions you already know about in WBS, or leave it empty.
3. Click **Start Project** once. After that, trainers can add their own sessions.
4. At the end of the quarter, close it and start the next quarter's project.

### Add a session (trainers)
1. Go to **Projects & Tasks › Tasks** and click **Add Session** (top right).
2. Pick the project (the newest is selected for you), type the **session name** (e.g. "GMP Refresher – Production Batch 3"), the **date** and the **scoped hours**.
3. Click **Add session**, or **Save & add another** to plot several in a row.

Each session is its own task with Work Type **Training Delivery**, Output Type **Session** and Output Count **1**, assigned to you. Project owners and Full Access can add sessions for any trainer.

### Log time and finish the session
- Log time on the session task as usual: **timer** or **Add Time**.
- Mark it **Done** after delivery. It goes for **Task Completion Validation** like any other task.
- Session moved? Click the session's **Due** date and use **Reschedule session**. No extension request is needed. Cancelled? Set the status to **Cancelled** with a reason.

### Training Delivery summary
**Projects Portfolio** has a **Training Delivery** section (This Month / Quarter / Year / All Time):
- **Sessions delivered** — session tasks marked Done (dated by Actual Completion Date)
- **Validated** — delivered sessions confirmed by the owner / manager
- **Upcoming** — not Done yet, dated today or later
- **Past date, not Done** — the date has passed but the session isn't marked Done (or cancelled) yet
- **Scoped hrs / Logged hrs** — planned hours and time logged on those sessions, per trainer

Only tasks with Output Type **Session** count as sessions.

**Related articles:** [[Validating Task Completion]] · [[Due Dates & Extensions After Project Start]] · [[Properties]]
$md$, 0, 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
from kb_categories where name = 'Projects'
and not exists (select 1 from kb_entries where title = 'Operational Projects & Training Sessions');

-- Properties: Health
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Properties';
update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = replace(content,
'- Still in Draft (before baseline approval) → {neutral:Not started}, regardless of dates',
'- Still in Draft (before baseline approval) → {neutral:Not started}, regardless of dates
- **Operational project** (Project Type flagged Operational, e.g. Training Delivery) after Start Project → {slate:Ongoing}. These projects grow as sessions are added, so date-based health and baseline variance aren''t used. See [[Operational Projects & Training Sessions]].')
where title = 'Properties';

-- Due dates & extensions
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Due Dates & Extensions After Project Start';
update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = content || $md$

### Exception: sessions on operational projects
On an operational project (e.g. Training Delivery), a session that moves isn't a delay. The assignee, project owner or Full Access can click the session's **Due** date and use **Reschedule session**. The new date applies right away, with no extension request or approval.

**Related article:** [[Operational Projects & Training Sessions]]
$md$
where title = 'Due Dates & Extensions After Project Start' and content not like '%Reschedule session%';

-- Release note
insert into kb_entries (category_id, title, content, sort_order, updated_by)
select id, 'October 5 Release', $md$**At a glance:** Trainers now have a home in Tempo for their training sessions. **Training Delivery** projects are now **operational**: open, quarter-long projects where trainers add their own sessions, log time as usual, and get credit for sessions and hours in productivity and utilization. Leaders get a **Training Delivery** summary on Projects Portfolio.

### Trainers can add their own sessions
On **Projects & Tasks › Tasks**, click **Add Session**, pick this quarter's Training Delivery project and enter the session name, date and hours. Each session becomes a task assigned to you: log time with the timer or Add Time, then mark it Done for validation as usual. Use **Save & add another** to plot several at once.

**Related article:** [[Operational Projects & Training Sessions]]

### Rescheduling a session no longer needs an extension
On Training Delivery projects, click a session's **Due** date and use **Reschedule session**. It's not counted as a delay, so there's nothing to approve.

**Related article:** [[Due Dates & Extensions After Project Start]]

### Training Delivery projects show as "Ongoing"
Training Delivery projects grow all quarter, so their **Health** and **WBS Status** show **Ongoing** instead of Overdue or Changed After Baseline. They're kept out of the Projects Portfolio KPIs and health charts and the weekly report's health slides. Task validation is unchanged.

**Related articles:** [[Operational Projects & Training Sessions]] · [[Properties]]

### New Training Delivery summary on Projects Portfolio
See **sessions delivered, validated, upcoming and past date not Done**, plus **scoped and logged hours by trainer**, for this month, quarter, year or all time.

**Related article:** [[Operational Projects & Training Sessions]]

### Project Types can be marked Operational
Full Access users can switch any Project Type between **Standard** and **Operational** in **Site Settings › Project Types**.

**Related article:** [[Operational Projects & Training Sessions]]
$md$, 0, 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
from kb_categories where name = 'Release Notes'
and not exists (select 1 from kb_entries where title = 'October 5 Release');

select 'phase150' t,
 (select count(*) from kb_entries where title in ('Operational Projects & Training Sessions','October 5 Release')) new_rows,
 (select content like '%{slate:Ongoing}%' from kb_entries where title = 'Properties') props,
 (select content like '%Reschedule session%' from kb_entries where title = 'Due Dates & Extensions After Project Start') due;
