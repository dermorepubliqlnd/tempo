-- phase201 KB (2026-10-14): KB-0033 = October 16 Release note, kept as a DRAFT
-- (is_active = false: hidden on live, visible on preview to Full Access).
-- Release day: update kb_entries set is_active = true, updated_at = now() where article_number = 33;
insert into kb_entry_versions (entry_id, title, content, edited_by)
  select id, title, content, updated_by from kb_entries where article_number = 33;
update kb_entries set title = 'October 16 Release', is_active = false, updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now(), content = $q$**At a glance:** New projects now follow the L&D project lifecycle: five phases, ready-made task templates, and modules that move from design to sign-off in order. Reviews have their own buttons, so work is handed to the reviewer and sent back **For Revision** with a comment instead of being reopened. The WBS is easier to read, with phase progress, filters, column views and a separate Timeline. My Dashboard shows only what needs you now. Projects created before 13 Oct work as before.

## The L&D project lifecycle (new projects)

### Five phases
New projects follow five phases: {accent:Analysis & Scoping} {mint:Design} {purple:Development} {orange:Implementation} {pink:Evaluation & Closure}. In Draft, the owner picks the phases the project needs; they lock at **Start Project**. Each phase ends with a milestone, and the project's Phase moves forward as milestones are reached.
**Related article:** [[Draft Projects: Planning Before Start]]

### Task templates for each phase
A phase with no tasks yet shows a template button on its header (for example **Analysis & Scoping** adds Discovery Call → Needs Analysis → Scope Statement → Review Scope → Scope Sign-Off, already linked in order). Work Types are suggested from the template; Output Types stay free to choose. Sign-offs use **Quality Assurance**, and **System Configuration** always counts as 1 output.

### Modules for design and build
**Add module** creates one module's chain, linked in order: Design / Storyboard → Review · Design → Sign-Off · Design in Design, then Build → Review · Build → Sign-Off · Build in Development. Every task name ends with the module name, so everyone can see which module they're working on. On the WBS, **Group by Module** lists each module from design to sign-off.

## Reviews and completing tasks

### Next step buttons
On new projects, the **Next step** column shows what to do:
- **Ready for Review** on work that a review depends on. It runs the same checks as Done (Logged hours, Output Count) and hands the task to the reviewer.
- **Pass QA** on review steps and **Approve** on sign-offs.
- **For Revision** sends the work back to its owner with your comment. The task returns to In Progress and its revision count goes up. No reopening needed.
Tasks still waiting on someone else's task show **Waiting** and can't be started yet.

### Completing a task
Marking a task Done (status, board or button) opens one pop-up: the due date, **Reported Completion** date, Work Type and Output Type (changes are kept in the Audit Trail), Output Count and Logged hours, with **+ Log time** if hours are missing.

### Reopening Done work
Done work isn't reopened directly once the next step has started. Use **For Revision** on the review step instead, so the history stays clear.

## My Dashboard

### Only what needs you now
Your to-do lists (My Work Today, Overdue, Due this week) show only tasks you can act on now. Tasks waiting on someone else's task move to **What's next**, with who they're waiting on and the expected date. Parent tasks and tasks of Draft projects still being planned stay out, except Analysis & Scoping tasks.

### Waiting for you
A new card lists reviews and sign-offs ready for you, work sent back to you **For Revision** (with the comment), and your work sitting with a reviewer.

## WBS

### Phase progress and filters
New projects show a card per phase with % done (real tasks only; milestones and cancelled tasks don't count). Click a card to show only that phase. The toolbar has **Search**, Phase, Module, Status, Assignee and Work Type filters. While a filter is on, reordering and adding tasks are paused; **Clear** brings everything back.

### Column views
Choose **Essential** (Task, Depends on, Assignee, Status, Estimated Hours, Forecasted Start and End), **Planning** (adds Work Type, Output Type and Duration) or **Full** (every column). Tempo remembers your choice on your computer. Status on the WBS is read-only; change it from Tasks or the Next step buttons.
**Tip:** in Draft, use **Planning** to fill Work Type and Output Type before Start Project.

### Timeline tab
The Gantt now has its own **Timeline** tab, on both the project Overview and the WBS. Bars use the phase colours on new projects. Choose Forecasted, Theoretical or both.

### Smaller WBS changes
- The column headers stay visible while you scroll.
- Move up / Move down keeps a task inside its own phase.
- A task's phase can't be changed by bulk edit or by dragging it on the board; use the row menu › **Move to phase**.

## Ongoing projects and who can edit (live since 14 Oct)

### Ongoing containers
On an Ongoing project (for example Training Delivery or Ongoing Task), anyone can add tasks for themselves, and supervisors can add them for their team. You can edit your own task, including its dates, until its due date passes. New tasks start with today's date.
**Related article:** [[Ongoing Projects & Training Sessions]]

### Normal projects
Only the project owner, the owner's supervisor or Full Access can add tasks or change a task's plan (name, dates, hours, assignee). Assignees still update status, completion, Output Count and notes.

### Logged late and Extended
A task created after its due date shows **Logged late** once Done, or **Extended** if it's still open. Late logs older than 3 working days need the owner, the assignee's manager or Full Access to **Confirm**.

## Across Tempo

### Dates read the same everywhere
Every date in Tempo now shows as **mm/dd/yyyy**, including date boxes in pop-ups and forms, whatever your computer's regional setting.

## Good to know
- Projects created before 13 Oct keep their current phases, columns and workflow.
- The 3-working-day rule for Logged late doesn't count holidays yet.
$q$
where article_number = 33;
select article_number, title, is_active, length(content) from kb_entries where article_number = 33;
