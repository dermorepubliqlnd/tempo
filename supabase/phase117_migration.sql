-- Phase 117 (2026-09-24): who can delete (archive) projects and tasks.
-- Sandra: tasks -> task owner (assignee), project owner, or anyone above
-- either of them in the reporting line; projects -> project owner or anyone
-- above them. Full Access keeps admin override. Anyone else gets a clear
-- message naming who to reach out to.

create or replace function archive_block_reason(p_kind text, p_id uuid) returns text
language plpgsql stable security definer as $$
declare
  v_me uuid := my_person_id();
  v_full boolean := my_access_level() = 'full';
  v_name text;
  v_owner uuid;
  v_owner_name text;
  v_assignee uuid;
  v_assignee_name text;
begin
  if p_kind = 'project' then
    select pr.name, pr.owner_id, o.name into v_name, v_owner, v_owner_name
      from projects pr left join people o on o.id = pr.owner_id where pr.id = p_id;
    if v_name is null then
      return 'project not found';
    end if;
    if v_full or v_owner = v_me or is_approver_for(v_owner) then
      return null;
    end if;
    return 'You can''t delete the project "' || v_name || '". Only the project owner'
      || coalesce(' (' || v_owner_name || ')', '')
      || ', their Immediate Supervisor or anyone above them, or a Full Access admin can. Please reach out to '
      || coalesce(v_owner_name || ' or their supervisor', 'a Full Access admin') || '.';
  elsif p_kind = 'task' then
    select t.name, t.assignee_id, a.name, pr.owner_id, o.name
      into v_name, v_assignee, v_assignee_name, v_owner, v_owner_name
      from tasks t
      left join people a on a.id = t.assignee_id
      left join projects pr on pr.id = t.project_id
      left join people o on o.id = pr.owner_id
     where t.id = p_id;
    if v_name is null then
      return 'task not found';
    end if;
    if v_full or v_owner = v_me or v_assignee = v_me
       or is_approver_for(v_owner) or is_approver_for(v_assignee) then
      return null;
    end if;
    return 'You can''t delete the task "' || v_name || '". Only the task owner'
      || coalesce(' (' || v_assignee_name || ')', '')
      || ', the project owner' || coalesce(' (' || v_owner_name || ')', '')
      || ', their Immediate Supervisor or anyone above them, or a Full Access admin can. Please reach out to '
      || coalesce(v_owner_name, v_assignee_name, 'a Full Access admin')
      || case when v_owner_name is not null and v_assignee_name is not null and v_assignee_name <> v_owner_name
              then ' (project owner) or ' || v_assignee_name || ' (task owner)' else '' end
      || '.';
  end if;
  return null;
end;
$$;
revoke all on function archive_block_reason(text, uuid) from public, anon;
grant execute on function archive_block_reason(text, uuid) to authenticated;

create or replace function archive_item(p_kind text, p_id uuid, p_reason text default null) returns uuid
language plpgsql security definer as $$
declare
  v_table text := archive_kind_table(p_kind);
  v_batch uuid := gen_random_uuid();
  v_me uuid := my_person_id();
  v_full boolean := my_access_level() = 'full';
  v_found boolean;
  v_archived boolean;
  v_te time_entries%rowtype;
  v_owner uuid;
  v_wbs text;
  v_task_ids uuid[];
  v_block text;
begin
  if v_table is null then
    raise exception 'unknown archive type: %', p_kind;
  end if;
  execute format('select true, is_archived from %I where id = $1', v_table) into v_found, v_archived using p_id;
  if v_found is null then
    raise exception 'item not found';
  end if;
  if v_archived then
    raise exception 'this item is already in the Archive';
  end if;

  -- Authorization mirrors who could delete it before.
  -- phase117: projects/tasks follow ownership + the reporting line.
  if p_kind in ('project','task') then
    v_block := archive_block_reason(p_kind, p_id);
    if v_block is not null then
      raise exception '%', v_block;
    end if;
    if p_kind = 'task' then
      select pr.wbs_status into v_wbs from tasks t left join projects pr on pr.id = t.project_id where t.id = p_id;
      if v_wbs = 'closed' then
        raise exception 'this project is closed -- its tasks are final and can no longer be archived';
      end if;
    end if;
  elsif p_kind = 'time_entry' then
    select * into v_te from time_entries where id = p_id;
    if v_te.status in ('pending_approval','rejected') and v_te.source = 'manual' then
      if not (v_full or v_te.person_id = v_me or v_te.requested_by = v_me) then
        raise exception 'not authorized to archive this time entry';
      end if;
    elsif v_te.status in ('confirmed','approved') then
      if not v_full then
        raise exception 'only Full Access can archive a confirmed or approved time entry';
      end if;
    else
      raise exception 'a running or unconfirmed timer entry can''t be archived -- stop and confirm it first';
    end if;
  else
    if not v_full then
      raise exception 'only Full Access can archive this item';
    end if;
  end if;

  perform archive_set_bypass_flags();
  perform set_config('app.bypass_time_entry_daily_cap', 'on', true);

  -- Root item
  execute format(
    'update %I set is_archived = true, archived_at = now(), archived_by = $1, archive_reason = $2, archive_batch_id = $3, archive_is_root = true %s where id = $4',
    v_table,
    case when p_kind in ('project_type','project_category','project_source','project_phase','project_planning_type','work_type','output_type','activity_type','time_entry_reason','cancellation_reason','decline_reason')
         then ', is_active = false' else '' end
  ) using v_me, nullif(trim(p_reason), ''), v_batch, p_id;

  -- Bundled children (only ones not already archived on their own)
  if p_kind = 'project' then
    select array_agg(id) into v_task_ids from tasks where project_id = p_id and not is_archived;
  elsif p_kind = 'task' then
    with recursive d as (
      select id from tasks where parent_task_id = p_id
      union all
      select t.id from tasks t join d on t.parent_task_id = d.id
    )
    select array_agg(d.id) into v_task_ids from d join tasks t on t.id = d.id where not t.is_archived;
  end if;

  if p_kind in ('project','task') then
    if exists (select 1 from time_entries where status = 'running'
                and task_id = any(coalesce(v_task_ids, '{}') || case when p_kind = 'task' then array[p_id] else '{}'::uuid[] end)) then
      raise exception 'someone has a timer running on this % -- stop it first', case when p_kind = 'task' then 'task' else 'project' end;
    end if;
    if v_task_ids is not null then
      update tasks set is_archived = true, archived_at = now(), archived_by = v_me, archive_batch_id = v_batch, archive_is_root = false
       where id = any(v_task_ids);
    end if;
    update time_entries set is_archived = true, archived_at = now(), archived_by = v_me, archive_batch_id = v_batch, archive_is_root = false
     where not is_archived and status <> 'running'
       and task_id = any(coalesce(v_task_ids, '{}') || case when p_kind = 'task' then array[p_id] else '{}'::uuid[] end);
  elsif p_kind = 'kb_category' then
    update kb_entries set is_archived = true, archived_at = now(), archived_by = v_me, archive_batch_id = v_batch, archive_is_root = false
     where category_id = p_id and not is_archived;
  end if;

  return v_batch;
end;
$$;

revoke all on function archive_item(text, uuid, text) from public, anon;
grant execute on function archive_item(text, uuid, text) to authenticated;
