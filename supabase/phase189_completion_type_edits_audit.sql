-- phase189 (2026-10-14, Sandra): Work Type / Output Type can be changed in
-- the Complete task pop-up, and every change is captured in the Audit Trail.
--
-- How it is logged: the same way record_due_date_change_audit (live) logs a
-- due-date move. On a baselined project the change goes into the project's
-- open revision (one is opened automatically if none is open, and the project
-- shows "changed after baseline", exactly like a due-date extension).
-- Draft projects have no Audit Trail yet, so nothing is logged there (same as
-- every other pre-baseline WBS edit).
--
-- Additive: one new change_type value ('type_changed'), one helper, one RPC.
-- Nothing existing changes behaviour. Safe to run before the app code ships.

-- 1. Allow change_type = 'type_changed' (keeps whatever values live already allows).
do $$
declare
  v_name text;
  v_def text;
begin
  select conname, pg_get_constraintdef(oid) into v_name, v_def
  from pg_constraint
  where conrelid = 'public.project_revision_changes'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%change_type%'
  limit 1;
  if v_name is null or v_def ilike '%type_changed%' then
    return;
  end if;
  execute format('alter table public.project_revision_changes drop constraint %I', v_name);
  execute format('alter table public.project_revision_changes add constraint %I %s', v_name,
                 replace(v_def, 'ARRAY[', 'ARRAY[''type_changed''::text, '));
end $$;

-- 2. Log one field change into the project's open revision (mirrors record_due_date_change_audit).
create or replace function public.record_task_field_change_audit(p_task_id uuid, p_field text, p_previous text, p_new text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
  v_task_name text;
  v_status text;
  v_open_revision_id uuid;
  v_source_version_id uuid;
  v_revision_number integer;
begin
  if p_previous is not distinct from p_new then return; end if;
  select project_id, name into v_project_id, v_task_name from tasks where id = p_task_id;
  if v_project_id is null then return; end if;
  select wbs_status into v_status from projects where id = v_project_id;
  if v_status is null or v_status not in ('baseline_locked', 'changed_after_baseline') then return; end if;
  select id into v_open_revision_id from project_revisions where project_id = v_project_id and status = 'in_progress';
  if v_open_revision_id is null then
    select id into v_source_version_id from project_plan_versions where project_id = v_project_id order by version_number desc limit 1;
    select coalesce(max(revision_number), 0) + 1 into v_revision_number from project_revisions where project_id = v_project_id;
    insert into project_revisions (project_id, revision_number, reason, status, source_plan_version_id, started_by)
    values (v_project_id, v_revision_number, 'Auto-opened on task completion edit', 'in_progress', v_source_version_id, my_person_id())
    returning id into v_open_revision_id;
    update projects set wbs_status = 'changed_after_baseline' where id = v_project_id;
  end if;
  insert into project_revision_changes (revision_id, task_id, task_name, change_type, field, previous_value, new_value, changed_by)
  values (v_open_revision_id, p_task_id, v_task_name, 'type_changed', p_field,
          to_jsonb(coalesce(p_previous, '—')), to_jsonb(coalesce(p_new, '—')), my_person_id());
end;
$$;

-- 3. Change Work Type / Output Type from the Complete task pop-up, with audit.
create or replace function public.set_task_types_at_completion(p_task_id uuid, p_work_type_id uuid, p_output_type_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_old_wt text; v_new_wt text; v_old_ot text; v_new_ot text;
begin
  select * into t from tasks where id = p_task_id;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.status in ('Done', 'Cancelled') then raise exception 'This task is already finished.'; end if;
  if not (t.assignee_id = my_person_id() or can_manage_wbs(t.project_id) or my_access_level() = 'full') then
    raise exception 'Only the assignee, the project owner or Full Access can change this task.';
  end if;
  if t.work_type_id is not distinct from p_work_type_id and t.output_type_id is not distinct from p_output_type_id then
    return;
  end if;

  select name into v_old_wt from work_types where id = t.work_type_id;
  select name into v_new_wt from work_types where id = p_work_type_id;
  select name into v_old_ot from output_types where id = t.output_type_id;
  select name into v_new_ot from output_types where id = p_output_type_id;

  update tasks set work_type_id = p_work_type_id, output_type_id = p_output_type_id where id = p_task_id;

  perform record_task_field_change_audit(p_task_id, 'work_type', 'Work Type: ' || coalesce(v_old_wt, '—'), 'Work Type: ' || coalesce(v_new_wt, '—'))
    where t.work_type_id is distinct from p_work_type_id;
  perform record_task_field_change_audit(p_task_id, 'output_type', 'Output Type: ' || coalesce(v_old_ot, '—'), 'Output Type: ' || coalesce(v_new_ot, '—'))
    where t.output_type_id is distinct from p_output_type_id;
end;
$$;
grant execute on function public.set_task_types_at_completion(uuid, uuid, uuid) to authenticated;
