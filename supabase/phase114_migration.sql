-- Phase 114 (2026-09-24): Project completion & closing guardrails (Sandra).
--   1. A project can be set to Completed only when every task is Done or
--      Cancelled (parent tasks excluded -- their status is computed).
--      Enforced here so Board drags / bulk edits can't bypass it.
--   2. projects.completed_at -- stamped when status becomes Completed,
--      cleared when it leaves Completed. Powers "ready to close" reminders.
--   3. Reopening a task on a Completed project moves the project back to
--      In Progress (phase -> the latest In Progress phase). Reopening on a
--      closed WBS stays blocked, with a clear message.
--   4. A closure request needs every Done task validated first (a closed
--      project's tasks can never be validated afterwards).

alter table projects add column if not exists completed_at timestamptz;

-- Backfill existing Completed projects: latest task completion signal.
update projects p set completed_at = coalesce(
  (select max(greatest(t.actual_completion_date::timestamptz, t.submitted_on, t.validated_completion_date))
     from tasks t where t.project_id = p.id and not t.is_archived),
  now())
 where p.status = 'Completed' and p.completed_at is null;

create or replace function enforce_project_complete_guard() returns trigger
language plpgsql as $$
declare
  v_open int;
  v_list text;
begin
  if NEW.status = 'Completed' and OLD.status is distinct from 'Completed' then
    if coalesce(current_setting('app.bypass_complete_guard', true), '') <> 'on' then
      select count(*),
             string_agg(coalesce('T-' || lpad(t.task_number::text, 4, '0') || ' ', '') || t.name || ' (' || coalesce(t.status, 'no status') || ')', ', ' order by t.sort_order)
               filter (where rn <= 5)
        into v_open, v_list
        from (
          select t.*, row_number() over (order by t.sort_order) rn
            from tasks t
           where t.project_id = NEW.id and not t.is_archived
             and coalesce(t.status, '') not in ('Done', 'Cancelled')
             and not exists (select 1 from tasks c where c.parent_task_id = t.id and not c.is_archived)
        ) t;
      if v_open > 0 then
        raise exception 'Can''t mark this project Completed yet -- % task(s) are still open: %. Finish them, or cancel the ones no longer needed.',
          v_open, v_list || case when v_open > 5 then ' and ' || (v_open - 5) || ' more' else '' end;
      end if;
    end if;
    NEW.completed_at := now();
  elsif OLD.status = 'Completed' and NEW.status is distinct from 'Completed' then
    NEW.completed_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists projects_complete_guard on projects;
create trigger projects_complete_guard
  before update of status on projects
  for each row execute function enforce_project_complete_guard();

create or replace function reopen_task(p_task_id uuid) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
  v_project_id uuid;
  v_wbs text;
  v_proj_status text;
  v_phase text;
begin
  select t.assignee_id, t.project_id, pr.wbs_status, pr.status
    into v_assignee_id, v_project_id, v_wbs, v_proj_status
    from tasks t join projects pr on pr.id = t.project_id where t.id = p_task_id;
  if v_project_id is null then
    raise exception 'task not found';
  end if;
  if v_wbs = 'closed' then
    raise exception 'this project is closed -- its tasks are final and can''t be reopened. Reopen the project through WBS first, or log the work as Non-Project Time';
  end if;
  if not (my_access_level() = 'full'
          or (v_assignee_id is not null and v_assignee_id <> my_person_id() and is_approver_for(v_assignee_id))) then
    raise exception 'not authorized to reopen this task';
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  perform set_config('app.bypass_status_baseline_lock', 'on', true);
  update tasks set
    validated_completion_date = null,
    validated_by = null,
    validation_performed_at = null,
    status = 'In Progress',
    submitted_on = null,
    submitted_by = null,
    actual_completion_date = null
  where id = p_task_id;

  -- The project has open work again: Completed -> In Progress.
  if v_proj_status = 'Completed' then
    select ph.name into v_phase
      from project_status_phase_mapping m join project_phases ph on ph.id = m.phase_id
     where m.status = 'In Progress' and ph.is_active and not ph.is_archived
     order by ph.sort_order desc limit 1;
    update projects set status = 'In Progress', phase = coalesce(v_phase, phase) where id = v_project_id;
  end if;
end;
$$;

create or replace function request_wbs_closure(p_project_id uuid) returns uuid
language plpgsql security definer as $$
declare
  v_status text;
  v_request_id uuid;
  v_unvalidated int;
  v_list text;
begin
  if not can_manage_wbs(p_project_id) then
    raise exception 'not authorized to request closure for this project';
  end if;

  select wbs_status into v_status from projects where id = p_project_id;
  if v_status is null then
    raise exception 'project not found';
  end if;
  if v_status = 'closed' then
    raise exception 'project is already closed';
  end if;
  if v_status = 'draft' then
    raise exception 'lock a baseline before requesting closure';
  end if;
  if v_status = 'revision_in_progress' then
    raise exception 'apply or discard the in-progress revision before requesting closure';
  end if;
  if exists (select 1 from project_closure_requests where project_id = p_project_id and status = 'pending') then
    raise exception 'a closure request is already pending for this project';
  end if;

  -- Every Done task must be validated first -- after closure it never can be.
  select count(*), string_agg(coalesce('T-' || lpad(t.task_number::text, 4, '0') || ' ', '') || t.name, ', ' order by t.sort_order) filter (where rn <= 5)
    into v_unvalidated, v_list
    from (
      select t.*, row_number() over (order by t.sort_order) rn
        from tasks t
       where t.project_id = p_project_id and not t.is_archived
         and t.status = 'Done' and t.validated_completion_date is null
         and not exists (select 1 from tasks c where c.parent_task_id = t.id and not c.is_archived)
    ) t;
  if v_unvalidated > 0 then
    raise exception '% task(s) are Done but not validated yet: %. Ask the assignee''s Immediate Supervisor to validate them in the Approval Center before requesting closure.',
      v_unvalidated, v_list || case when v_unvalidated > 5 then ' and ' || (v_unvalidated - 5) || ' more' else '' end;
  end if;

  insert into project_closure_requests (project_id, requested_by, status)
  values (p_project_id, my_person_id(), 'pending')
  returning id into v_request_id;

  return v_request_id;
end;
$$;

-- KB: Completing & Closing a Project (Projects topic).
insert into kb_entries (category_id, title, content, sort_order, created_by, updated_by)
select c.id, 'Completing & Closing a Project', $md$## Completing & Closing a Project

A project is **Completed** when all its work is finished, and **closed** when its WBS has been reviewed and its final numbers locked. Completed comes first; closing is the final sign-off. Click a section below to expand it.

| | Project status **Completed** | WBS status **Closed** |
|---|---|---|
| What it means | All work is finished | Final numbers reviewed and locked |
| Who sets it | Project owner (manual) | Closure request, approved by Full Access or the Project Close right |
| Tasks can be reopened | {success:Yes} — the project moves back to In Progress | {danger:No} — reopen the project through WBS first |
| Follow-up time allowed | {success:Yes} | {danger:No} |
| Existing logs can be corrected | {success:Yes} | {success:Yes} |

### Marking a project Completed
Project status is still set by hand, but Tempo checks the work first:

- A project can be set to **Completed** only when every task is **Done** or **Cancelled**.
- If any task is still open, you'll see the list of open tasks (Task ID, name, status). **Finish** them, or **cancel** the ones that are no longer needed (with a reason) — then set the project to Completed.
- This matches **Actual Progress**: cancelled tasks don't count, so 100% means every remaining task is Done.
- If the whole project was stopped rather than finished, use **Cancelled** or **Paused**, not Completed.

### Reopening a task on a Completed project
If a task needs more work after the project was marked Completed, its Immediate Supervisor (or anyone above) can reopen it. Before it happens you'll see a warning, and then:

- the task goes back to **In Progress**, so Actual Progress drops below 100%;
- the project **automatically moves back to In Progress** (the phase moves to the latest In Progress phase);
- the project can only be set to Completed again once that task is Done or Cancelled.

For small extra work on a Done task, use **follow-up time** instead of reopening (see **Time Tracking → Correcting Time Logs**).

### Closing the project (WBS)
When a project is Completed, the owner reviews the WBS and requests closure from the WBS page.

- **Every Done task must be validated first.** A closed project's tasks can never be validated afterwards, so the closure request is blocked until they are. Validations happen in the **Approval Center** (assignee's Immediate Supervisor).
- Once closed, the project is final: no reopening tasks, no new time, no follow-up logs. Correcting an existing log's time is still possible.
- Work that comes up after closing: log it as **Non-Project Time**, create a task in an open project, or — if the closure was premature — reopen the project through WBS.

### Reminders
- **My Dashboard → Needs My Attention** (project owner): **Projects ready to close** lists Completed projects with how long ago they were completed and how many tasks still await validation, with a link to the WBS. **Completed projects have open tasks** flags any Completed project that has open work.
- **Projects & Tasks**: the WBS Status column shows a {gold:Ready to close} tag on Completed projects that aren't closed yet.
- **Team Dashboard → Needs Attention**: lists projects Completed **14+ days** ago that still aren't closed, so supervisors can follow up.
$md$, 2,
(select id from people where email = 'sbarlao@dermorepubliq.com' limit 1),
(select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
from kb_categories c
where c.name = 'Projects'
  and not exists (select 1 from kb_entries e where e.category_id = c.id and e.title = 'Completing & Closing a Project');
