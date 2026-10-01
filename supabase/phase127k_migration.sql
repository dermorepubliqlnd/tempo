-- phase127k (Sandra 2026-10-01): "if a project has been added and Save is
-- not clicked, do not auto-create a project -- this created unnecessary
-- Untitled projects. Add a prompt: discard, continue, or save first."
--
-- New projects are still inserted up front (the WBS page needs a real row),
-- but flagged is_unsaved until the user Saves (or keeps it from the leave
-- prompt). Unsaved projects are hidden from the Projects list, can be
-- discarded outright by their owner, and are auto-purged after 24h if
-- abandoned (tab closed / back button).

alter table projects add column if not exists is_unsaved boolean not null default false;

create or replace function discard_unsaved_project(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := my_person_id();
  v_full boolean := my_access_level() = 'full';
  v_owner uuid;
  v_unsaved boolean;
  v_wbs text;
  v_ids uuid[];
begin
  select owner_id, is_unsaved, wbs_status into v_owner, v_unsaved, v_wbs from projects where id = p_id;
  if not found then
    return; -- already gone
  end if;
  if not coalesce(v_unsaved, false) then
    raise exception 'this project has been saved -- archive it instead';
  end if;
  if coalesce(v_wbs, 'draft') <> 'draft' then
    raise exception 'only a draft project can be discarded';
  end if;
  if not (v_full or v_owner = v_me) then
    raise exception 'only the project owner or Full Access can discard this project';
  end if;
  select array_agg(id) into v_ids from tasks where project_id = p_id;
  if v_ids is not null then
    if exists (select 1 from time_entries where task_id = any(v_ids)) then
      raise exception 'time has already been logged on this project -- save it instead';
    end if;
    delete from extension_requests where task_id = any(v_ids);
    delete from task_effort_changes where task_id = any(v_ids);
    delete from task_collaborators where task_id = any(v_ids);
    delete from task_planning_snapshots where task_id = any(v_ids);
    delete from task_dependencies where task_id = any(v_ids) or depends_on_task_id = any(v_ids);
    delete from tasks where id = any(v_ids);
  end if;
  delete from extension_requests where project_id = p_id;
  delete from projects where id = p_id;
end;
$$;
revoke execute on function discard_unsaved_project(uuid) from public, anon;
grant execute on function discard_unsaved_project(uuid) to authenticated;

-- Abandoned unsaved projects (closed tab etc.): purge after 24h, never if
-- any time was logged against them.
create or replace function purge_abandoned_unsaved_projects() returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_ids uuid[];
begin
  for r in
    select p.id from projects p
    where p.is_unsaved and p.wbs_status = 'draft' and p.created_at < now() - interval '24 hours'
      and not exists (select 1 from time_entries te join tasks t on t.id = te.task_id where t.project_id = p.id)
  loop
    select array_agg(id) into v_ids from tasks where project_id = r.id;
    if v_ids is not null then
      delete from extension_requests where task_id = any(v_ids);
      delete from task_effort_changes where task_id = any(v_ids);
      delete from task_collaborators where task_id = any(v_ids);
      delete from task_planning_snapshots where task_id = any(v_ids);
      delete from task_dependencies where task_id = any(v_ids) or depends_on_task_id = any(v_ids);
      delete from tasks where id = any(v_ids);
    end if;
    delete from extension_requests where project_id = r.id;
    delete from projects where id = r.id;
  end loop;
end;
$$;
revoke execute on function purge_abandoned_unsaved_projects() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-abandoned-unsaved-projects');
exception when others then null;
end $$;
select cron.schedule('purge-abandoned-unsaved-projects', '45 18 * * *', 'select purge_abandoned_unsaved_projects()');  -- 02:45 Asia/Manila
