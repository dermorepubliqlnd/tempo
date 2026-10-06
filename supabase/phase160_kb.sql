-- phase160 KB (2026-10-06): audit corrections (wrong facts, stale text,
-- text hidden in collapsed sections). Sandra = e7e52a30-4c13-449b-889d-280dc0ca16c6
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where article_number in (1, 2, 4, 10, 11, 13, 14, 15, 16, 18, 23, 28);

-- KB-0010 Tasks glossary
update kb_entries set content = rtrim(left(content, position('### Draft timeline' in content) - 1)) || E'\n'
where article_number = 10 and position('### Draft timeline' in content) > 0;
update kb_entries set content = replace(replace(replace(replace(replace(content,
  '| **Assignee** | The one person accountable for the task. Not required to lock the plan. |',
  '| **Assignee** | The one person accountable for the task. Required on every task (except parent tasks) before Start Project. After the project starts it can be changed but not removed. |'),
  'Done tasks: {success:Early}, {success:On time}, {danger:Late}, based on completion date vs Due. Cancelled: N/A. |',
  'Done tasks: {success:Early}, {success:On time}, {danger:Late}, based on completion date vs Due. Cancelled: N/A. Draft projects: {neutral:Draft timeline} (dates are tentative). Paused projects: {purple:Paused}, {purple:Paused · Overdue} or {gold:Review pending}. |'),
  '| **Days +/-** | Completion date minus Due, e.g. "+2d late" or "3d early". |',
  '| **Days +/-** | Completion date minus Due, e.g. "+2d late" or "3d early". Blank on Draft projects. |'),
  '### Views & groupings (added 2026-10-04)', '### Views & groupings'),
  'Overdue, Today, This week, Next week, Later, No due date. Weeks run Monday to Sunday. |',
  'Overdue, Today, This week, Next week, Later, Draft timeline, No due date. Weeks run Monday to Sunday. |')
  || E'| **New assignments** | Tasks that became yours in the last 7 days because their project was started (My Dashboard). |\n',
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 10 and content not like '%| **New assignments** |%';

-- KB-0001 Properties
update kb_entries set content = replace(replace(replace(replace(replace(content,
  'Auto-generated identifier (e.g. P-0001), assigned once at Start Project. Not editable',
  'Auto-generated identifier (e.g. P-0001), assigned when the project is created (Draft projects have one too). Not editable'),
  E'**Options:**\n- {success:BAU} — business-as-usual: sessions of already-built training, or a program deployment.\n- {accent:Development} — building new content.',
  E'Managed in Site Settings › Project Types. A type can be marked **Operational**; projects of that type grow as sessions are added and show Health as {slate:Ongoing}.\n\n**Options (current configuration):**\n- {success:BAU} — business-as-usual: sessions of already-built training, or a program deployment.\n- {accent:Development} — building new content.\n- **Training Delivery** (Operational) — one project per quarter for delivered training sessions. See [[Operational Projects & Training Sessions]].'),
  '- **Project:** Category, Source, Complexity and Description are filled in.',
  '- **Project:** Priority, Planning Type, Project Type, Category, Source, Complexity and Description are filled in.'),
  '- **Every task has an Assignee** (added Oct 1, 2026).',
  '- **Every task has an Assignee.**'),
  '`current Due date − original Due date (as of the last time the baseline was locked)`, in days.',
  '`current Due date − original Due date (as of the last time the baseline was locked)`, in **working days** (Mon–Fri, excluding holidays). Hover to see calendar days.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 1;

-- KB-0014 Projects glossary
update kb_entries set content = replace(replace(replace(replace(replace(content,
  '| **Project ID** | Auto ID (P-0001). Assigned once at Start Project. Not editable. |',
  '| **Project ID** | Auto ID (P-0001). Assigned when the project is created. Not editable. |'),
  '- Progress at 100% but Status not yet Completed: {success:Work complete}.',
  E'- Progress at 100% but Status not yet Completed: {success:Done on time · close pending} or {gold:Done late · close pending}.\n- **Operational** projects (e.g. Training Delivery) after Start Project: {slate:Ongoing}.'),
  'Draft, Awaiting Baseline Approval, Start Project Declined, Baseline Locked, Revision in Progress, Changed After Baseline, Closed. |',
  'Draft, Awaiting Baseline Approval, Start Project Declined, Baseline Locked, Changed After Baseline, Ongoing (operational projects), Closed. |'),
  '{success:BAU} (running existing training or a deployment) vs {accent:Development} (building new content). |',
  '{success:BAU} (running existing training or a deployment), {accent:Development} (building new content), Training Delivery (operational, Health shows Ongoing). Managed in Site Settings. |'),
  '### Portfolio columns (added 2026-10-04)', '### Portfolio columns'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 14;
update kb_entries set content = replace(content,
  E'| **Days Extended** | Working days the project''s End Date has moved past its baseline through approved extensions. |\n', '')
where article_number = 14;

-- KB-0013 WBS glossary
update kb_entries set content = replace(replace(replace(replace(content,
  '- **Revision in Progress**: editing is unlocked for this revision only.',
  '- **Revision in Progress**: older projects only (re-baselining was retired).'),
  '- **Closed**: final scope is locked and the project can''t be reopened.',
  E'- **Ongoing**: operational projects (e.g. Training Delivery) after Start Project. No baseline variance.\n- **Closed**: final scope and numbers are locked. No new time or task changes. If it was closed too early, it can be reopened from the WBS (see [[Completing & Closing a Project]]).'),
  '> **Saving the WBS after Project Start:** start dates', E'### Saving the WBS after Project Start\nStart dates'),
  'See **Due Dates & Extensions After Project Start**.', '**Related article:** [[Due Dates & Extensions After Project Start]]'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 13;

-- KB-0004 Approval Rights
update kb_entries set content = replace(replace(content,
  '- **Approval Center** appears in the menu only for people with approval authority: Full Access, either Approval Right, or at least one active person reporting to them.',
  '- **Approval Center** is open to everyone. **My Requests** shows what you''ve sent and its outcome. People with approval authority (Full Access, either Approval Right, or at least one active person reporting to them) also see **Mine to approve**.'),
  '- Inside Approval Center, everyone sees only the requests they can decide. **Other pending approvals** (requests someone else must decide) is visible to Full Access only.',
  '- Each request is routed to **one** approver and appears in their **Mine to approve**. **Team view** (read-only, with Override) shows items routed to someone else. See [[Approval Routing & Delegation]].'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 4;
update kb_entries set content = replace(content,
  substring(content from position('> **Routing (since Oct 2026):**' in content) for position('### Awaiting My Approval on My Dashboard' in content) - position('> **Routing (since Oct 2026):**' in content)), '')
where article_number = 4 and position('> **Routing (since Oct 2026):**' in content) > 0;

-- KB-0011 Utilization glossary
update kb_entries set content = replace(replace(replace(content,
  '- **Committed** = started (approved) projects only. Turn on **Include pending projects** in Advanced Filters to add Draft projects.',
  '- **Committed** = started (approved) projects only. Turn on **Include Planned / Pipeline (Draft projects)** in Advanced Filters to add Draft hours (see below).'),
  '- **Advanced Filters:** Project, Include pending projects, Show inactive team members.',
  '- **Advanced Filters:** Project, Include Planned / Pipeline (Draft projects), Show inactive team members.'),
  '### When stopped work stops counting (from 2026-10-04)', '### When stopped work stops counting'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 11;

-- KB-0015 Team Dashboard
update kb_entries set content = replace(replace(replace(replace(replace(replace(content,
  '**Sidebar order:** My Dashboard → Projects Portfolio (the former Team Dashboard: donuts, Needs Attention, Active Projects table) → Team Dashboard.',
  '**Two views** (toggle at the top): **Executive Dashboard** (default, described below) and **Projects Portfolio** (donuts, Needs Attention, Active Projects table and the Training Delivery summary).'),
  E'### Views\nThe Team Dashboard has two views (toggle at the top): **Executive Dashboard** (default) and **Projects Portfolio** (the former standalone page, unchanged).\n\n', ''),
  '| **Active** | Status = In Progress (today''s status). |',
  '| **Active** | Status = In Progress (today''s status). Includes ongoing Training Delivery projects, noted as "incl. N Training Delivery". |'),
  '| **Overdue** | Active projects whose **Health** is Overdue. Status and Health are separate concepts. |',
  '| **Overdue** | Active projects whose **Health** is Overdue. Status and Health are separate concepts. Training Delivery projects are left out (their Health is always Ongoing). |'),
  '| **Planned Utilization** | Planned workload ÷ available capacity over the next 2 weeks. Same engine as the Utilization page. |',
  '| **Planned Utilization** | Planned workload ÷ available capacity over the next 2 weeks. Same engine as the Utilization page. Counts **started** projects only; Draft work is Planned / Pipeline and isn''t included. |'),
  'Not affected by the Reporting Period. Four donuts: Health, Phase, Planning Type, Project Type.',
  'Not affected by the Reporting Period. Four donuts: Health, Phase, Planning Type, Project Type. Training Delivery projects are left out of Health (always Ongoing), with a note.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 15;

-- KB-0018 Due dates
update kb_entries set content = replace(replace(content,
  '**Draft projects** (not yet started) are not locked; the plan sets the dates freely.',
  '**Draft projects** (not yet started) are not locked; the plan sets the dates freely. Their dates are tentative and don''t count as due or overdue. See [[Draft Projects: Planning Before Start]].'),
  'click the session''s **Due** date and use **Reschedule session**. The new date applies right away, with no extension request or approval.',
  'click the session''s **Due** date and use **Reschedule session** to set new start and end dates. The new dates apply right away, with no extension request or approval.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 18;

-- KB-0028 Trainers
update kb_entries set content = replace(replace(content,
  E'   - **Project**: the current quarter is already selected.\n', ''),
  '- Don''t see the **Add Session** button? The project hasn''t been started yet. Message your project owner.',
  '- Tempo says the project **hasn''t been started yet**? Ask your project owner to Start Project first.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 28;

-- KB-0002 Non-Project Time
update kb_entries set content = replace(replace(content,
  E'## Two ways to log it\n\nThere are two ways to log it:\n\n', E'## Two ways to log it\n\n'),
  '| Others | Anything that doesn''t fit the categories above | Required |',
  E'| RICA CMC Reviews | L&D''s review of company-wide SOP revisions and new SOPs (review cycles) | Optional |\n| Others | Anything that doesn''t fit the categories above | Required |'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 2 and content not like '%RICA CMC Reviews%';

-- KB-0023 Tabs & Views: move the Draft timeline note out of the collapsed "Notes" section
update kb_entries set content = replace(
  rtrim(replace(content, '**Draft timeline** groups tasks on projects that haven''t started yet. Their dates are tentative, so they never count as overdue or due. See [[Draft Projects: Planning Before Start]].', '')) || E'\n',
  E'| **All Open Tasks / All Tasks** | Everyone''s | Assignee / Project |\n',
  E'| **All Open Tasks / All Tasks** | Everyone''s | Assignee / Project |\n\n**Draft timeline** groups tasks on projects that haven''t started yet. Their dates are tentative, so they never count as overdue or due. See [[Draft Projects: Planning Before Start]].\n'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 23;

-- KB-0016 Reports deck: full rewrite (slides as built today)
update kb_entries set content = $md$**Admin → Reports** builds the weekly L&D report for Brad as a PowerPoint deck on the official Dermorepubliq template (logo, footer, Poppins fonts and brand colours come from the template). Full Access only.

### How to use it
1. Pick the **Report week**, always **Monday to Friday**. The default is last week (the report is usually prepared on Monday or Tuesday).
2. Review the numbers strip, then edit the **Week at a glance** cards, the **Asks for Brad** (one per line, "Label: text"), any **slide title** and the **Speaker notes**. Everything is drafted from Tempo data.
3. Untick **Delivery drivers**, **Training delivery** or **Appendix** if you don't need them. The slide count updates.
4. Click **Generate deck (.pptx)**. Charts and tables are native PowerPoint objects, so you can still edit them.

Edits on the page aren't saved; generate the deck once it reads right. **Reset text** re-drafts everything from the data.

### Time windows
| Term | Meaning |
|---|---|
| **Last week** | The selected report week, Mon–Fri. |
| **This week** | The Mon–Fri right after the report week. |
| **Next week** | The Mon–Fri after that. |
| **Year to date** | 1 January to the report week's Friday. |
| **Current state** | Health, overdue and paused lists use today's status (same as the Team Dashboard). |

### Slides
| # | Slide | What it shows |
|---|---|---|
| 1 | Cover | Report week and who it's prepared for. |
| 2 | **Week at a glance** | Two cards about last week. **Delivery** (green): the projects completed, each marked on time or late. **Pipeline** (blue): projects starting this week, new intake and paused projects, plus "+N awaiting Start Project approval". Then the **Asks for Brad**. |
| 3 | **Portfolio overview** | **Total projects this year** (completed this year + open today), **Active projects** (In Progress project work today, the same number as the Health chart) and **Training Delivery**, plus **Portfolio movement**, a monthly line of projects started vs completed. |
| 4 | **Work mix & effort allocation** | Scoped Hours this year by **Project Type**, split by Planning Type (same method as the Executive Dashboard), with **Active project health** and **phase** donuts (Training Delivery excluded). |
| 5 | **Active project health** | Health of In Progress projects, overdue projects with days late, and projects due this week. |
| 6 | **Delivery drivers** (optional) | For up to 5 overdue projects: tasks added after Start Project, date changes and removed tasks, tasks still past due, extension requests and notes, from Tempo's change history. |
| 7 | **Project pipeline** | Completed last week · New intake last week · Starting this week (Start Project approved only) · Paused (days paused and expected resume; red = not set or past). |
| 8 | **Team utilization** | By role: last week **actual** (finalized logged ÷ expected), this and next week **planned** (task allocations ÷ capacity). Red = over 100%. Roles with one person are individual figures. |
| 9 | **Training delivery** (optional, on when there are Training Delivery projects) | Sessions delivered and validated last week, hours logged on sessions, sessions scheduled this week, sessions past their date and not Done, a by-trainer table and quarter-to-date sessions. |
| 10 | **Appendix** (optional) | Project Type × Planning Type across all projects (excl. Cancelled). |

### Speaker notes
Every slide's **Notes** (in PowerPoint) list the names and reasons behind its numbers, so you can answer follow-up questions: projects completed on time or late, tasks finished late, who has 2h+ not logged, non-project time by activity, tasks 25%+ over estimate, starting/intake/paused projects with pause reasons and expected resume, overdue projects and **why they slipped**, utilization by person, and the sessions behind the training numbers. The **Asks for Brad** are added to the first slide's notes. Open **Speaker notes** on the Reports page to read or edit them before generating.

### Why "Active" and the Health count can differ
**Active projects** on the Portfolio overview and the Health chart both count In Progress project work. **Training Delivery** is shown as its own number, because its health is always "Ongoing". Projects planned to start this week but **Paused** appear under Paused, not under Starting this week. Drafts planned for this week are shown as "+N awaiting Start Project approval".

### Utilization colours
| Band | Colour |
|---|---|
| Under 60% | Clarify (tan): has room |
| 60–80% | Green: healthy |
| 81–100% | Amber: high |
| Over 100% | Red: over capacity |

### Good to know
- Only people tagged **Expected to log time** count toward expected hours and utilization.
- Logged hours are **Confirmed / Approved** time only and start from the Site settings **Time tracking start date**.
- Delivery drivers are only as good as the history: an **extension request with a reason** (instead of a direct date edit) makes the "why" explicit.

**Related articles:** [[Team Dashboard (L&D Executive Dashboard)]] · [[Operational Projects & Training Sessions]]
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 16;

select article_number n,
  case article_number
    when 10 then (content like '%Required on every task (except parent tasks)%' and content like '%| **New assignments** |%' and content not like '%### Draft timeline%' and content like '%Later, Draft timeline, No due date%')
    when 1 then (content like '%assigned when the project is created%' and content like '%Priority, Planning Type, Project Type, Category%' and content like '%Training Delivery** (Operational)%' and content like '%in **working days**%')
    when 14 then (content like '%Assigned when the project is created%' and content like '%close pending%' and content like '%Ongoing (operational projects)%' and content not like '%(added 2026-10-04)%')
    when 13 then (content like '%older projects only%' and content like '%### Saving the WBS after Project Start%' and content like '%- **Ongoing**%')
    when 4 then (content like '%is open to everyone%' and content like '%**Team view** (read-only%' and content not like '%Routing (since Oct 2026)%')
    when 11 then (content not like '%Include pending projects%')
    when 15 then (content like '%**Two views**%' and content not like '%Sidebar order%' and content like '%incl. N Training Delivery%' and content like '%Counts **started** projects only%')
    when 18 then (content like '%set new start and end dates%' and content like '%[[Draft Projects: Planning Before Start]]%')
    when 28 then (content not like '%already selected%' and content like '%hasn''t been started yet**?%')
    when 2 then (content like '%RICA CMC Reviews%' and content not like '%There are two ways to log it:%')
    when 23 then (position('**Draft timeline** groups' in content) < position('### Board view cards' in content))
    when 16 then (content like '%Work mix & effort allocation%' and content not like '%Portfolio Mix | One 100%%')
  end ok
from kb_entries where article_number in (1, 2, 4, 10, 11, 13, 14, 15, 16, 18, 23, 28) order by 1;
