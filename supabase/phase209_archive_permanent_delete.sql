-- phase209 (2026-10-22, Sandra): Full Access can permanently delete items in
-- the Archive (one or many at once) instead of waiting 90 days. Same clean-up
-- as the nightly purge, item by item. Only rows that are archived can be removed.
-- p_items: [{"kind":"task","id":"<uuid>"}, ...] -- kinds as in archive_items.
create or replace function public.purge_archive_items(p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  v_kind text;
  v_id uuid;
  v_batch uuid;
  v_ids uuid[];
  tid uuid;
  v_tbl text;
  v_name text;
  v_done int := 0;
  v_skipped text[] := '{}';
begin
  if coalesce(public.my_access_level(), '') <> 'full' then
    raise exception 'Only Full Access can permanently delete from the Archive.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one item to delete.';
  end if;
  perform set_config('app.bypass_closed_project_lock', 'on', true);

  for it in select * from jsonb_array_elements(p_items) loop
    v_kind := it->>'kind';
    v_id := (it->>'id')::uuid;

    if v_kind = 'project' then
      if not exists (select 1 from projects where id = v_id and is_archived) then continue; end if;
      perform archive_project_pm_overhead(v_id);
      select array_agg(id) into v_ids from tasks where project_id = v_id;
      if v_ids is not null then
        foreach tid in array v_ids loop perform archive_task_utilization(tid); end loop;
        delete from extension_requests where task_id = any(v_ids);
        delete from task_effort_changes where task_id = any(v_ids);
        delete from time_entries where task_id = any(v_ids);
        delete from task_collaborators where task_id = any(v_ids);
        delete from task_planning_snapshots where task_id = any(v_ids);
        delete from task_dependencies where task_id = any(v_ids) or depends_on_task_id = any(v_ids);
        update tasks set parent_task_id = null where (id = any(v_ids) or parent_task_id = any(v_ids)) and parent_task_id is not null;
        delete from tasks where id = any(v_ids);
      end if;
      delete from extension_requests where project_id = v_id;
      delete from projects where id = v_id;
      v_done := v_done + 1;

    elsif v_kind = 'task' then
      select archive_batch_id into v_batch from tasks where id = v_id and is_archived;
      if v_batch is null then continue; end if;
      select array_agg(id) into v_ids from tasks where archive_batch_id = v_batch and is_archived;
      foreach tid in array v_ids loop perform archive_task_utilization(tid); end loop;
      delete from extension_requests where task_id = any(v_ids);
      delete from task_effort_changes where task_id = any(v_ids);
      delete from time_entries where task_id = any(v_ids);
      delete from task_collaborators where task_id = any(v_ids);
      delete from task_planning_snapshots where task_id = any(v_ids);
      delete from task_dependencies where task_id = any(v_ids) or depends_on_task_id = any(v_ids);
      update tasks set parent_task_id = null where (id = any(v_ids) or parent_task_id = any(v_ids)) and parent_task_id is not null;
      delete from tasks where id = any(v_ids);
      v_done := v_done + 1;

    elsif v_kind = 'time_entry' then
      select archive_batch_id into v_batch from time_entries where id = v_id and is_archived;
      if v_batch is null then continue; end if;
      delete from time_entries where archive_batch_id = v_batch and is_archived;
      v_done := v_done + 1;

    elsif v_kind = 'kb_category' then
      select archive_batch_id into v_batch from kb_categories where id = v_id and is_archived;
      if v_batch is null then continue; end if;
      delete from kb_entries where archive_batch_id = v_batch and is_archived;
      delete from kb_categories where id = v_id;
      v_done := v_done + 1;

    elsif v_kind = 'kb_entry' then
      delete from kb_entries where id = v_id and is_archived;
      if found then v_done := v_done + 1; end if;

    elsif v_kind = 'holiday' then
      delete from holidays where id = v_id and is_archived;
      if found then v_done := v_done + 1; end if;

    elsif v_kind = 'time_off' then
      delete from archived_time_off where id = v_id;
      if found then v_done := v_done + 1; end if;

    else
      v_tbl := case v_kind
        when 'project_type' then 'project_types'
        when 'project_category' then 'project_categories'
        when 'project_source' then 'project_sources'
        when 'project_phase' then 'project_phases'
        when 'project_planning_type' then 'project_planning_types'
        when 'work_type' then 'work_types'
        when 'output_type' then 'output_types'
        when 'activity_type' then 'non_project_activity_types'
        when 'time_entry_reason' then 'time_entry_reasons'
        when 'cancellation_reason' then 'task_cancellation_reasons'
        when 'decline_reason' then 'baseline_decline_reasons'
      end;
      if v_tbl is null then continue; end if;
      execute format('select name from %I where id = $1 and is_archived', v_tbl) into v_name using v_id;
      if v_name is null then continue; end if;
      begin
        execute format('delete from %I where id = $1', v_tbl) using v_id;
        v_done := v_done + 1;
      exception when foreign_key_violation then
        v_skipped := v_skipped || v_name;  -- still used somewhere; stays archived
      end;
    end if;
  end loop;

  return jsonb_build_object('deleted', v_done, 'skipped', to_jsonb(v_skipped));
end;
$$;
revoke execute on function public.purge_archive_items(jsonb) from public, anon;
grant execute on function public.purge_archive_items(jsonb) to authenticated;
