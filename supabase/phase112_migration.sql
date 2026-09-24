-- Phase 112 (2026-09-24): Approvals follow the reporting line only.
-- Sandra: "remove all approval permissions for project owners. All
-- approvals route to the immediate supervisor, following hierarchy --
-- skip level if the supervisor is out, someone above in the chain can
-- approve."
--
-- One rule for every request that used to involve the project owner
-- (task + project timeline extensions, time entries incl. follow-up time,
-- time corrections, task validation/lock/reopen):
--   approver = Full Access, OR anyone ACTIVE above the subject person in
--   the Reports-to chain (Immediate Supervisor, their supervisor, ...).
--   The subject is the person the request is about: the requester for
--   extensions/corrections, the person whose time it is for time entries,
--   the assignee for task validation.
--   Nobody approves their own request, except someone with no active
--   supervisor above them at all (existing top-of-chain exemption).
-- Baseline and Project Close stay on their User Management approval rights.

create or replace function is_approver_for(p_person_id uuid) returns boolean
language plpgsql stable security definer as $$
declare
  v_me uuid := my_person_id();
  v_cur uuid;
  v_depth int := 0;
begin
  if v_me is null or p_person_id is null then
    return false;
  end if;
  if p_person_id = v_me then
    return nearest_active_manager(v_me) is null;   -- top of chain only
  end if;
  select reports_to into v_cur from people where id = p_person_id;
  while v_cur is not null and v_depth < 20 loop
    if v_cur = v_me then
      return true;    -- my_person_id() only resolves for active people
    end if;
    select reports_to into v_cur from people where id = v_cur;
    v_depth := v_depth + 1;
  end loop;
  return false;
end;
$$;
grant execute on function is_approver_for(uuid) to authenticated;

-- Extensions (task + project timeline): requester's chain.
create or replace function can_decide_extension(p_request_id uuid) returns boolean
language sql stable security definer as $$
  select coalesce(
    my_access_level() = 'full'
    or exists (select 1 from extension_requests er where er.id = p_request_id and is_approver_for(er.requested_by)),
    false)
$$;

-- Time entries (manual, non-project, follow-up): the person whose time it is.
create or replace function can_decide_time_entry(p_entry_id uuid) returns boolean
language sql stable security definer as $$
  select coalesce(
    my_access_level() = 'full'
    or exists (select 1 from time_entries te where te.id = p_entry_id and is_approver_for(te.person_id)),
    false)
$$;

-- Time correction requests: the requester's chain (never their own).
create or replace function can_decide_time_entry_correction(p_request_id uuid) returns boolean
language plpgsql stable security definer as $$
declare
  v_requester uuid;
begin
  select requested_by into v_requester from time_entry_correction_requests where id = p_request_id;
  if v_requester is null then
    return false;
  end if;
  if v_requester = my_person_id() then
    return nearest_active_manager(v_requester) is null;
  end if;
  return my_access_level() = 'full' or is_approver_for(v_requester);
end;
$$;

-- Task validation: assignee's chain (project-owner branch removed).
create or replace function validate_task_completion(p_task_id uuid, p_validated_date timestamptz default null) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
  v_project_id uuid;
  v_status text;
  v_authorized boolean;
  v_actual_completion date;
  v_submitted_on timestamptz;
  v_completion_ref date;
  v_new_date date;
begin
  select assignee_id, project_id, status, actual_completion_date, submitted_on
    into v_assignee_id, v_project_id, v_status, v_actual_completion, v_submitted_on
    from tasks where id = p_task_id;
  if v_project_id is null then
    raise exception 'task not found';
  end if;
  if v_status <> 'Done' then
    raise exception 'only a Done task can be validated';
  end if;

  if v_assignee_id is not null and v_assignee_id = my_person_id() then
    if nearest_active_manager(v_assignee_id) is not null then
      raise exception 'you can''t validate your own work -- ask your Immediate Supervisor to validate this task';
    end if;
    v_authorized := true;
  else
    v_authorized := my_access_level() = 'full' or (v_assignee_id is not null and is_approver_for(v_assignee_id));
  end if;

  if not coalesce(v_authorized, false) then
    raise exception 'not authorized to validate this task -- only the assignee''s Immediate Supervisor (or someone above them) can';
  end if;

  v_new_date := coalesce(p_validated_date::date, v_actual_completion, v_submitted_on::date, now()::date);
  v_completion_ref := coalesce(v_actual_completion, v_submitted_on::date);
  if v_completion_ref is not null and v_new_date < v_completion_ref then
    raise exception 'validation date (%) can''t be earlier than the actual completion date (%)', v_new_date, v_completion_ref;
  end if;

  perform set_config('app.bypass_validation_rpc', 'on', true);
  update tasks set
    validated_completion_date = v_new_date::timestamptz,
    validated_by = my_person_id(),
    validation_performed_at = now()
  where id = p_task_id;
end;
$$;

create or replace function lock_task_validation(p_task_id uuid) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
  v_validated_date date;
begin
  select assignee_id, validated_completion_date into v_assignee_id, v_validated_date from tasks where id = p_task_id;
  if not found then
    raise exception 'task not found';
  end if;
  if v_validated_date is null then
    raise exception 'this task has not been validated yet';
  end if;
  if not (my_access_level() = 'full' or (v_assignee_id is not null and is_approver_for(v_assignee_id))) then
    raise exception 'not authorized to lock this task''s validation';
  end if;
  update tasks set validated_locked_at = now(), validated_locked_by = my_person_id() where id = p_task_id;
end;
$$;

create or replace function reopen_task(p_task_id uuid) returns void
language plpgsql security definer as $$
declare
  v_assignee_id uuid;
begin
  select assignee_id into v_assignee_id from tasks where id = p_task_id;
  if not found then
    raise exception 'task not found';
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
end;
$$;

-- KB: permissions matrix rewritten for reporting-line approvals (old
-- version kept in History).
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Approval Rights & Permissions Matrix' and not is_archived;

update kb_entries set content = $md$## Approval Rights & Permissions Matrix

Every approval in Tempo follows the reporting line: requests go to the **Immediate Supervisor**, and anyone above them in the chain can approve if the supervisor is out. Project owners no longer approve requests.

- **Immediate Supervisor** — the person someone reports to (their **Reports to** in User Management).
- **Skip level** — anyone above the Immediate Supervisor in the same chain (the supervisor's supervisor, and so on) can also approve. Inactive people are skipped automatically.
- **Full Access** — can approve any request.
- **Approval Rights** — the **Re-baseline** and **Project Close** checkboxes in User Management, for those two request types only.

### Ground rules
- Nobody approves their own request. The only exception is someone with no active supervisor above them at all.
- **Approval Center** appears in the menu only for people with approval authority: Full Access, either Approval Right, or at least one active person reporting to them.
- Inside Approval Center, everyone sees only the requests they can decide. **Other pending approvals** (requests someone else must decide) is visible to Full Access only.
- To change who approves for someone, update their **Reports to** in User Management.

### Approvals — who decides each request

| Request | Whose reporting line | Immediate Supervisor (or anyone above) | Full Access | Approval Right needed |
|---|---|---|---|---|
| **Task due-date extension** | The person who requested it | {success:Yes} | {success:Yes} | {neutral:—} |
| **Project timeline extension** | The person who requested it | {success:Yes} | {success:Yes} | {neutral:—} |
| **Project time entry** (manual log) | The person whose time it is | {success:Yes} | {success:Yes} | {neutral:—} |
| **Follow-up time** (on a Done task) | The person whose time it is | {success:Yes} | {success:Yes} | {neutral:—} |
| **Non-project time entry** | The person whose time it is | {success:Yes} | {success:Yes} | {neutral:—} |
| **Time correction request** | The person requesting | {success:Yes} | {success:Yes} | {neutral:—} |
| **Task completion validation** | The task's assignee | {success:Yes} | {success:Yes} | {neutral:—} |
| **Reopen a validated task** | The task's assignee | {success:Yes} | {success:Yes} | {neutral:—} |
| **Baseline approval** (Start Project / Re-baseline) | {neutral:n/a} | {neutral:—} | {danger:No} unless they also hold the right | {accent:Re-baseline} |
| **Project close** | {neutral:n/a} | {neutral:—} | {success:Yes} | {accent:Project Close} (or Full Access) |

### Actions — who can do what

| Action | Everyone (own items) | Immediate Supervisor (or anyone above) | Project Owner | Full Access |
|---|---|---|---|---|
| Log time (timer or manual) | {success:Yes} | {neutral:—} | {neutral:—} | {success:Yes} |
| Edit or delete a **pending/rejected** manual time entry | {success:Yes} (logger or requester) | {neutral:—} | {neutral:—} | {success:Yes} |
| Request a correction on a **confirmed/approved** entry | {success:Yes} | {neutral:—} | {neutral:—} | Corrects directly instead |
| Correct a confirmed/approved entry directly | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |
| Log **follow-up time** on a Done task | {success:Yes} (assignee) | {neutral:—} | {neutral:—} | {success:Yes} on the assignee's behalf (note required) |
| Plot time off (Off / Half day) | {success:Yes} | {success:Yes} for direct reports | {neutral:—} | {success:Yes} for anyone |
| Holiday Calendar | View only | View only | View only | {success:Add / edit / delete} |
| Plan the project (WBS, tasks, dates) | {neutral:—} | {neutral:—} | {success:Yes} | {success:Yes} |
| Delete (archive) a project | {neutral:—} | {neutral:—} | {success:Yes} | {success:Yes} |
| Delete (archive) a task | {neutral:—} | {neutral:—} | {success:Yes} (not on closed projects) | {success:Yes} (not on closed projects) |
| Delete (archive) a time entry | Pending/rejected manual entries only | {neutral:—} | {neutral:—} | {success:Yes} incl. confirmed/approved |
| Delete (archive) Knowledge Base, Settings lists, holidays | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |
| View the Archive | {success:Yes} | {success:Yes} | {success:Yes} | {success:Yes} |
| Restore from the Archive | {success:Yes} if they archived it | {neutral:—} | {neutral:—} | {success:Yes} |
| Edit the Knowledge Base | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |
| User Management and Site Settings | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |

### Notes
- Project owners still **plan and manage** their projects (WBS, tasks, dates, archiving) — they just don't approve requests anymore unless they are also the requester's supervisor.
- Deleting anything in Tempo moves it to the **Archive**. It can be restored for 90 days, then it is removed automatically.
- The one exception is **Delete permanently** in User Management, for mistaken accounts with no history. Everyone else is deactivated instead.
$md$,
  updated_at = now(),
  updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
where title = 'Approval Rights & Permissions Matrix' and not is_archived;

-- Correcting Time Logs: approver list now follows the reporting line.
update kb_entries set content = replace(content,
  $old$**Who approves** — in **Approval Center** → **Time Corrections**:
- **Project owner** — for entries on their project, unless they are the one requesting.
- **Immediate Supervisor** — of the person requesting.
- **Full Access** — any request.$old$,
  $new$**Who approves** — in **Approval Center** → **Time Corrections**:
- **Immediate Supervisor** of the person requesting — or anyone above them in the chain if the supervisor is out.
- **Full Access** — any request.$new$),
  updated_at = now()
where title = 'Correcting Time Logs' and not is_archived;

update kb_entries set content = replace(content,
  'same approvers as any manual project time.', 'approved by your Immediate Supervisor (or anyone above them).'),
  updated_at = now()
where title = 'Correcting Time Logs' and not is_archived;
