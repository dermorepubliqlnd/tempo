-- phase229 (2026-10-27, Sandra): KB "What's new" for the task completion rules
-- (phase228), dated the October 28 release. New article (KB-0034), same category as KB-0033.
insert into public.kb_entries (category_id, title, content, sort_order, is_active, is_pinned, created_by, updated_by)
values ('bc5dda9d-1b96-472d-a1ac-72f8b8ccc150', 'October 28 Release', $kb$**Tempo now records the date you mark a task Done.** You no longer type a completion date. How the task is recorded depends on when you mark it Done compared with its due date. This applies to every project, for tasks marked Done from 28 Oct onward.

## What changed, and what you do

@@ Tempo records the completion date || When you mark a task Done, Tempo saves today's date. The Reported Completion date can't be typed or changed. || Mark tasks Done on the day you finish them.
@@ Finished early || Marked Done before the due date: the button reads **Submit for validation**, and the task goes to your supervisor in the Approval Center, as before. || Nothing extra to do. Your supervisor validates it.
@@ Finished on the due date || Recorded **On Time** straight away. No validation needed. || Mark it Done on the due date.
@@ One business day to report || On the next business day after the due date, Tempo asks **Was this task completed by its due date?** **Yes** records it On Time on the due date; **No** records it Late today. Weekends and holidays are skipped: a task due Fri 30 Oct can still be reported on Tue 3 Nov. || Answer honestly. Your answer is recorded.
@@ After that, it's Late || Marked Done later than the next business day: recorded **Late** with today's date. No validation needed. The tasks after it may move to make room (they show **Shifted**). || Need more time? Request an extension before the due date.
@@ Sessions logged after they happened || A task added after its due date (for example, a session logged the next day) is recorded on its due date. Logs older than 3 working days still need confirmation, as before. || Log sessions as soon as you can.

## Good to know

- **Not changing:** reviews and sign-offs (Pass QA, Approve, For Revision), Draft projects, and tasks finished before 28 Oct.
- **Already waiting for validation?** Those tasks stay in the Approval Center and are handled as before.
- **Marked Done by mistake?** On-time and late tasks are confirmed straight away, so ask Full Access or the project owner to reopen it.
$kb$, 0, true, false, 'e7e52a30-4c13-449b-889d-280dc0ca16c6', 'e7e52a30-4c13-449b-889d-280dc0ca16c6');
select article_number, title, is_active from public.kb_entries where title = 'October 28 Release';
