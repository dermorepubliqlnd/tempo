-- Phase 87 migration (2026-09-23): new Knowledge Base category --
-- Productivity -- covering the Daily Activity and Per Task views on the
-- Productivity page (Sandra: "add a productivity category in the
-- knowledge base that explains the daily activity and per task views.
-- provide knowledge about the daily prod and hours categories, tagging
-- and legends and colors").
--
-- Grounded directly in the actual implementation, same convention as the
-- Projects > Properties seed (phase55_migration.sql):
--   - the 5-tier logged-hours color system + exact thresholds, read
--     straight from src/lib/loggedHoursBands.ts (percentage-of-expected
--     ratio, not a flat 7.5h assumption -- Sandra's own "Time Log Status
--     Colors" brief, phase95/96)
--   - Time Log Status (Pending/Finalized weakest-link collapse), read
--     from src/lib/timeTracking.ts's ownTimeLogStatusFor/TIME_LOG_STATUS_*
--   - Per Task's Variance color bands, matching the same 100%/125%
--     on-budget/warning/over-budget convention as the Projects >
--     Properties entry's Hrs Variance % section
--   - the weekend/holiday soft-confirm added this same session --
--     included here since it changes what a person logging time will
--     now see, and Sandra separately asked for the rollout guide to
--     flag anything from today that needs discussing.
--
-- {tone:Label} pills reuse KnowledgeBase.tsx's renderInline syntax --
-- blue/skyblue added to its regex in this same phase so Very Low/Below
-- Expected can render with their actual app colors, not just success/
-- warning/danger.

insert into kb_categories (name, sort_order) values ('Productivity', 2)
on conflict (name) do nothing;

insert into kb_entries (category_id, title, content, sort_order)
select id, 'Daily Activity & Per Task Views', $md$## Productivity: Daily Activity & Per Task

Two views of the same underlying data — hours actually logged, compared against hours expected — read together to see who needs support and where a task's time budget is drifting. Click a section below to expand it.

### Daily Activity
A day-by-day, person-by-person grid. Each team member is a row, each date in the selected range is a column, and each cell is that person's total logged hours for that day, color-coded by the 5-tier system below. A **Total** row at the bottom sums each day across everyone shown.

Filters across the top: a month/date-range browser (with **This month** as the default and prev/next arrows), **From/To** custom dates, **All team members** (or a specific person), **Active team members only** vs. everyone including inactive, and **All roles** (or a specific role). **Export to Excel** downloads exactly what's currently filtered.

A blank cell (**—**) means no hours were logged that day. **Off** (shown in gray) means the person had approved time off or it's a non-working day for them — that day is deliberately excluded from color evaluation, since there's nothing to compare against.

### Per Task
A flat, one-row-per-task table instead of a day-by-day grid — better for scanning which specific tasks are over or under budget, rather than which days. Columns:

| Column | What it shows |
|---|---|
| **Task ID** | The task's permanent T-0000-style identifier. Searchable. |
| **Team Member** | The task's assignee. |
| **Project** | The project the task belongs to. |
| **Task** | The task name. |
| **Status** | The task's current lifecycle status (Not Started, In Progress, Done, Cancelled), color-coded the same as everywhere else in the app. |
| **Due** | The task's current due date. |
| **Timing** | Whether the task is on track, due soon, or overdue relative to today — same logic as Projects & Tasks. |
| **Time Log Status** | See below. |
| **Scoped** | The task's estimated hours. |
| **Logged** | Actual hours logged so far — click the value to see the individual time-log entries behind it. |
| **Variance** | Logged minus Scoped, colored by how far over budget it runs (see below). |

Columns can be dragged to reorder or resized, same as the Projects and Tasks tables. **Export to Excel** downloads the current filtered/sorted view.

### Time Log Status (Pending vs. Finalized)
A task can have several individual time log entries behind it — some may already be confirmed or approved, others might still be running or awaiting a decision. Time Log Status collapses all of a task's entries into a single, honest answer using the **weakest link**, not an average:

- {neutral:—} — nothing has been logged against this task yet.
- {warning:Pending} — at least one entry is still open (running, awaiting the logger's own confirmation, or awaiting a manager's decision). The task's logged time is **not** fully final yet, even if every other entry on it is long since settled.
- {success:Finalized} — every entry is confirmed or approved. Both "Confirmed" (timer entries, self-service, no review needed) and "Approved" (manual entries that went through a decision) count as the same finalized end state.

Rejected entries don't count at all — a task with only rejected entries reads as {neutral:—}, the same as if nothing had ever been logged.

### The 5-Tier Logged-Hours Color System
This is the color coding behind every logged-hours cell on Daily Activity, My Dashboard's My Logged Hours This Week, and the Time Tracking KPI cards — one shared system, so a color means the same thing everywhere it appears. It compares hours logged against hours **expected** for that same day (or period), as a percentage — not a flat "7.5 hours is normal" assumption. A reduced day (approved half-day) or a multi-day week is judged against its own expected-hours total using these same percentage cutoffs, so the bands automatically scale.

| Range (regular 7.5h day) | Tier | Color |
|---|---|---|
| Under 3.75h (under 50% of expected) | {blue:Very Low} | Blue |
| 3.75h – 6.49h | {skyblue:Below Expected} | Light blue |
| 6.5h – 8.5h | {success:Within Expected} | Green |
| 8.51h – 10h | {warning:Above Expected} | Amber |
| Over 10h | {danger:Significantly Above} | Red |
| Time off / non-working day | {neutral:Not Evaluated} | Gray, excluded from color evaluation entirely |

**Why blue instead of red for low hours:** red is intentionally reserved for significantly *high* hours only. Low logged hours use blue shades so it's immediately visually distinct from overwork, rather than both extremes competing for the same red. This is purely a comparison of logged vs. expected hours — it is not a judgment that a low day was unproductive; there are plenty of legitimate reasons (meetings elsewhere, partial day, a task genuinely needing less time).

A small dot legend showing all 5 colors sits with the Daily Activity table (and on My Dashboard's own Logged Hours card), so nobody has to memorize this list to read the grid.

### Variance Color (Per Task)
The Per Task view's **Variance** column (Logged minus Scoped, shown as a percentage of Scoped) uses its own 3-tier band, separate from the 5-tier logged-hours system above since it's answering a different question — not "was today a normal day" but "is this task's total time budget on track":

- {success:100% or under} — on budget.
- {warning:Up to 125%} — a warning: running over, worth a look.
- {danger:Over 125%} — over budget.

### Weekend & Holiday Logging Check
Starting a timer or manually logging time on a Saturday, Sunday, or a company holiday now shows a one-click "are you sure?" confirmation naming the actual day (e.g. "You're logging time on a **Saturday**...", or "...on **Araw ng Kagitingan**, a company holiday..."). It never blocks the entry — it's a soft check to make sure the day is intentional, especially for backdated manual entries, since the message always names the actual date being logged for rather than assuming "today." It appears every time, on every timer start (My Dashboard and the per-task Start button in Projects & Tasks) and every manual log or edit, project and non-project time alike.
$md$, 1
from kb_categories where name = 'Productivity'
on conflict (category_id, title) do nothing;
