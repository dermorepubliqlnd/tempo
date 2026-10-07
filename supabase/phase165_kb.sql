-- phase165 KB (2026-10-07): BAU renamed to "Operational" (Project Type).
-- The Site Settings flag that makes a whole type behave like Training
-- Delivery is now called "Ongoing" (Standard / Ongoing). KB wording follows:
-- "Operational" = the Project Type only; "Ongoing" = Health shows Ongoing.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where article_number in (1, 13, 14, 16, 18, 22, 26, 28, 30);

-- links everywhere (title of KB-0026 changes)
update kb_entries set content = replace(content, '[[Operational Projects & Training Sessions]]', '[[Ongoing Projects & Training Sessions]]')
where content like '%[[Operational Projects & Training Sessions]]%';

-- KB-0001 Properties: Project Type section + Health line
update kb_entries set content = replace(content,
  substring(content from position('### Project Type' in content) for position('### Owner' in content) - position('### Project Type' in content)),
$md$### Project Type
What kind of work the project is. Managed in Site Settings › Project Types.

**Options (current configuration):**
- **Operational** — work on content or programs that already exist, with its own deliverable and end date (e.g. a program rollout, a quarterly report, a refresh).
- **Internal** — building something new.
- **Curation** — curating existing or external content.
- **Training Delivery** — one project per quarter for delivered training sessions (always Ongoing). See [[Ongoing Projects & Training Sessions]].

Not sure which to pick? See [[Choosing a Project Type]].

$md$),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 1 and position('### Project Type' in content) > 0 and position('### Owner' in content) > position('### Project Type' in content);
update kb_entries set content = replace(content,
  '- **Operational project** (Project Type flagged Operational, e.g. Training Delivery) after Start Project → {slate:Ongoing}.',
  '- **Ongoing project** (Training Delivery, or any project marked **Ongoing container**) after Start Project → {slate:Ongoing}.')
where article_number = 1;

-- KB-0014 Projects glossary
update kb_entries set content = replace(replace(replace(content,
  '| **Project Type** | {success:BAU} (running existing training or a deployment), {accent:Development} (building new content), Training Delivery (operational, Health shows Ongoing). Managed in Site Settings. |',
  '| **Project Type** | What kind of work: **Operational** (work on existing content or programs), **Internal** (building something new), **Curation**, **Training Delivery** (always Ongoing). Managed in Site Settings. See [[Choosing a Project Type]]. |'),
  'Ongoing (operational projects), Closed. |', 'Ongoing (Training Delivery and Ongoing containers), Closed. |'),
  '- **Operational** projects (e.g. Training Delivery) and projects marked **Ongoing container**, after Start Project: {slate:Ongoing}.',
  '- **Ongoing** projects (Training Delivery and projects marked **Ongoing container**), after Start Project: {slate:Ongoing}.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 14;

-- KB-0013 WBS glossary
update kb_entries set content = replace(content,
  '- **Ongoing**: operational projects (e.g. Training Delivery) after Start Project.',
  '- **Ongoing**: Training Delivery projects and projects marked **Ongoing container**, after Start Project.'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 13;

-- KB-0018 Due dates
update kb_entries set content = replace(replace(content,
  '### Exception: sessions on operational projects', '### Exception: Training Delivery sessions'),
  'On an operational project (e.g. Training Delivery), a session that', 'On a Training Delivery project, a session that'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 18;

-- KB-0022 WBS
update kb_entries set content = replace(content, '(Project Type BAU, Planning Type Ad Hoc)', '(Project Type Operational, Planning Type Ad Hoc)'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 22;

-- KB-0030 October 9 Release draft
update kb_entries set content = replace(replace(content,
  'Project Types can be marked **Operational** (Site Settings).', 'Project Types can be set to **Ongoing** (Site Settings).'),
  '(e.g. a quarterly BAU **Content Revisions** project)', '(e.g. a quarterly **Content Revisions** project, Project Type Operational)'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 30;

-- KB-0026 full rewrite + rename
update kb_entries set title = 'Ongoing Projects & Training Sessions', content = $md$Some work never "finishes" the way a project does. Trainers deliver sessions all quarter, and small revision requests keep coming in. **Ongoing projects** are open containers for that kind of work, one per quarter. Their **tasks** are tracked normally, but the project itself shows Health **Ongoing** instead of being judged on dates.

### Two kinds of ongoing project
| | **Training Delivery** | **Ongoing container** (e.g. Content Revisions) |
|---|---|---|
| **How it becomes ongoing** | Its Project Type is set to **Ongoing** in Site Settings, so every Training Delivery project is | Tick **Ongoing container** in that project's WBS › Project Information |
| **Project Type** | Training Delivery | Usually **Operational** (or any type) |
| **Adding work** | **Add Session** — trainers add their own | **Add Task** in WBS (owner / Full Access) |
| **Moving a date** | **Reschedule session**, no approval | **Extension request**, approved and counted |
| **Task Due soon / Overdue / At Risk** | Yes | Yes |
| **Task Completion Validation** | Yes | Yes |
| **Project Health / WBS Status** | Ongoing | Ongoing |
| **Health charts, overdue projects** | Left out, noted "excludes N ongoing" | Left out |
| **Portfolio counts** | Included, noted "incl. N ongoing" | Included |

### Training Delivery
**Set up the quarter (project owner)**
1. Create the project (e.g. **Training Delivery – Q4 2026**) with Project Type **Training Delivery** and the quarter's Start and End dates.
2. Add any sessions you already know about, or leave it empty.
3. Click **Start Project** once. After that, trainers can add their own sessions.
4. At the end of the quarter, close it and start the next quarter's project.

**Add a session (trainers)** — see [[Trainers: Logging Your Training Sessions]].
1. Open this quarter's Training Delivery project and go to its **WBS**.
2. Click **Add Session**.
3. Enter the **session name** (e.g. "GMP Refresher – Production Batch 3"), the **Session Start Date** and **Session End Date** (the same date for a one-day session) and the **scoped hours** (total for the session).
4. Click **Add session**, or **Save & add another** to plot several in a row.

Each session is its own task with Work Type **Training Delivery**, Output Type **Session** and Output Count **1**. Project owners and Full Access can add sessions for any trainer, and can load a list at once with **Bulk Upload Sessions** (CSV: session, start date, end date, hours, trainer).

**Log time and finish:** log time on the session as usual (timer or Add Time), then mark it **Done** for validation. Session moved? Click its **Due** date › **Reschedule session** and set the new dates. Cancelled? Set the status to **Cancelled** with a reason.

### Training Delivery summary
**Projects Portfolio** has a **Training Delivery** section (This Month / Quarter / Year / All Time): sessions **delivered** (Done, dated by Actual Completion Date), **validated**, **upcoming**, **past date, not Done**, and **scoped / logged hours** per trainer. Only tasks with Output Type **Session** count as sessions. The weekly report has a matching **Training delivery** slide.

### Ongoing containers (e.g. Content Revisions)
Use one per quarter for a steady stream of small requests on existing content, e.g. **Content Revisions – Q4 2026** (Project Type **Operational**, Planning Type **Ad Hoc**, **Ongoing container** ticked).
- **Revision tasks:** name them *Item – what's changing – requested by* (e.g. "FDA Claims deck – update slides 4–6 – Brad"). Work Type **Content Revision**; Output Type = the item revised (Slide Deck, E-learning…), with how many were revised.
- Click **Start Project** right away: until it's started, the people you assign can't see their tasks.
- Anything bigger (new objectives, new modules, a redesign, or more than about a day of work) should be its own project. See [[Choosing a Project Type]].

**Related articles:** [[Choosing a Project Type]] · [[Validating Task Completion]] · [[Due Dates & Extensions After Project Start]]
$md$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 26;

-- NEW: Choosing a Project Type
insert into kb_entries (category_id, title, content, sort_order, is_active, created_by, updated_by)
select 'aae479c1-34d4-4fc7-b728-7c77ceae94e7', 'Choosing a Project Type', $md$Every request ends up in one of three places: its **own project**, a task in an **ongoing container**, or a **Training Delivery** session. Pick the place first, then the Project Type.

### Quick test
| The request | Put it in |
|---|---|
| Has its own goal and finish line, or more than about a day of work | **Its own project** |
| A small change to something already built: same objectives, a few hours | A task in the quarter's **Content Revisions** container |
| A training session being delivered | A session in the quarter's **Training Delivery** project |

### Project Types
| Type | Use it for | Examples |
|---|---|---|
| **Operational** | Work on content or programs that already exist, with its own deliverable and end date | Program rollout, quarterly report, onboarding journey refresh, the quarterly Content Revisions container |
| **Internal** | Building something new | New course, new tool or system |
| **Curation** | Curating existing or external content | Selecting and setting up library content |
| **Training Delivery** | Delivered training sessions, one project per quarter | Training Delivery – Q4 2026 |

### Normal project vs ongoing container
| | **Normal project** | **Ongoing container** |
|---|---|---|
| **What it is** | One piece of work with a deliverable and an end | A bucket of small, separate requests |
| **How many** | One per piece of work | One per quarter |
| **Plan** | Planned up front in the WBS; Start Project locks the baseline | Tasks added as requests come in |
| **Project Health** | On track / At risk / Overdue against its End date | **Ongoing** |
| **Tasks** | Due soon / Overdue, extension requests, validation | The same |
| **Closes when** | The deliverable is done | The quarter ends (open the next one) |

An **Operational** project is a normal project unless you tick **Ongoing container**. Only Training Delivery is ongoing for every project of its type.

**Related articles:** [[Ongoing Projects & Training Sessions]] · [[Properties]] · [[Draft Projects: Planning Before Start]]
$md$, 1, true, 'e7e52a30-4c13-449b-889d-280dc0ca16c6', 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where not exists (select 1 from kb_entries where title = 'Choosing a Project Type');

select (select count(*) from kb_entries e, regexp_matches(e.content, '(BAU|\{accent:Development\}|[Oo]perational project|Operational Projects &)', 'g') where not coalesce(e.is_archived,false) and e.article_number <> 21) leftovers,
  (select title from kb_entries where article_number = 26) t26,
  (select article_number from kb_entries where title = 'Choosing a Project Type') new_kb;
