-- Phase 109 (2026-09-24): KB article -- Correcting Time Logs (incl. Done /
-- validated tasks and closed projects). Sandra: "add to KB please", after a
-- team question about adding/correcting time on a closed task.
insert into kb_categories (name, sort_order, description, icon, color)
values ('Time Tracking', 2, 'Logging time, corrections and time-related processes.', 'Clock', 'purple')
on conflict (name) do nothing;

insert into kb_entries (category_id, title, content, sort_order, created_by, updated_by)
select c.id, 'Correcting Time Logs', $md$## Correcting Time Logs

How to fix the start or end time of a time log that is already Confirmed or Approved — including logs on tasks that are Done, validated, or on a closed project. Click a section below to expand it.

### When to use a correction
Use a correction when an existing log has the **wrong start or end time** — for example, the timer started late, kept running after you stopped working, or a manual entry was typed wrong.

A correction changes the time window of that one entry. The duration is always calculated from the new start and end time.

**Pending or Rejected** manual entries don't need a correction — edit or delete them directly from Time Tracking.

### Option 1: Request a correction (employees)
1. Go to **Time Tracking** → **My Time**.
2. Set the date range to the day of the entry (Today, This Week, Last Week, or Custom) and find it in the table.
3. In the **Action** column, click the **Request correction** icon. It only shows on Confirmed or Approved entries.
4. Enter the correct **date, start time and end time**. The new duration shows as you type.
5. Add a **reason** (required) and click **Submit request**.
6. The entry shows a {gold:Correction requested} tag. You can cancel it while it's still pending.
7. Once approved, the entry updates. The original time stays on record (shown crossed out) with who requested and who approved the change. If it's rejected, you'll see the approver's note under the entry.

### Who approves a correction request
Requests appear in **Approval Center** → **Time Corrections**, showing the current and proposed times side by side and the change in hours.

- **Project owner** — for entries on their project, unless they are the one requesting.
- **Immediate Supervisor** — of the person requesting.
- **Full Access** — any request.

Nobody approves their own request. See **Access & Permissions → Approval Rights & Permissions Matrix** for the full list.

### Option 2: Correct directly (Full Access)
1. Go to **Time Tracking** → **Team Time** or **All Time** and find the entry.
2. Click the **Correct** (pencil) icon in the Action column.
3. Enter the correct start and end time and a **reason** (required). For non-project entries you can also fix the Activity Type.
4. Click **Save correction**. No approval step is needed.
5. If the new time runs into another entry, you'll see a {warning:Time overlap detected} prompt offering **Trim & correct** — it shortens the other entry at the overlapping edge so both stay accurate. An entry that sits completely inside the new time, or completely surrounds it, can't be trimmed; archive or adjust it first.

### Rules every correction follows
- **No future time** — the entry can only cover time that has already passed.
- **No overlaps** with your other logged entries.
- **12-hour daily cap** — the day's total can't go over 12 hours.
- A correction can't move an entry to a **different task**.
- Weekends and holidays show an "are you sure?" check, but aren't blocked.

### Done, validated tasks and closed projects
Corrections **work** on entries belonging to tasks that are Done or validated, and on projects that are closed — you're fixing a record that already exists.

What you **can't** do is add **new** time to them:
- A **Done** task no longer accepts new timer or manual logs.
- A **closed** project doesn't accept any new logs.

### New work on a finished task (revisions)
If more work is needed on a task that's already Done or validated — for example, revising a deliverable after it was delivered — **don't stretch an old log** to cover it. The hours would be recorded at times you weren't doing that work.

Instead, ask the project owner to add a **new revision task** in WBS Planning (for example, "Revise: Feedback application – temporary shutdown"), assigned to you, and log your time there. This keeps:
- the original task's validated date and actual hours accurate;
- the revision hours visible separately, so rework is measured;
- nothing needing to be reopened or re-validated.

If the project is already **closed**, log the revision under an open project or as **Non-Project Time** instead.
$md$, 2,
(select id from people where email = 'sbarlao@dermorepubliq.com' limit 1),
(select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
from kb_categories c
where c.name = 'Time Tracking'
  and not exists (select 1 from kb_entries e where e.category_id = c.id and e.title = 'Correcting Time Logs');
