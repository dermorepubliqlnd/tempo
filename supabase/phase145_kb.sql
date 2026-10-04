-- phase145 KB (2026-10-04): release note renamed "October 4 Release",
-- headers reworded per Sandra, updated_by = Sandra on today's KB edits.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'October 3–4, 2026';

update kb_entries set updated_at = now(), title = 'October 4 Release', content = $md$**At a glance:** Projects and Tasks now have their own tabs, each with quick numbers at the top and one tidy view selector. Lists are easier to scan, boards are cleaner, and you can leave **notes on tasks** as well as projects. Every project opens on a new **Overview** page, WBS planning is faster and safer, and there's a new **Feedback** page for your ideas. Utilization now only counts work while it was active, and Tempo signs everyone out at **10:00 PM** each night.

### Projects and Tasks are now on separate tabs
The Projects & Tasks page has a **Projects** tab and a **Tasks** tab. Tempo remembers the last one you used, and dashboard links open the right one.
- **Quick numbers at the top of each tab** show your own work: portfolio, owned and active projects on Projects; open, overdue, due-this-week, awaiting-validation and at-risk tasks on Tasks. On Tasks, **click a card** to see just those tasks, then **× Back** to return.
- Each tab has **one view selector** with ready-made views for you, views for the team, and **My Views** (your own).
- Pick your **default view** with the ☆. Everyone starts on **My Active Projects** and **My Open Tasks**.
- **Duplicate as my view** turns any ready-made view into your own editable copy.

**Related article:** [[Projects & Tasks: Tabs and Views]]

### Project and task lists are now easier to scan
- Tables show **pages** (Projects 25 / 50 / 100 rows, Tasks 50 / 100 / 150) instead of a scroll box.
- **Column headers stay pinned** as you scroll.
- Ready-made views keep simple layout tweaks (column order, widths, ascending / descending); bigger changes ask you to save your own view.

**Related article:** [[Projects & Tasks: Tabs and Views]]

### Improved board views
- Cards show what matters first: up to **4 primary** properties under the title and **4 secondary** ones on a compact line. Change them from **Card layout** on any board.
- Empty values are hidden, and a **coloured edge** shows Timing (tasks) or Health (projects), with a chip when something needs attention.
- Finished columns (Done, Completed, Cancelled, Closed) start collapsed.
- The Projects board can be grouped by **Health**.

**Related article:** [[Projects & Tasks: Tabs and Views]]

### Notes can now be added to tasks
Leave notes (with @mentions and replies) on any **task** as well as any project: from the Projects and Tasks lists, board and calendar cards, the project **Overview**, and the **WBS**. A project's notes include its task notes.

**Related article:** [[Notes on Projects & Tasks]]

### Every project opens on an Overview
One page with health, progress, schedule vs baseline (in working days), risks, hours and who's loaded. **Overview | WBS** tabs switch to planning.

**Related article:** [[Project Overview Page]]

### Faster, safer WBS planning
Clearer header buttons, required Priority / Planning Type / Project Type before Start, searchable fields, a ⋯ menu on each row, bulk actions, Undo, and rules that stop moves from breaking the plan. Picking a **Work Type with only one Output Type** now fills it in for you.

**Related article:** [[WBS: Building & Editing Tasks]]

### Share your ideas on the new Feedback page
A **Feedback** page in the sidebar lets anyone submit an enhancement request (your name and date are added for you), see everyone's requests and their status, read the admin's response, and cancel your own request while it's still New.

**Related article:** [[Feedback & Requests]]

### Rules that keep the data honest
- A project with **no tasks** can't be completed or closed. Add the tasks, or delete the project.
- **Utilization** counts cancelled or finished work only up to the day it stopped.
- **Work Types** were tidied: Instructional Design tasks are now **Learning Design & Analysis**, and Training Preparation tasks are now **Training Delivery**.

**Related articles:** [[Completing & Closing a Project]] · [[Utilization: Terms & Numbers]]

### Automatic sign-out at 10:00 PM
Everyone is signed out at 10:00 PM Philippine time, so each day starts with a fresh sign-in. Stop running timers before you finish.

**Related article:** [[Signing In & Automatic Sign-Out]]
$md$
where title = 'October 3–4, 2026';

-- Sandra as "Updated by" on everything edited in today's KB rounds.
update kb_entries set updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
where updated_at >= '2026-10-04 00:00:00+08';
