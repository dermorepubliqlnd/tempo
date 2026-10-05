-- phase151 KB (2026-10-05): trainer-facing how-to + weekly deck note.
-- Sandra: fold today's changes into the overall weekly release -- publish the
-- KB articles only, so the standalone "October 5 Release" note is archived
-- (recycle bin, restorable) and its content goes into the next weekly release.

insert into kb_entries (category_id, title, content, sort_order, updated_by)
select id, 'Trainers: Logging Your Training Sessions', $md$This guide is for **trainers**. Every session you deliver should be in Tempo, so your delivery hours count towards your **utilization and productivity**. Your checklists and pre/post-training tasks stay in your training app. In Tempo you only add the **session** and **log your time** on it.

### At a glance
1. **Add the session**: Projects & Tasks › Tasks › **Add Session**
2. **Log your time** on it: **timer** or **Add Time**
3. **Mark it Done** after delivery
4. Your project owner or supervisor **validates** it

### Before you start
- Sessions go into this quarter's **Training Delivery** project, e.g. **Training Delivery – Q4 2026**.
- Don't see the **Add Session** button? The project hasn't been started yet. Message your project owner.

### 1. Add your session
1. Go to **Projects & Tasks** and open the **Tasks** tab.
2. Click **Add Session** (top right).
3. Fill in:
   - **Project**: the current quarter is already selected.
   - **Session**: use *Program – Audience/Batch – Day*, e.g. **GMP Refresher – Production Batch 3 – Day 1**.
   - **Date**: the day you'll deliver it.
   - **Scoped hours**: how long the session will run, e.g. 2 or 4.
4. Click **Add session**. Adding a whole series? Use **Save & add another**.

The session is assigned to you and appears under **My Open Tasks**.

**Tip:** Add one session per batch, per day. A 2-day program for one batch = 2 sessions.

### 2. Log your time
Log time on the session the way you log any task:
- **Timer**: press ▶ on the session row when you start, and stop it when you finish.
- **Add Time**: forgot the timer? Go to **Time Tracking › Add Time**, pick the session and enter your start and end time.

Log the time you spend **delivering** the session. Pre- and post-training work follows your team's usual guidance.

### 3. Mark it Done
After the session, set the status to **Done**. It goes to your project owner or supervisor for **Task Completion Validation**, the same as any other task.

### If plans change
| What happened | What to do |
|---|---|
| **Session moved** to another date | Click the session's **Due** date › **Reschedule session** › pick the new date. No extension request needed. |
| **Session cancelled** | Set the status to **Cancelled** and choose a reason. |
| **Added by mistake** or a duplicate | Set it to **Cancelled** with a reason, or ask your project owner to delete it. |
| **Wrong session name or hours** | Edit it directly in the Tasks table (Name / Scoped Hours). |

### FAQs
**Do I need to add every session ahead of time?**
It helps. Sessions you add early show under **Upcoming** on the leaders' dashboard and in the weekly report. You can also add a session on the day itself.

**What counts in the reports?**
Sessions you mark **Done** (dated by completion), the **hours you log** on them, and sessions still **open after their date**. Please update those right away.

**Can I add a session for a co-trainer?**
No. Each trainer adds their own. Project owners and Full Access users can add sessions for anyone.

**Related articles:** [[Operational Projects & Training Sessions]] · [[Validating Task Completion]] · [[Correcting Time Logs]]
$md$, 1, 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
from kb_categories where name = 'Projects'
and not exists (select 1 from kb_entries where title = 'Trainers: Logging Your Training Sessions');

-- Operational article: point trainers to their guide + mention the weekly deck slide.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Operational Projects & Training Sessions';
update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6',
  content = replace(replace(content,
    '### Add a session (trainers)',
    '### Add a session (trainers)
Trainers: see the step-by-step guide [[Trainers: Logging Your Training Sessions]].
'),
    'Only tasks with Output Type **Session** count as sessions.',
    'Only tasks with Output Type **Session** count as sessions.

The **L&D Weekly Report** (Reports) has a **Training delivery** slide with the same numbers for the report week: delivered, validated, hours logged, scheduled this week and past date not Done, by trainer, plus quarter-to-date sessions. Operational projects are left out of the deck''s portfolio, health and mix slides.')
where title = 'Operational Projects & Training Sessions' and content not like '%Trainers: Logging Your Training Sessions%';

-- Weekly report article.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Reports — L&D Weekly Report (deck)';
update kb_entries set updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', content = content || $md$

### Training delivery slide
Comes after Team utilization (optional; on by default when there are Training Delivery projects). It shows sessions **delivered** and **validated** in the report week, **hours logged** on sessions, sessions **scheduled this week**, sessions **past their date and not Done**, a **by-trainer** table and **quarter-to-date** sessions. Training Delivery projects are operational, so they're left out of the Portfolio overview, Active project health and Portfolio mix slides. The Delivery card on Week at a Glance also mentions sessions delivered.

**Related article:** [[Operational Projects & Training Sessions]]
$md$
where title = 'Reports — L&D Weekly Report (deck)' and content not like '%Training delivery slide%';

-- Standalone release note -> recycle bin (content will be part of the weekly release).
update kb_entries set is_archived = true, archived_at = now(), archived_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6',
  archive_reason = 'Folded into the next weekly release (Sandra, 2026-10-05)', archive_is_root = true
where title = 'October 5 Release' and not is_archived;

select 'phase151' t,
 (select article_number from kb_entries where title = 'Trainers: Logging Your Training Sessions') trainer_kb,
 (select content like '%Trainers: Logging Your Training Sessions%' from kb_entries where title = 'Operational Projects & Training Sessions') op_link,
 (select content like '%Training delivery slide%' from kb_entries where title = 'Reports — L&D Weekly Report (deck)') deck_kb,
 (select is_archived from kb_entries where title = 'October 5 Release') rn_archived;
