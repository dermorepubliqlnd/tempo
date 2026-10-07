-- phase169 KB (2026-10-07): approve-by-exception (auto-approvals) -- STAGING DRAFTS.
-- Both entries are is_active = false (hidden) until go-live. Go-live: set
-- is_active = true on both, rename the release note to its release date, and
-- apply the topic-article edits in phase169_kb_golive.sql.
-- Sandra = e7e52a30-4c13-449b-889d-280dc0ca16c6

-- NEW topic article (draft) -------------------------------------------------
insert into kb_entries (category_id, title, content, sort_order, is_active, created_by, updated_by)
select coalesce((select id from kb_categories where name ilike '%approv%' order by sort_order limit 1), 'bc5dda9d-1b96-472d-a1ac-72f8b8ccc150'),
'Auto-Approvals: What Tempo Approves Automatically', $md$Tempo approves small, low-risk items on its own, so approvers only review what needs a person's judgement. Everything approved automatically is tagged **Auto-approved** and listed in **Approval Center › Auto-approved** for the approver.

### Manual time
A manual time entry (project or non-project) is approved automatically when **all** of these are true:

| Rule | Detail |
|---|---|
| **2 hrs or less** | Longer entries go to your approver. |
| **Logged within 2 working days** | The work date is today or up to 2 working days back. Weekends and holidays don't count. Older backfills go to your approver. |
| **No overlap** | It doesn't overlap another of your entries. |
| **Weekly limit** | Up to **5 hrs** of auto-approved manual time per person per week (Mon to Sun). After that, entries go to your approver. |

Follow-up time on a Done task always goes to your approver. Timers work as before.

**Approvers:** you can **Reverse** an auto-approved entry within **7 days** (reason required). It goes back to **Mine to approve** for a normal decision.

### Task validation
What happens after the assignee sets **Reported Completion** depends on when the task was finished:

| Reported Completion vs due date | What happens |
|---|---|
| **Early** (before the due date) | Marked **Early completion**. Your approver validates it as usual. |
| **On the due date** | Your approver has **2 working days**. If they don't put it on **Hold for review**, it is validated automatically with the reported date. |
| **Late** (after the due date) | Validated automatically, straight away, with the reported date. |

- "Due date" means the **current** due date, including approved extensions.
- **Approvers:** use **Hold for review** in Approval Center to stop an on-the-due-date auto-validation; **Release hold** lets it continue. You can **Reverse** an auto-validation within **7 days** (reason required). The task stays **Done** and goes back to your queue, on hold.

### Extensions
A due-date extension is approved automatically when **all** of these are true:

| Rule | Detail |
|---|---|
| **2 working days or less** | 3 or more working days go to your approver. |
| **First extension on the task** | A second or later request goes to your approver. |
| **Requested on time** | Asked for on or before the current due date. Requests made after the task is already overdue go to your approver. |
| **Doesn't push the project end date** | After the extension and any tasks that depend on it move, the project's last task doesn't finish later than the project end date (or later than it already did, if the project was already running late). |

- The reason is still required, and your approver sees every auto-approved extension in their **Auto-approved** list.
- Auto-approved extensions **can't be undone**, because dependent tasks may already have moved.
- If a request goes to your approver, Tempo tells you why (for example, "3 working days").

### Shifted due dates
When an extended task pushes the tasks that depend on it, those tasks show **Shifted** in the **Extension** column, not **Extended**. A shift isn't the task's own extension, so it doesn't use up its first-extension allowance. The move is recorded in the project's baseline changes (Audit Trail).

### What still always needs an approver
- **Start Project** requests.
- **Time corrections** to approved or confirmed entries.
- **Follow-up time** on Done tasks.
- Anything that doesn't meet the rules above.

**Related articles:** [[Approval Rights & Permissions Matrix]] · [[Correcting Time Logs]]
$md$, 50, false, 'e7e52a30-4c13-449b-889d-280dc0ca16c6', 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where not exists (select 1 from kb_entries where title = 'Auto-Approvals: What Tempo Approves Automatically');

-- DRAFT release note --------------------------------------------------------
insert into kb_entries (category_id, title, content, sort_order, is_active, created_by, updated_by)
select 'bc5dda9d-1b96-472d-a1ac-72f8b8ccc150', 'Upcoming Release (draft)', $md$**At a glance:** Tempo is simpler this week. It approves small, low-risk items on its own, so approvers spend their time on what needs judgement; each role sees only the pages and views it uses; and words, pop-ups and messages are now consistent and shorter. Short manual time entries, on-time and late task completions, and small first extensions go through automatically. Approvers keep control: every auto-approval is listed in a new **Auto-approved** tab, most can be reversed within 7 days, and on-the-due-date completions can be held for review.

### Short manual time entries are approved automatically
Manual entries of **2 hrs or less**, logged within **2 working days** of the work and not overlapping other entries, are approved straight away (up to 5 hrs a week per person). Longer or older entries still go to your approver.
**Related article:** [[Auto-Approvals: What Tempo Approves Automatically]]

### Task completions are validated by timing
**Early** completions still need your approver. Completions **on the due date** are validated automatically after 2 working days unless your approver holds them for review. **Late** completions are validated automatically right away.
**Related article:** [[Auto-Approvals: What Tempo Approves Automatically]]

### Small first extensions are approved automatically
Extensions of **2 working days or less**, requested on or before the due date, for a task's **first** extension, are approved automatically when they don't push the project's finish past its end date. Everything else goes to your approver, and Tempo tells you why.
**Related article:** [[Auto-Approvals: What Tempo Approves Automatically]]

### New Auto-approved tab in Approval Center
Approvers see everything approved automatically in the last 7 days. **Reverse** sends a time entry or task validation back to Mine to approve (reason required).
**Related article:** [[Approval Rights & Permissions Matrix]]

### Tasks moved by a dependency show "Shifted"
When an extended task pushes the tasks after it, those tasks now show **Shifted** instead of "No Extension". It doesn't count as their own extension, and the move is still recorded in baseline changes.
**Related article:** [[Auto-Approvals: What Tempo Approves Automatically]]

### Clearer messages when you submit
After you log manual time or request an extension, Tempo now says whether it was approved automatically or sent to your approver (and why). The time-entry message now correctly says it goes to your supervisor.

### Each role sees only what it uses
The sidebar and the ready-made (System) views now follow your role. **Members** see My Dashboard, Projects & Tasks, Time Tracking, Approval Center (My Requests), Time Off & Holidays, Knowledge Base and Feedback, with 6 System Views. **Project owners** also get views for the tasks in their projects. **Leads** also see Team Dashboard, Utilization and Productivity. Your own personal views don't change. Full Access can adjust any person, or a whole role, in **User Management**.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Archive is now the Recycle bin
Archive left the sidebar for most people. Use the **Recycle bin** link on Projects & Tasks or Time Tracking to restore anything moved to Archive in the last 90 days.

### One word for each thing
Tempo now uses the same words everywhere: **Logged hours**, **Estimated hours**, **% of estimate**, **Approve / Reject**, **Validate** and **Validated date**, **Start Project request** and **Awaiting Start**, **Close Project**, **Extension**, and time statuses **Running · Needs confirming · Awaiting approval · Final · Rejected**. Deleting now says **Move to Archive**.
**Related article:** [[Glossary]]

### Shorter, clearer pop-ups
Every pop-up now has a short title, one sentence, a short list when needed, and buttons that say what they do. Error messages say what went wrong in plain words; the technical text is under **Show details**.

### Timers stop at the 10 PM sign-out
A timer still running at 10 PM now stops at 10:00 PM and waits in **Needs confirming** for you the next morning. Check the end time and confirm. The confirm pop-up can no longer be closed by accident: choose **Continue work** or **Confirm**.
**Related article:** [[Correcting Time Logs]]

### Done always goes through Reported Completion
Dragging a card to **Done** on a board now asks you to confirm the logged hours and Output Count, the same as setting **Reported Completion**. Dragging to **Cancelled** asks for the reason. Done can't be set in bulk.
$md$, 0, false, 'e7e52a30-4c13-449b-889d-280dc0ca16c6', 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where not exists (select 1 from kb_entries where title = 'Upcoming Release (draft)');

select article_number, title, is_active from kb_entries
 where title in ('Auto-Approvals: What Tempo Approves Automatically', 'Upcoming Release (draft)');
