-- Phase 57 migration (2026-09-21): proper dash usage (em/en dash instead
-- of "--") and color-coded {tone} pills reusing the app's own
-- .status-pill palette, in the Knowledge Base's Project Properties entry.
--
-- Sandra: "can you not use double dash? use propero techncial writing
-- buy proepro use of hyphen en and em dahses whenneeded" then, mid-turn,
-- "use colors id needed to to create thatvisual retaiention and
-- consitency" -- so this both fixes the writing style (em dash for
-- asides, en dash for the "11-20 points" range, plain hyphen only for
-- true hyphenation like "admin-configurable") AND adds a small
-- {tone:Label} inline syntax to renderMarkdownLite (KnowledgeBase.tsx)
-- that renders as the exact same colored .status-pill the rest of the
-- app already uses for that value (PROJECT_STATUS_TONES, PROJECT_PHASE_
-- TONES, PROJECT_EFFORT_LEVEL_TONES, priorityTone/planningTypeTone/
-- projectTypeTone in src/pages/Projects.tsx and src/lib/notionOptions.ts)
-- -- so a property's Options list is visually consistent with, not just
-- descriptive of, what the person already sees on the Projects table.

update kb_entries
set
  content = $md$## Project Properties

Definitions for every field on the Projects table and WBS page. Click a property to expand it.

### Project ID
Auto-generated identifier (e.g. P-0001), assigned once at Start Project. Not editable, and not admin-configurable: it is a straight incrementing sequence.

### Description
Required free-text summary of what the project is and why it exists.

**Options:** free text, no fixed list. Required at Start Project, and required again at Closure (can be updated to reflect what was actually delivered).

### Status
The project's lifecycle state.

**Options:**
- {neutral:Not Started} — work hasn't begun. Also the value Status is locked to while the project is still in Draft, before baseline approval.
- {accent:In Progress} — actively being worked on.
- {success:Completed} — all scoped work is done and closed out.
- {purple:Paused} — temporarily stopped. Phase freezes at wherever it already was and doesn't change until the project resumes.
- {danger:Cancelled} — abandoned before completion. Also freezes Phase, but is tracked separately from Completed so it's never counted as finished work.

### Phase
The current pipeline stage of work, within Status. Phase is an admin-configurable list (Site Settings), and which phases are offered depends on the project's current Status.

**Options (current configuration):**
- While Not Started: {neutral:Backlog}, {neutral:Queued}
- While In Progress: {warning:Scoping}, {pink:Design}, {gold:Development}, {warning:Evaluation}, {accent:Delivery}
- Once Completed: forced to {success:Done} automatically
- While Paused or Cancelled: frozen — keeps whatever phase it was already on, no new options offered

### Health
A computed indicator of whether the project is tracking to plan. Not manually set.

**Formula:**
- Completed or Cancelled status → shows the status itself (no health calculation needed)
- Paused → {purple:Paused}
- Still in Draft (before baseline approval) → {neutral:Not started}, regardless of dates
- Task progress has reached 100% → {success:Completed}
- Missing start/due dates, or zero working days between them → {slate:Health unavailable}
- Today is before the start date → {neutral:Not started}
- Today is past the due date → {danger:Overdue}
- Otherwise: `expected % = elapsed working days / total working days`, compared against **Actual Progress**:
  - behind by 10 points or less → {success:On track}
  - behind by 11–20 points → {warning:At risk}
  - behind by more than 20 points → {danger:Off track}

### Priority
A relative urgency marker, shown as a directional symbol.

**Options:**
- {success:Low} ↓
- {warning:Medium} →
- {danger:High} ↑

### Actual Progress
The percentage of the project's scoped work that is complete, rolled up from its tasks.

**Formula:** each non-parent task contributes its own Scoped Hours as a weight, multiplied by a completion factor (Not Started = 0%, In Progress = 50%, Done = 100%), summed and divided by total Scoped Hours across all tasks: `sum(hours × factor) / sum(hours) × 100`. If no task has hours scoped yet, falls back to a plain equal-weight average of task status instead.

### Planning Type
Whether the project was scoped and scheduled in advance, or came in outside the normal planning cycle.

**Options:**
- {success:Planned} — went through the normal scoping/planning cycle ahead of time.
- {warning:Ad Hoc} — raised outside that cycle, e.g. an urgent or unplanned request.

### Project Type
Whether the work is operational or a new build.

**Options:**
- {success:BAU} — business-as-usual: sessions of already-built training, or a program deployment.
- {accent:Development} — building new content.

### Owner
The person accountable for the project overall: distinct from a task's Assignee, who owns one individual task within it.

### Category
An admin-configurable tag describing the subject area of the work (e.g. Onboarding, Leadership, Technical & Systems, Regulatory Compliance). Managed in Site Settings — Full Access can add, rename, recolor or retire categories there, so the current list is best checked there rather than memorized.

### Source
Where the project request originated (e.g. an internal L&D Initiative vs. an external Intake request). Admin-configurable in Site Settings, same as Category.

### Complexity
A scoping-time estimate of how involved the work is, set before Start Project.

**Options:**
- {success:Level 1} — straightforward.
- {warning:Level 2} — moderate.
- {danger:Level 3} — most involved.

Shown as either a symbol or the text label depending on the display toggle on the Projects table.

### Start / Due
The project's planned start and due dates, set at scoping and locked once the baseline is approved. After that, moving the Due date requires an approved Extension Request rather than a direct edit.

### Scoped Hours
The total estimated effort for the project.

**Formula:** sum of Scoped Hours across every leaf task (a task with no sub-tasks of its own) in the project. A parent task's own hours are excluded since a parent's Scoped Hours already equals the sum of its children, to avoid double-counting.

### Spent Hrs
Actual hours logged against the project's tasks via Time Tracking.

**Formula:** sum of each task's own logged time entries, across every task in the project (parent and child alike, since each only counts its own direct entries).

### Hrs Variance
The raw difference between hours logged and hours scoped.

**Formula:** `Spent Hrs − Scoped Hours`. Negative means under budget, positive means over.

### Hrs Variance %
Hours logged as a percentage of hours scoped: how much of the budget has been consumed, not the variance itself.

**Formula:** `Spent Hrs / Scoped Hours × 100`. For example, 57.5 Scoped Hours and 792.3 Spent Hrs reads as 1378%.

Color coding: {success:100% or under} is on-budget, up to {warning:125%} is a warning, over {danger:125%} is over-budget.

### Days Extended
How many days the project's due date has drifted from its original baseline.

**Formula:** `current Due date − original Due date (as of the last time the baseline was locked)`, in days. Only moves when an Extension Request is approved. Blank until the project has been baseline-locked at least once.

### Baseline Approved By / On
Who approved the project's baseline (locking its scope, dates and hours) and when. Blank until the project leaves Draft.

### Actual Close Date
The date the project was actually closed out, captured at Closure. Distinct from the originally planned Due date: comparing the two shows whether the project closed on time.
$md$,
  updated_at = now()
where title = 'Properties'
  and category_id = (select id from kb_categories where name = 'Projects');
