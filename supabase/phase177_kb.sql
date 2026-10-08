begin;
insert into kb_entry_versions (entry_id, title, content, edited_by) select id, title, content, updated_by from kb_entries where article_number in (2,4,5,6,7,10,12,14,15,17,18,22,23,29,30,32,33);
update kb_entries set content = replace(replace(replace(replace(replace(replace(content, $q$Scoped/Spent Hours$q$, $q$Estimated/Logged hours$q$), $q$**Add Time > Non-project** (manual log)$q$, $q$**Log time > Non-project** (manual log)$q$), $q${accent:Pending Approval} -- goes to your manager$q$, $q${accent:Awaiting approval} -- goes to your manager, unless it's approved automatically (2 hrs or less, within 2 working days)$q$), $q$**Add Time** is for manual logs only (project or non-project).$q$, $q$**Log time** is for manual logs only (project, non-project or follow-up).$q$), $q$Until then it isn't counted as finalized time.$q$, $q$Until then it isn't counted as finalized time. A timer still running at **10 PM** stops at 10:00 PM and waits in **Needs confirming** the same way.$q$), $q$- If nobody active sits above the logger, the entry is auto-approved.$q$, $q$- If nobody active sits above the logger, the entry is auto-approved.
- Short entries (2 hrs or less, logged within 2 working days, no overlap, up to 5 hrs a week) are approved automatically. See [[Auto-Approvals: What Tempo Approves Automatically]].$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 2;
update kb_entries set content = replace(replace(replace(replace(replace(content, $q$- **Approval Rights** — the **Project Start** and **Project Close** checkboxes in User Management, for those two request types only.$q$, $q$- **Tempo role** — each person has one role (Team Member, Supervisor, Director, Executive…), picked in **User Management**. The role sets their access level, approval rights (**Project Start**, **Project Close**), sidebar pages and System Views. Full Access sets roles up in **Site Settings → Roles & Permissions**.$q$), $q$| **Baseline approval** (Start Project) | {neutral:n/a} | {neutral:—} | {danger:No} unless they also hold the right | {accent:Project Start} |$q$, $q$| **Start Project request** | The project owner | {success:Yes}, routed to the first one up who holds the right | {danger:No} unless they also hold the right | {accent:Project Start} |$q$), $q$| **Project close** | {neutral:n/a} | {neutral:—} | {success:Yes} | {accent:Project Close} (or Full Access) |$q$, $q$| **Close Project request** | The project owner | {success:Yes}, routed to the first one up who holds the right or Full Access | {success:Yes} | {accent:Project Close} (or Full Access) |$q$), $q$| View the Archive |$q$, $q$| Open the **Recycle bin** (Archive) |$q$), $q$### Notes
$q$, $q$### Automatic approvals
Small, low-risk items are approved by Tempo itself: short manual time entries, small first extensions, and on-time or late task completions. Approvers see them in **Approval Center › Auto-approved** and can reverse time entries and validations within 7 days. See [[Auto-Approvals: What Tempo Approves Automatically]].

### Roles & Permissions (Full Access)
**Site Settings → Roles & Permissions** shows one table: each role's access level, approval rights, admin pages, sidebar pages and System Views. Editing a role updates everyone who has it. In **User Management**, each person gets **one role**; the drawer shows what the role gives, warns when it doesn't fit (for example, someone with direct reports who can't see Team Dashboard) and offers a **Suggested** role.

### Notes
$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 4;
update kb_entries set content = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(content, $q${accent:Awaiting confirmation} (timer just stopped)$q$, $q${accent:Needs confirming} (timer stopped)$q$), $q${warning:Pending approval} (manual log)$q$, $q${warning:Awaiting approval} (manual log)$q$), $q${success:Confirmed} or {success:Approved}$q$, $q${success:Final}$q$), $q$**Awaiting confirmation**$q$, $q$**Needs confirming**$q$), $q$Awaiting confirmation$q$, $q$Needs confirming$q$), $q$**Pending approval**$q$, $q$**Awaiting approval**$q$), $q$Pending approval$q$, $q$Awaiting approval$q$), $q$Once a log is **Confirmed** (timer) or **Approved** (manual), it's final$q$, $q$Once a log is **Final** (a confirmed timer or an approved manual entry), it can't change$q$), $q$In the **Spent hrs** column, click the dashed **+** next to the hours.$q$, $q$In the **Logged hrs** column, click the dashed **+** next to the hours. (Or open **Log time** anywhere and pick the Done task: it's marked "Done – logs as follow-up".)$q$), $q$### Rules that apply to every fix$q$, $q$### Timers still running at 10 PM
A timer still running at 10 PM stops at **10:00 PM** and waits in **Needs confirming**. The next morning, check the end time, add notes if needed and **Confirm**, then start a new timer for today. The Confirm pop-up can't be closed by accident: choose **Continue work** or **Confirm**.

### Rules that apply to every fix$q$), $q$- **No overlaps** with your other logs.$q$, $q$- **No overlaps** with your other logs, and the end must be after the start.$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 5;
update kb_entries set content = replace(replace(content, $q$**Projects Portfolio → Needs Attention**$q$, $q$**Team Dashboard → Needs Attention**$q$), $q$| Closure request, approved by Full Access or the Project Close right |$q$, $q$| Close Project request, routed to the first person up the owner's line with the Project Close right (or Full Access) |$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 6;
update kb_entries set content = replace(replace(replace(content, $q$Confirm Completion Date$q$, $q$Validated date$q$), $q$### The dates in a validation$q$, $q$### When Tempo validates automatically
What happens after the assignee sets **Reported Completion** depends on the timing, shown in the **Timing** column of Approval Center:

| Reported Completion vs current due date | What happens |
|---|---|
| **Early** (before the due date) | Marked **Early completion**. You validate it as usual. |
| **On the due date** | Validated automatically after **2 working days**, unless you click **Hold for review**. **Release hold** lets it continue. |
| **Late** (after the due date) | Validated automatically, straight away, with the reported date. |

You can **Reverse** an auto-validation within 7 days from **Approval Center › Auto-approved** (reason required). The task stays Done and comes back to your queue, on hold. See [[Auto-Approvals: What Tempo Approves Automatically]].

### The dates in a validation$q$), $q$- You can't validate your own work (unless nobody is above you).$q$, $q$- You can't validate your own work (unless nobody is above you).
- **Validate** and **Reopen** on Projects & Tasks show only for the routed approver. Anyone else who has the right uses **Override** in Approval Center.
- Dragging a card to **Done** on a board asks for the Reported Completion details first, the same as setting it in the table. Done can't be set in bulk.$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 7;
update kb_entries set content = replace(replace(replace(replace(replace(replace(replace(replace(content, $q$Set automatically from Scoped Hours$q$, $q$Set automatically from Estimated Hours$q$), $q$| **Confirmed Completion Date** |$q$, $q$| **Validated date** |$q$), $q$| **Scoped Hours** | Estimated hours.$q$, $q$| **Estimated Hours** | The hours planned for the task.$q$), $q$| **Spent hrs** |$q$, $q$| **Logged hrs** |$q$), $q$| **Hrs Variance / Hrs Variance %** |$q$, $q$| **Hrs Variance / % of estimate** |$q$), $q$| **Extension** | Opens the task's extension request details, or lets you raise one. |$q$, $q$| **Extension** | Opens the task's extension request details, or lets you raise one. {gold:Shifted} = moved by another task's extension. |
| **Committed Due** | The due date when Start Project was approved. Never moves. **est.** = estimated from history (projects started before Oct 9, 2026). |
| **vs Committed** | In working days: {success:On time}, {danger:Late +N WD}, {success:On track}, {gold:Slipped +N WD}, {danger:Overdue +N WD}. See [[Due Dates & Extensions After Project Start]]. |$q$), $q$running, awaiting confirmation, or awaiting approval$q$, $q$running, needs confirming, or awaiting approval$q$), $q$every entry is confirmed or approved$q$, $q$every entry is Final$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 10;
update kb_entries set content = replace(replace(replace(replace(content, $q$Entries awaiting confirmation, pending approval, or rejected.$q$, $q$Entries that need confirming, are awaiting approval, or were rejected.$q$), $q$- **Timer**: Running, then Awaiting confirmation, then Confirmed. No approval needed.$q$, $q$- **Timer**: Running, then **Needs confirming**, then **Final**. No approval needed. A timer still running at 10 PM stops at 10:00 PM and waits in Needs confirming.$q$), $q$- **Manual**: Pending approval, then Approved or Rejected. Decided by your Immediate Supervisor or anyone above them.$q$, $q$- **Manual**: **Awaiting approval**, then **Final** or **Rejected**. Decided by your Immediate Supervisor or anyone above them. Short entries are approved automatically (see [[Auto-Approvals: What Tempo Approves Automatically]]).$q$), $q$- No overlapping entries, and no entries in the future.$q$, $q$- No overlapping entries, no entries in the future, and the end must be after the start.$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 12;
update kb_entries set content = replace(replace(replace(replace(replace(replace(replace(replace(replace(content, $q$Each task's Scoped Hours$q$, $q$Each task's Estimated Hours$q$), $q$total Scoped Hours$q$, $q$total Estimated Hours$q$), $q$| **Scoped Hours** |$q$, $q$| **Estimated Hours** |$q$), $q$| **Spent hrs** |$q$, $q$| **Logged hrs** |$q$), $q$Spent hrs minus Scoped Hours$q$, $q$Logged hrs minus Estimated Hours$q$), $q$| **Hrs Variance %** | Spent hrs / Scoped Hours$q$, $q$| **% of estimate** | Logged hrs / Estimated Hours$q$), $q$vs your scoped hours$q$, $q$vs your estimated hours$q$), $q$Awaiting Baseline Approval$q$, $q$Awaiting Start$q$), $q$Moves only when an extension is approved. |$q$, $q$Moves only when an extension is approved. |
| **Committed End** | The project end date when Start Project was approved. Never moves. **est.** = estimated from history. |
| **vs Committed** | Project finish (or current end) vs Committed End, in working days: On time, Late, On track, Slipped, Overdue. Ongoing projects show Ongoing. |$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 14;
update kb_entries set content = replace(replace(content, $q$**Two views** (toggle at the top): **Executive Dashboard** (default, described below) and **Projects Portfolio** (donuts, Needs Attention, Active Projects table and the Training Delivery summary).$q$, $q$It's one page: the separate Projects Portfolio view was merged in on October 9, 2026. Its **Active Projects** table, **Materials Output** and **Training Delivery** sections are now further down this page. Every number uses the same definition as the rest of Tempo; hover the info icon on a tile to read it.$q$), $q$| **Next 2 weeks** (today through the Friday of the week after next) |$q$, $q$| **Today – Friday** (today through the Friday of the week after next; the label shows the date) |$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 15;
update kb_entries set content = replace(replace(content, $q$**Project Start** and **Project Close** still use their own approval-right checkboxes.$q$, $q$**Start Project** and **Close Project** requests are routed too: to the first person up the project owner's reporting line who holds the matching right (Start: the **Project Start** right; Close: the **Project Close** right or Full Access). They can be approved or declined right in **Approval Center**, with a link to review the plan.

**Validate** and **Reopen** on Projects & Tasks show only for the routed approver; anyone else uses **Override** in Approval Center.$q$), $q$| **Team view** | Everything routed to someone else | Read-only — **Override** only |$q$, $q$| **Team view** | Everything routed to someone else | Read-only — **Override** only |
| **Auto-approved** | What Tempo approved automatically in the last 7 days | **Reverse** time entries and validations (reason required) |$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 17;
update kb_entries set content = replace(replace(replace(content, $q$so the date on screen is always the committed date.$q$, $q$so the date on screen is always the current agreed date. The first due date is also kept, unchanged, as the task's **Committed Due** (see below).$q$), $q$The request goes to your **supervisor** (or their delegate / the next person up if they're on leave) in **Approval Center**.$q$, $q$The request goes to your **supervisor** (or their delegate / the next person up if they're on leave) in **Approval Center**.

**Small extensions are approved automatically** when all of these are true: **2 working days or less**, the task's **first** extension, requested **on or before** the current due date, and it doesn't push the project's last task past the project end date. Anything else goes to your supervisor, and Tempo tells you why. Auto-approved extensions can't be undone. See [[Auto-Approvals: What Tempo Approves Automatically]].$q$), $q$### Exception: Training Delivery sessions$q$, $q$### Tasks moved by an extension show "Shifted"
When an approved extension pushes the tasks that depend on it, those tasks show **Shifted** in the **Extension** column. They start on the next working day and keep their length in working days, so a shifted date never lands on a weekend or holiday. A shift isn't the task's own extension, so it doesn't use up its first-extension allowance. Every move is recorded in the project's **Audit Trail**.

### Committed Due and vs Committed
When **Start Project** is approved, each task's due date is saved as its **Committed Due** (and the project's end date as its **Committed End**). Extensions, shifts and re-planning never change it. **vs Committed** compares the work with it, in working days:

| vs Committed | Meaning |
|---|---|
| {success:On time} / {danger:Late +N WD} | Done on or before / after the committed date |
| {success:On track} | Open, and still due on or before the committed date |
| {gold:Slipped +N WD} | Open, and now due later than committed (extensions or re-planning) |
| {danger:Overdue +N WD} | Open, and past its current due date |

Tasks added after Start take their first saved due date. Projects started before October 9, 2026 have an estimated committed date from their history, marked **est.** Training Delivery and Ongoing projects show **Ongoing**.

### Exception: Training Delivery sessions$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 18;
update kb_entries set content = replace(replace(replace(content, $q$### Start Project checks for past dates
When you click **Start Project** (and again when the approver approves), Tempo checks for open tasks whose dates are **already in the past**. You can **Re-plan dates** first (recommended) or **Start anyway**. Otherwise those tasks would show as Overdue for your team the day the project starts.$q$, $q$### Start Project shows one checklist
When you click **Start Project**, Tempo shows one checklist of everything still missing, instead of one error at a time: unsaved changes, project details, placeholder task names, Estimated hours, assignees, Output Types, dependency date conflicts and **dates already in the past**. Fix the items that block the request; warnings (like past dates) can be confirmed. The approver sees the same checklist before approving. Once approved, each task's due date is saved as its **Committed Due**.$q$), $q$**Request Start Project**, **Request Project Closure**$q$, $q$**Request Start Project** (sends a Start Project request), **Request Project Closure** (sends a Close Project request)$q$), $q$| **Delete** | Follows the normal delete permissions.$q$, $q$| **Move to Archive** | Follows the normal delete permissions.$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 22;
update kb_entries set content = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(content, $q$**My Projects:** My Active Projects ★, My Active Portfolio, All Projects I Own, My Full Portfolio$q$, $q$**My Projects:** My Active Projects, All My Projects, Active Projects I Own, All Projects I Own$q$), $q$**Team Views:** Active Project Portfolio, All Projects$q$, $q$**Team Views:** All Active Projects, All Projects$q$), $q$| **My Active Projects** | Filters: My role Owner · Status In Progress |$q$, $q$| **Active Projects I Own** | Filters: My role Owner · Status In Progress |$q$), $q$| **My Active Portfolio** |$q$, $q$| **My Active Projects** |$q$), $q$| **My Full Portfolio** |$q$, $q$| **All My Projects** |$q$), $q$| **Active Project Portfolio / All Projects** |$q$, $q$| **All Active Projects / All Projects** |$q$), $q$from Active Project Portfolio.$q$, $q$from All Active Projects (formerly Active Project Portfolio).$q$), $q$Scoped Hrs, Spent Hrs, Hours Variance$q$, $q$Estimated Hrs, Logged Hrs, Hrs Variance$q$), $q$secondary Scoped, Spent, Extension$q$, $q$secondary Estimated, Logged, Extension$q$), $q$secondary Scoped, Spent, Days Extended$q$, $q$secondary Estimated, Logged, Days Extended$q$), $q$### Changing a ready-made (system) view$q$, $q$### Which ready-made views you see
The list depends on your **Tempo role** (set by Full Access in **Site Settings → Roles & Permissions**). Team Members get the views they need for their own work; owners and leaders also get team views. Your own personal views are always there.

**Committed dates:** **My Completed Tasks** shows **Committed Due** and **vs Committed**; the owner and team project views show **Committed End** and **vs Committed**. See [[Due Dates & Extensions After Project Start]].

### Changing a ready-made (system) view$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 23;
update kb_entries set content = replace(content, $q$Before you request it (and again before the approver approves), Tempo checks for open tasks with dates **already in the past** and offers **Re-plan dates** or **Start anyway**.$q$, $q$- each task's due date and the project's end date are saved as **Committed** dates, so later slips stay visible.

Before you request it, Tempo shows one checklist of everything still missing (details, names, hours, assignees, Output Types, date conflicts and dates already in the past). The approver sees the same checklist. The request is routed to the first person up your reporting line with the Project Start right.$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 29;
update kb_entries set title = 'October 9 Release', content = $q$**At a glance:** Tempo gets simpler, and planning is now clearly separate from commitment. Draft projects are a private planning space until **Start Project**, and the first agreed dates are now kept as **Committed** dates, so slips are visible. Small, low-risk approvals happen automatically, so approvers spend time only where judgement is needed. Each role sees only the pages and views it uses, every filter is visible, time logging uses one form, every number means the same thing on every page, and words and pop-ups are shorter and consistent.

## Navigation and views

### Each role sees only the pages it uses
The sidebar now follows your role. **Team Members** see My Dashboard, Projects & Tasks, Time Tracking, Approval Center (My Requests), Time Off & Holidays, Knowledge Base and Feedback. **Supervisors, Directors and Executives** also see Team Dashboard, Utilization and Productivity. Full Access admins set this up in **Site Settings → Roles & Permissions** (see *Across Tempo* below).
**Related article:** [[Approval Rights & Permissions Matrix]]

### Fewer, clearer ready-made views
Each role gets only the ready-made (System) views it needs. Some views were renamed:
- **My Active Projects:** projects you own or work on that are in progress (was My Active Portfolio).
- **All My Projects:** every project you're part of, any status (was My Full Portfolio).
- **All Active Projects:** every in-progress project (was Active Project Portfolio).
- **Active Projects I Own:** projects you own that are in progress (was My Active Projects).

Your own personal views don't change.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Ready-made views remember your sort and grouping
Change the sort or grouping of a ready-made view and it stays that way for you, with **↺ Restore default** to go back. Filters, columns and layout changes are saved as your own personal view.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Every view's filters are now visible
Views no longer use hidden rules to decide what they show. Each one uses filters you can see and change, including new **My role**, **Project owner** and **At risk** filters.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Switch a view between Table, Board, Timeline and Calendar
New layout buttons beside the view name. On your own views the same view is updated.
**Related article:** [[Projects & Tasks: Tabs and Views]]

### Archive is now the Recycle bin
Archive left the sidebar for most people. Use the **Recycle bin** link at the top of Projects & Tasks or Time Tracking to restore anything moved to Archive in the last 90 days.

### Projects Portfolio is now part of Team Dashboard
There's one leadership dashboard. The Projects Portfolio view is gone; its **Active Projects** table, **Materials Output** and **Training Delivery** sections are now on **Team Dashboard**.
**Related article:** [[Team Dashboard (L&D Executive Dashboard)]]

## Projects & Tasks and WBS

### Draft projects are now private until they start
While a project is in Draft, only the owner, their reporting line and Full Access see its tasks. People assigned in the plan don't see those tasks (or get reminders about them) until **Start Project** is approved.
**Related article:** [[Draft Projects: Planning Before Start]]

### Draft dates no longer show as overdue
Tasks on Draft projects show **Draft timeline** instead of Overdue or Due soon, and they're left out of Overdue, Due this week and At Risk counts.
**Related articles:** [[Draft Projects: Planning Before Start]] · [[Tasks: Terms & Columns]]

### Start Project shows everything that's missing at once
Instead of one error at a time, **Start Project** shows one checklist of everything still missing: project details, task names, Estimated hours, assignees, Output Types, date conflicts and dates already in the past. Approvers see the same checklist.
**Related article:** [[WBS: Building & Editing Tasks]]

### New: Committed dates show what slipped against the original plan
When **Start Project** is approved, each task's due date and the project's end date are saved as its **Committed** date, and that date never moves, even after extensions or re-planning. New columns compare the work with it, in working days:
- **Tasks:** **Committed Due** and **vs Committed** (shown in **My Completed Tasks**): {danger:Late +N WD}, {success:On time}, {danger:Overdue +N WD}, {gold:Slipped +N WD} (moved later by extensions) or {success:On track}.
- **Projects:** **Committed End** and **vs Committed**, in the owner and team views.

Projects that started before today have an estimated committed date from their history, marked **est.** Training Delivery and Ongoing projects show **Ongoing**.
**Related articles:** [[Due Dates & Extensions After Project Start]] · [[Tasks: Terms & Columns]]

### Small first extensions are approved automatically
An extension of **2 working days or less** is approved straight away when it's the task's **first** extension, it's requested **on or before** the due date, and it doesn't push the project's finish past its end date. Anything else goes to your supervisor, and Tempo tells you why.
**Related articles:** [[Due Dates & Extensions After Project Start]] · [[Auto-Approvals: What Tempo Approves Automatically]]

### Tasks moved by an extension show "Shifted", on working days
When an extended task pushes the tasks after it, those tasks show **Shifted** instead of "No Extension". They start on the next working day and keep their length in working days, so a shifted date never lands on a weekend or holiday. A shift isn't the task's own extension, and every move is still recorded in the project's baseline changes.
**Related article:** [[Due Dates & Extensions After Project Start]]

### Done always goes through Reported Completion
Dragging a card to **Done** on a board now asks you to confirm the Logged hours and Output Count, the same as setting **Reported Completion**. Dragging to **Cancelled** asks for the reason. Done can't be set in bulk.
**Related article:** [[Validating Task Completion]]

### Output Count is now required when a task is completed
Every task needs to say how many items it produced (1 or more) when it's marked complete. Output Types that aren't deliverables (**No Deliverable/Activity Only**) are always 0, and Site Settings › Output Types shows which types are **Counted**.
**Related articles:** [[Tasks: Terms & Columns]] · [[Completing & Closing a Project]]

### Quick revisions now have their own ongoing project
Tick **Ongoing container** on a project (e.g. a quarterly **Content Revisions** project, Project Type Operational) and it shows as **Ongoing** instead of being judged on dates, while every revision task still tracks Due soon, Overdue and extension requests.
**Related article:** [[Ongoing Projects & Training Sessions]]

### Training Delivery: trainers plot sessions from the WBS
Sessions are added from the Training Delivery project's **WBS** (**Add Session**), with a **start and end date**, and can be rescheduled without an extension. Project owners can **bulk upload** sessions from a CSV.
**Related articles:** [[Trainers: Logging Your Training Sessions]] · [[Ongoing Projects & Training Sessions]]

### Training Delivery projects show as Ongoing
Project Types can be set to **Ongoing** (Site Settings). Training Delivery projects show Health and WBS Status as **Ongoing**, have their own summary on **Team Dashboard**, and their own slide in the weekly report.
**Related articles:** [[Ongoing Projects & Training Sessions]] · [[Reports — L&D Weekly Report (deck)]]

## Time Tracking

### One Log time form
Project time, non-project time and follow-up time now use the same **Log time** form everywhere: Time Tracking, My Dashboard and Projects. Pick a task that's already Done and it logs as follow-up time automatically. Every entry gets the same checks: no future times, no overlaps, and the end must be after the start.
**Related article:** [[Correcting Time Logs]]

### Short manual entries are approved automatically
Manual entries of **2 hrs or less**, logged within **2 working days** of the work and not overlapping other entries, are approved straight away (up to 5 hrs a week per person). Longer or older entries still go to your supervisor. Tempo tells you which happened when you save.
**Related article:** [[Auto-Approvals: What Tempo Approves Automatically]]

### Timers stop at the 10 PM sign-out
A timer still running at 10 PM now stops at 10:00 PM and waits in **Needs confirming** for you the next morning. Check the end time and confirm, then start a new timer for today. The confirm pop-up can no longer be closed by accident: choose **Continue work** or **Confirm**.
**Related article:** [[Correcting Time Logs]]

### New non-project activity: RICA CMC Reviews
Log time spent on L&D's review of company-wide SOP revisions and new SOPs under **Non-Project Time › RICA CMC Reviews**.
**Related article:** [[Non-Project Time]]

## Approval Center

### New Auto-approved tab
Approvers see everything Tempo approved automatically in the last 7 days. **Reverse** sends a time entry or task validation back to **Mine to approve** (reason required). Auto-approved extensions can't be reversed.
**Related article:** [[Auto-Approvals: What Tempo Approves Automatically]]

### Task validation depends on timing
- **Early** (reported before the due date): your supervisor validates it, marked **Early completion**.
- **On the due date:** validated automatically after 2 working days, unless your supervisor clicks **Hold for review**.
- **Late:** validated automatically, straight away.

**Related article:** [[Validating Task Completion]]

### Start Project and Close Project requests go to one approver
Like every other approval, these go to one routed approver: the first person up your reporting line who can approve them (leave and delegation included). They can be approved or declined right in **Approval Center**, with a link to review the plan. **Validate** and **Reopen** on Projects show only for the routed approver; others use **Override** in Approval Center.
**Related articles:** [[Approval Routing & Delegation]] · [[Approval Rights & Permissions Matrix]]

## Dashboards and reports

### See what's waiting for your approval on My Dashboard
Approvers get an **Awaiting My Approval** card with the same numbers as Approval Center › Mine to approve. Click a type to go straight to it.
**Related article:** [[Approval Rights & Permissions Matrix]]

### New reminders on My Dashboard
**New assignments** (tasks from a project that just started), **Planned projects (Draft)** (projects you're planned on) and **Draft projects · Start Project pending** for owners and leaders, with idle Drafts flagged after 14 days.
**Related article:** [[Draft Projects: Planning Before Start]]

### One definition for each number
**Overdue**, **Active**, **Due this week**, **Total projects** and **Planned utilization** now mean the same thing on every page and in the weekly report. Hover the info icon on a tile to read its definition. Planned numbers count started projects only; on the Utilization page, Draft hours can be added as **Planned / Pipeline**. "Utilization (actual)" is now called **Logged vs expected**.

Some numbers will look lower than before: Overdue tasks no longer count Draft or paused projects, Due this week no longer repeats overdue tasks, and My Active Projects counts only your projects that are in progress.
**Related articles:** [[Team Dashboard (L&D Executive Dashboard)]] · [[Utilization: Terms & Numbers]]

### Weekly report deck refresh
Week at a glance now shows Delivery and Pipeline; Portfolio overview separates Total projects this year, Active projects and Training Delivery; every slide has speaker notes with the names and reasons behind the numbers.
**Related article:** [[Reports — L&D Weekly Report (deck)]]

## Across Tempo

### Roles & Permissions
Full Access admins set up roles in **Site Settings → Roles & Permissions**: one table with each role's access, approval rights, admin pages, sidebar pages and System Views. Each person has **one role**, picked in **User Management**, which shows what the role gives, plain warnings when it doesn't fit (for example, a person with direct reports who can't see Team Dashboard) and a suggested role. Starting roles: Team Member, Supervisor, Director and Executive, set so nobody's access changed.
**Related article:** [[Approval Rights & Permissions Matrix]]

### One word for each thing
Tempo now uses the same words everywhere: **Logged hours**, **Estimated hours**, **% of estimate**, **Approve / Reject**, **Validate** and **Validated date**, **Start Project request** and **Awaiting Start**, **Close Project**, **Extension**, and time statuses **Running · Needs confirming · Awaiting approval · Final · Rejected**. Deleting now says **Move to Archive**. See the **Glossary** section of the Knowledge Base.

### Shorter, clearer pop-ups
Every pop-up now has a short title, one sentence, a short list when needed, and buttons that say what they do. Error messages say what went wrong in plain words; the technical text is under **Show details**.

## Fixes
- **Logged hours showing 0.00:** the newest time logs were left out once Tempo passed 1,000 entries. All entries now count again.
- **Parent tasks stuck at Not Started:** a parent task's status now updates as soon as anyone updates a sub-task.
- **Approving an extension failed:** approving could fail when a cancelled task depended on the extended task. Cancelled tasks are now skipped.
- **Confirm button did nothing on non-project timers:** if the required note was empty, clicking **Confirm** silently did nothing, so the timer looked stuck. The button now looks faded until you add a note, and clicking it shows a reminder and outlines the Notes box in red.
- **WBS forecast kept growing:** a sub-task that depended on its own parent made the forecasted end date grow by itself. Tempo now ignores and refuses links between a task and its own parent, and removes them when a task is moved under its parent.

**Related articles:** [[Non-Project Time]] · [[WBS: Building & Editing Tasks]]
$q$, is_active = true, updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 30;
update kb_entries set is_active = true, updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 32;
update kb_entries set content = $q$Changes for the next weekly release are collected here before they go live. This draft stays hidden until release day.$q$, is_active = false, updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now() where article_number = 33;
commit;
select article_number, title, is_active, length(content) from kb_entries where article_number in (2,4,5,6,7,10,12,14,15,17,18,22,23,29,30,32,33) order by 1;