-- Phase 110 (2026-09-24): Follow-up time logs on Done / validated tasks.
-- Sandra: feedback can come back after a task is validated and the person
-- has to make corrections -- give them a sanctioned way to log that time
-- instead of reopening the task or having an admin log it silently.
--   - Assignee logs it (Full Access may log on behalf, e.g. person on leave).
--   - Required reason: Late feedback / Validated too early / Scope change.
--   - Always goes to approval (pending_approval) -> Approval Center, same
--     approvers as any manual project time entry.
--   - Task stays Done and keeps its validated date.
--   - Tagged is_follow_up so reports can separate rework hours.
--   - Closed projects still accept no new time (their Final Scope is frozen).
alter table time_entries add column if not exists is_follow_up boolean not null default false;
alter table time_entries add column if not exists follow_up_reason text;
alter table time_entries drop constraint if exists time_entries_follow_up_reason_chk;
alter table time_entries add constraint time_entries_follow_up_reason_chk
  check (follow_up_reason is null or follow_up_reason in ('late_feedback','validated_too_early','scope_change'));

create or replace function submit_follow_up_time_entry(
  p_task_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason text,
  p_notes text default null
) returns uuid
language plpgsql security definer as $$
declare
  v_task tasks%rowtype;
  v_conflict uuid;
  v_id uuid;
  v_on_behalf boolean;
begin
  select * into v_task from tasks where id = p_task_id;
  if v_task.id is null or v_task.is_archived then
    raise exception 'task not found';
  end if;
  if v_task.assignee_id is null then
    raise exception 'this task has no assignee';
  end if;
  if coalesce(v_task.status, '') <> 'Done' then
    raise exception 'follow-up time is only for tasks that are already Done -- log normal time instead';
  end if;
  v_on_behalf := v_task.assignee_id <> my_person_id();
  if v_on_behalf and my_access_level() <> 'full' then
    raise exception 'only the task assignee can log follow-up time (Full Access can log on their behalf)';
  end if;
  if p_reason not in ('late_feedback','validated_too_early','scope_change') then
    raise exception 'choose a follow-up reason';
  end if;
  if v_on_behalf and coalesce(trim(p_notes), '') = '' then
    raise exception 'add a note explaining why you are logging this on the assignee''s behalf';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'end time must be after start time';
  end if;
  if p_ended_at > now() or p_started_at > now() then
    raise exception 'Future time entry not allowed -- time entries can only cover time that has already passed';
  end if;
  v_conflict := find_time_entry_overlap(v_task.assignee_id, p_started_at, p_ended_at, '{}');
  if v_conflict is not null then
    raise exception 'Time overlap detected with % -- adjust the start or end time', time_entry_label(v_conflict);
  end if;

  insert into time_entries
    (task_id, person_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes, is_follow_up, follow_up_reason)
  values
    (p_task_id, v_task.assignee_id, p_started_at, p_ended_at,
     greatest(1, round(extract(epoch from (p_ended_at - p_started_at)) / 60.0)),
     'manual', 'pending_approval', my_person_id(), nullif(trim(p_notes), ''), true, p_reason)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function submit_follow_up_time_entry(uuid, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function submit_follow_up_time_entry(uuid, timestamptz, timestamptz, text, text) to authenticated;

-- KB updates for follow-up time (previous wording kept in History).
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries
 where title in ('Correcting Time Logs', 'Approval Rights & Permissions Matrix') and not is_archived;

update kb_entries set
  content = split_part(content, '### Done, validated tasks and closed projects', 1) || $md$### Done, validated tasks and closed projects
Corrections **work** on entries belonging to tasks that are Done or validated, and on projects that are closed — you're fixing a record that already exists.

Adding **new** time works differently:
- A **Done** task doesn't accept normal timer or manual logs, but it does accept **follow-up time** (next section).
- A **closed** project doesn't accept any new time at all.

### Follow-up time on a Done task
When more work is needed after a task was marked Done or validated — feedback came back, it was validated too early, or the scope changed — log it as **follow-up time** instead of stretching an old log or reopening the task.

1. Go to **Projects & Tasks** and find the Done task.
2. In the **Spent hrs** column, click the dashed **+** button next to the hours.
3. Enter the date, start and end time of the follow-up work.
4. Choose a **reason** (required): {gold:Late feedback}, {gold:Validated too early} or {gold:Scope change}.
5. Add a short note on what was done, then click **Submit for approval**.

What happens next:
- The entry goes to the **Approval Center** with a {gold:Follow-up} tag and its reason — same approvers as any manual project time.
- Once approved, it counts toward the task's actual hours, tagged as follow-up so rework hours can be reported separately.
- The task **stays Done** and keeps its validated date. Nothing is reopened.
- **Full Access** can log follow-up time on the assignee's behalf in exceptional cases (for example, the person is on leave). A note is required and the entry records who logged it.

Follow-up time isn't available on **closed** projects. For those, log the work under an open project or as **Non-Project Time**.

### Larger new work (revisions)
If the follow-up is really a **new piece of work** — for example, a new version of the deliverable for a different purpose — ask the project owner to add a **revision task** in WBS Planning (for example, "Revise: Feedback application – temporary shutdown") and log your time there. This keeps the original task's numbers clean and makes the revision visible as its own task.
$md$,
  updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
where title = 'Correcting Time Logs' and not is_archived
  and content like '%### Done, validated tasks and closed projects%';

update kb_entries set
  content = replace(
              replace(content,
                '| **Non-project time entry** |',
                '| **Follow-up time** (on a Done task) | Of the project owner, when the owner logged it | {success:Yes} when someone else logged it | {success:Yes} | {neutral:—} |' || chr(10) || '| **Non-project time entry** |'),
              '| Plot time off (Off / Half day) |',
              '| Log **follow-up time** on a Done task | {success:Yes} (assignee) | {neutral:—} | {neutral:—} | {success:Yes} on the assignee''s behalf (note required) |' || chr(10) || '| Plot time off (Off / Half day) |'),
  updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
where title = 'Approval Rights & Permissions Matrix' and not is_archived
  and content not like '%Follow-up time%';
