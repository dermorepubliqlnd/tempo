-- phase164 KB (2026-10-07): Ongoing container + Output Count rules.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where article_number in (1, 6, 10, 14, 22, 26, 30);

update kb_entries set content = replace(content,
  'These projects grow as sessions are added, so date-based health and baseline variance aren''t used. See [[Operational Projects & Training Sessions]].',
  'These projects grow as sessions are added, so date-based health and baseline variance aren''t used. A project marked **Ongoing container** (WBS › Project Information) also shows {slate:Ongoing}. See [[Operational Projects & Training Sessions]].')
  || $md$

### Output Count
How many items the task produced, e.g. 3 slide decks.
- Required (a whole number, **1 or more**) when the task is marked complete.
- Output Types marked **Not counted** in Site Settings › Output Types (currently **No Deliverable/Activity Only**) are always **0** and never ask for a number.
- Sessions are always 1. Parent tasks show N/A; cancelled tasks are skipped.
- Every counted task needs its number before the project can close.
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 1 and content not like '%### Output Count%';

update kb_entries set content = replace(content,
  '- **Operational** projects (e.g. Training Delivery) after Start Project: {slate:Ongoing}.',
  '- **Operational** projects (e.g. Training Delivery) and projects marked **Ongoing container**, after Start Project: {slate:Ongoing}.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 14;

update kb_entries set content = replace(content,
  '| **Output Type / Output Count** | What the task produces, and how many. Parent tasks show N/A. |',
  '| **Output Type / Output Count** | What the task produces, and how many. The count (1 or more) is required when the task is completed. Output Types marked **Not counted** in Site Settings (e.g. No Deliverable/Activity Only) are always 0. Parent tasks show N/A. |'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 10;

update kb_entries set content = content || $md$

### Output Counts before closing
Every completed task with a counted Output Type needs an **Output Count of 1 or more** before you can request closure. Tempo lists the tasks still missing one. Cancelled tasks and Output Types marked **Not counted** (e.g. No Deliverable/Activity Only) are skipped.
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 6 and content not like '%### Output Counts before closing%';

update kb_entries set content = content || $md$

### Ongoing container
Tick **Ongoing container** in **Project Information** for an open bucket of small requests rather than a project with an end deliverable, for example a quarterly **Content Revisions** project (Project Type BAU, Planning Type Ad Hoc). The project's Health and WBS Status show **Ongoing** and it's left out of health charts. Its **tasks** keep due dates, Due soon / Overdue / At Risk, and **extension requests**. Owner or Full Access only. See [[Operational Projects & Training Sessions]].
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 22 and content not like '%### Ongoing container%';

update kb_entries set content = content || $md$

### Ongoing containers (any project type)
Some work is a steady stream of small requests rather than a project, for example **quick revisions to existing decks and courses**. Track it in one project per quarter (e.g. **Content Revisions – Q4 2026**, Project Type **BAU**, Planning Type **Ad Hoc**) and tick **Ongoing container** in WBS › Project Information.

| | Training Delivery | Ongoing container |
|---|---|---|
| **Project Health / WBS Status** | Ongoing | Ongoing |
| **Health charts, overdue projects** | Left out | Left out |
| **Portfolio counts** | Included ("incl. N ongoing") | Included |
| **Adding work** | Add Session (trainers add their own) | Add Task in WBS (owner / Full Access) |
| **Task Due soon / Overdue / At Risk** | Yes | Yes |
| **Moving a date** | Reschedule session (no approval) | **Extension request** (approved and counted) |

**Revision tasks:** name them *Item – what's changing – requested by* (e.g. "FDA Claims deck – update slides 4–6 – Brad"), use Work Type **Content Revision**, and pick the item revised as the Output Type (Slide Deck, E-learning…) with how many were revised. Anything bigger (new objectives, new modules, a redesign, or more than about a day of work) should be its own project.

Click **Start Project** right away: until it's started, the people you assign can't see their tasks.
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 26 and content not like '%### Ongoing containers (any project type)%';

-- October 9 Release draft (still hidden)
update kb_entries set content = content || $md$

### Quick revisions now have their own ongoing project
Tick **Ongoing container** on a project (e.g. a quarterly BAU **Content Revisions** project) and it shows as **Ongoing** instead of being judged on dates, while every revision task still tracks Due soon, Overdue and extension requests.
**Related article:** [[Operational Projects & Training Sessions]]

### Output Count is now required when a task is completed
Every task needs to say how many items it produced (1 or more) when it's marked complete. Output Types that aren't deliverables (**No Deliverable/Activity Only**) are always 0, and Site Settings › Output Types shows which types are **Counted**.
**Related articles:** [[Tasks: Terms & Columns]] · [[Completing & Closing a Project]]
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 30 and content not like '%### Output Count is now required%';

select article_number n, updated_at > now() - interval '5 minutes' fresh,
  (content like '%Ongoing container%' or content like '%Output Count%') ok
from kb_entries where article_number in (1, 6, 10, 14, 22, 26, 30) order by 1;
