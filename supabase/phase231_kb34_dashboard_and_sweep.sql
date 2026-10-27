-- phase231 (2026-10-27, Sandra): KB-0034 "October 28 Release" now also covers the
-- My Dashboard refresh and the other changes from 27 Oct; KB sweep for the new
-- completion rules, dashboard names and "Awaiting My Approval". Versions saved first.
insert into kb_entry_versions (entry_id, title, content, edited_by)
  select id, title, content, updated_by from kb_entries where article_number in (4, 7, 8, 10, 15, 17, 18, 32, 34);

update kb_entries set content = $kb$**This release changes how task completion is recorded, gives My Dashboard a new, shorter layout, and tidies up a few things you use every day.** Tasks finished before 28 Oct and anything already waiting for validation are not changed.

## Marking a task Done

@@ Tempo records the completion date || When you mark a task Done, Tempo saves today's date. The Reported Completion date can't be typed or changed. || Mark tasks Done on the day you finish them.
@@ Finished early || Marked Done before the due date: the button reads **Submit for validation**, and the task goes to your supervisor in the Approval Center, as before. || Nothing extra to do. Your supervisor validates it.
@@ Finished on the due date || Recorded **On Time** straight away. No validation needed. || Mark it Done on the due date.
@@ One business day to report || On the next business day after the due date, Tempo asks **Was this task completed by its due date?** **Yes** records it On Time on the due date; **No** records it Late today. Weekends and holidays are skipped: a task due Fri 30 Oct can still be reported on Tue 3 Nov. || Answer honestly. Your answer is recorded.
@@ After that, it's Late || Marked Done later than the next business day: recorded **Late** with today's date. No validation needed. The tasks after it may move to make room (they show **Shifted**). || Need more time? Request an extension before the due date.
@@ Sessions logged after they happened || A task added after its due date (for example, a session logged the next day) is recorded on its due date. Logs older than 3 working days still need confirmation, as before. || Log sessions as soon as you can.

## The new My Dashboard

@@ My Work, in four tabs || **Needs Action** (overdue, plus due in the next 7 business days) · **Next 2 Weeks** · **Later** · **Waiting**. Each task appears once, most urgent first. || Start your day on Needs Action.
@@ Waiting tab || Tasks you can't start yet: who and what you're waiting on, and when it's expected. No timer until it's ready. Work you submitted that's with a reviewer shows here too. || Use it to plan ahead.
@@ Recent Updates || What changed on your work in the last 7 days: sent back for revision, due date shifted, newly assigned to you, and your requests decided. || Glance at it each morning.
@@ My Projects || Shows each project's **Target End** (the plan after approved extensions) and **+/-**, the working days later or earlier than the committed end. || Hover the Target End to see the committed date.
@@ Requests and approvals || **Pending Requests** = what you sent that's waiting for a decision. **Awaiting My Approval** = what you need to decide (the Approval Center tab has the same name now). || Reviews to do and work sent back to you appear in **Needs My Attention**.
@@ Cards stay the same size || Long lists scroll inside each card, so the page doesn't grow. **Effort vs Estimate** (logged vs planned hours, this month) and **Deliverable Progress** sit at the bottom. || Use View All on any card for the full list.

## Also new

@@ Log review time first || Reviewers and approvers log their review time before they **Pass QA**, **Approve** or send work back **For Revision**.
@@ My Open Tasks shows everything || On Projects & Tasks, **My Open Tasks** lists all your open tasks again; the **Next action** column says Ready or Waiting on… The separate Coming Up view is gone.
@@ Parent tasks for context || When a sub-task matches your filters, its parent task shows above it in grey, so you can see what it belongs to. Turn it off with **Show parent tasks** in the view settings.

## Want the detail?
- Validation: [[Validating Task Completion]]
- Extensions: [[Due Dates & Extensions After Project Start]]
$kb$, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 34;

-- Completion date is no longer typed (all projects, from 28 Oct).
update kb_entries set content = $n${accent:From 28 Oct} Tempo records the completion date when a task is marked Done; it can't be typed. Early completions still come here for validation. See [[October 28 Release]].

$n$ || content, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number in (7, 10, 15, 32) and position('{accent:From 28 Oct}' in content) = 0;

update kb_entries set content = replace(content, 'Mine to approve', 'Awaiting My Approval'), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number in (4, 17, 32) and content like '%Mine to approve%';

update kb_entries set content = replace(content, '**My Work Today** and **Tasks Due This Week**', '**My Work** and **Tasks Needing Action** on My Dashboard'), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 8;

update kb_entries set content = replace(content, '**My Dashboard → Overdue & Due This Week**', '**My Dashboard → My Work**'), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
where article_number = 18;

select string_agg(article_number || ':' || (case
  when article_number = 34 then (position('## The new My Dashboard' in content) > 0)::text
  when article_number in (7, 10, 15) then (position('{accent:From 28 Oct}' in content) > 0)::text
  when article_number = 32 then ((position('{accent:From 28 Oct}' in content) > 0) and position('Mine to approve' in content) = 0)::text
  when article_number in (4, 17) then (position('Mine to approve' in content) = 0)::text
  when article_number = 8 then (position('My Work Today' in content) = 0)::text
  when article_number = 18 then (position('Overdue & Due This Week' in content) = 0)::text end), ' ' order by article_number)
from kb_entries where article_number in (4, 7, 8, 10, 15, 17, 18, 32, 34);

update kb_entries set content = replace(content, 'Early completions still come here for validation.', 'Early completions still go to the Approval Center for validation.') where article_number in (10, 15, 32);
-- APPLIED TO LIVE 2026-10-27: all checks true.
