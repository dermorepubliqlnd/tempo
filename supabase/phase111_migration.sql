-- Phase 111 (2026-09-24): KB "Correcting Time Logs" restructured into two
-- clearly separate paths (Sandra: "clear distinction -- time log correction
-- if pending / not approved yet, another for confirmed or approved").
-- Previous wording kept in History.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Correcting Time Logs' and not is_archived;

update kb_entries set content = $md$## Correcting Time Logs

How to fix a time log depends on **one thing: whether it has been finalized yet.** Find the log's status in **Time Tracking**, then follow the matching section below. Click a section to expand it.

| Log status | Can you still change it yourself? | How to fix it |
|---|---|---|
| {accent:Awaiting confirmation} (timer just stopped) | {success:Yes} | Adjust the times in the Confirm step — **Part 1** |
| {warning:Pending approval} (manual log) | {success:Yes} | Edit or delete it — **Part 1** |
| {danger:Rejected} | {success:Yes} | Edit it to resubmit, or delete it — **Part 1** |
| {success:Confirmed} or {success:Approved} | {danger:No} — it's final | Request a correction (or Full Access corrects it) — **Part 2** |

### Part 1 — Not yet finalized: fix it yourself
While a log is still **Awaiting confirmation**, **Pending approval** or **Rejected**, you don't need anyone's permission — fix it directly.

**Timer just stopped (Awaiting confirmation)**
1. When you stop a timer, the **Confirm time entry** window opens.
2. Adjust the date, start or end time if they're wrong.
3. Click **Confirm — lock it in**, or **Continue work** if you stopped by mistake.

**Manual log that's Pending approval or Rejected**
1. Go to **Time Tracking** → **My Time** and find the entry.
2. In the **Action** column, click the **Edit** (pencil) icon to change the date, time, reason or notes — or the **Delete** (trash) icon to remove it (it goes to the Archive).
3. Save. Editing a **Rejected** log sends it back to **Pending approval** for a fresh decision.

Who can do this: the person the log belongs to, whoever logged it for them, and Full Access.

### Part 2 — Already finalized: request a correction
Once a log is **Confirmed** (timer) or **Approved** (manual), it's final and can't be edited directly. To fix its start or end time, request a correction.

1. Go to **Time Tracking** → **My Time** and find the entry (use the date range to get to the right day).
2. In the **Action** column, click the **Request correction** icon.
3. Enter the correct **date, start time and end time** — the new duration shows as you type.
4. Add a **reason** (required) and click **Submit request**.
5. The entry shows a {gold:Correction requested} tag. You can cancel it while it's still pending.
6. Once approved, the entry updates. The original time stays on record (shown crossed out) with who requested and who approved it. If it's rejected, the approver's note shows under the entry.

**Who approves** — in **Approval Center** → **Time Corrections**:
- **Project owner** — for entries on their project, unless they are the one requesting.
- **Immediate Supervisor** — of the person requesting.
- **Full Access** — any request.

### Part 2 (Full Access) — correct a finalized log directly
Full Access doesn't need to request — they correct directly, with no approval step.

1. Go to **Time Tracking** → **Team Time** or **All Time** and find the entry.
2. Click the **Correct** (pencil) icon in the Action column.
3. Enter the correct start and end time and a **reason** (required). For non-project entries you can also fix the Activity Type.
4. Click **Save correction**.
5. If the new time runs into another entry, a {warning:Time overlap detected} prompt offers **Trim & correct** — it shortens the other entry at the overlapping edge. An entry sitting completely inside the new time, or completely around it, can't be trimmed; archive or adjust it first.

### Rules that apply to every fix
- **No future time** — a log can only cover time that has already passed.
- **No overlaps** with your other logs.
- **12-hour daily cap** — a day's total can't go over 12 hours.
- A correction changes the **time window** only — it can't move a log to a **different task**.
- Weekends and holidays show an "are you sure?" check, but aren't blocked.

### Done tasks and closed projects
- **Fixing** an existing log (Part 1 or Part 2) works even if the task is Done or validated, or the project is closed.
- **Adding new** time is different: a Done task only accepts **follow-up time** (next section), and a closed project accepts no new time at all.

### Not a correction: follow-up time on a Done task
If more work was needed **after** a task was marked Done or validated — feedback came back, it was validated too early, or the scope changed — that's new time, not a correction. Don't stretch an old log to cover it; log it as **follow-up time**:

1. Go to **Projects & Tasks** and find the Done task.
2. In the **Spent hrs** column, click the dashed **+** next to the hours.
3. Enter the date, start and end time, and choose a **reason**: {gold:Late feedback}, {gold:Validated too early} or {gold:Scope change}.
4. Add a short note on what was done, then click **Submit for approval**.

It goes to the **Approval Center** tagged {gold:Follow-up}, counts toward the task once approved, and the task **stays Done** with its validated date. Full Access can log it on the assignee's behalf when needed (a note is required).

If it's really a **new piece of work** (for example, a new version of the deliverable), ask the project owner to add a **revision task** in WBS Planning instead. On a **closed** project, log it under an open project or as **Non-Project Time**.
$md$,
  updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
where title = 'Correcting Time Logs' and not is_archived;
