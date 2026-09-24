-- Phase 117 (2026-09-24): who can delete (archive) projects and tasks,
-- plus deleted time off goes to the Archive instead of being lost.
-- Sandra: tasks -> task owner (assignee), project owner, or anyone above
-- either of them in the reporting line; projects -> project owner or anyone
-- above them. Full Access keeps admin override. Anyone else gets a clear
-- message naming who to reach out to.

create or replace function archive_block_reason(p_kind text, p_id uuid) returns text
language plpgsql stable security definer as $$
declare
  v_me uuid := my_person_id();
  v_full boolean := my_access_level() = 'full';
  v_owner uuid;
  v_assignee uuid;
begin
  if p_kind = 'project' then
    select owner_id into v_owner from projects where id = p_id;
    if not found then
      return 'project not found';
    end if;
    if v_full or v_owner = v_me or is_approver_for(v_owner) then
      return null;
    end if;
    return 'You can''t delete this project. Please reach out to the project owner or your supervisor.';
  elsif p_kind = 'task' then
    select t.assignee_id, pr.owner_id into v_assignee, v_owner
      from tasks t left join projects pr on pr.id = t.project_id where t.id = p_id;
    if not found then
      return 'task not found';
    end if;
    if v_full or v_owner = v_me or v_assignee = v_me
       or is_approver_for(v_owner) or is_approver_for(v_assignee) then
      return null;
    end if;
    return 'You can''t delete this task. Please reach out to the project owner or your supervisor.';
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

-- ---------------------------------------------------------------------------
-- Time off: deleting a day no longer loses it. A BEFORE DELETE trigger copies
-- the row into archived_time_off (shown on the Archive page, restorable by
-- whoever deleted it or Full Access, purged after 90 days). person_availability
-- itself stays exactly as it was, so capacity/utilization math is untouched.
create table if not exists archived_time_off (
  id uuid primary key,
  person_id uuid not null references people(id),
  date date not null,
  status text not null,
  created_at timestamptz,
  is_archived boolean not null default true,
  archived_at timestamptz not null default now(),
  archived_by uuid references people(id),
  archive_reason text,
  archive_batch_id uuid not null default gen_random_uuid(),
  archive_is_root boolean not null default true
);
alter table archived_time_off enable row level security;
drop policy if exists archived_time_off_select on archived_time_off;
create policy archived_time_off_select on archived_time_off for select using (true);

create or replace function archive_deleted_time_off() returns trigger
language plpgsql security definer as $$
begin
  if coalesce(current_setting('app.bypass_time_off_archive', true), '') = 'on' then
    return OLD;
  end if;
  insert into archived_time_off (id, person_id, date, status, created_at, archived_by)
  values (OLD.id, OLD.person_id, OLD.date, OLD.status, OLD.created_at, my_person_id())
  on conflict (id) do update set status = excluded.status, archived_at = now(), archived_by = excluded.archived_by;
  return OLD;
end;
$$;
drop trigger if exists person_availability_archive_on_delete on person_availability;
create trigger person_availability_archive_on_delete
  before delete on person_availability
  for each row execute function archive_deleted_time_off();

create or replace function restore_time_off(p_id uuid) returns void
language plpgsql security definer as $$
declare
  r archived_time_off%rowtype;
begin
  select * into r from archived_time_off where id = p_id;
  if not found then
    raise exception 'item not found -- it may already have been purged';
  end if;
  if not (my_access_level() = 'full' or r.archived_by = my_person_id()) then
    raise exception 'only the person who archived this item, or Full Access, can restore it';
  end if;
  if exists (select 1 from person_availability where person_id = r.person_id and date = r.date) then
    raise exception 'can''t restore: that day already has a time-off entry for this person';
  end if;
  insert into person_availability (id, person_id, date, status, created_at)
  values (r.id, r.person_id, r.date, r.status, coalesce(r.created_at, now()));
  delete from archived_time_off where id = p_id;
end;
$$;
revoke all on function restore_time_off(uuid) from public, anon, authenticated;
revoke all on function archive_deleted_time_off() from public, anon, authenticated;

create or replace function purge_expired_time_off() returns void
language sql security definer as $$
  delete from archived_time_off where archived_at < now() - interval '90 days';
$$;
revoke all on function purge_expired_time_off() from public, anon, authenticated;
do $$
begin
  perform cron.unschedule('purge-expired-time-off');
exception when others then null;
end $$;
select cron.schedule('purge-expired-time-off', '35 18 * * *', 'select purge_expired_time_off()');

create or replace function archive_kind_table(p_kind text) returns text
language sql immutable as $$
  select case p_kind
    when 'project' then 'projects'
    when 'task' then 'tasks'
    when 'time_entry' then 'time_entries'
    when 'kb_category' then 'kb_categories'
    when 'kb_entry' then 'kb_entries'
    when 'holiday' then 'holidays'
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
    when 'time_off' then 'archived_time_off'
  end
$$;


create or replace function restore_item(p_kind text, p_id uuid) returns void
language plpgsql security definer as $$
declare
  v_table text := archive_kind_table(p_kind);
  v_batch uuid;
  v_root boolean;
  v_by uuid;
  v_archived boolean;
  v_conflict uuid;
  r record;
begin
  if v_table is null then
    raise exception 'unknown archive type: %', p_kind;
  end if;
  -- phase117: deleted time off lives in its own table; restoring puts the
  -- row back into person_availability.
  if p_kind = 'time_off' then
    perform restore_time_off(p_id);
    return;
  end if;
  execute format('select is_archived, archive_batch_id, archive_is_root, archived_by from %I where id = $1', v_table)
    into v_archived, v_batch, v_root, v_by using p_id;
  if v_archived is null then
    raise exception 'item not found -- it may already have been purged';
  end if;
  if not v_archived then
    raise exception 'this item is not in the Archive';
  end if;
  if not v_root then
    raise exception 'this item was archived as part of a bundle -- restore the item it was archived with';
  end if;
  if not (my_access_level() = 'full' or v_by = my_person_id()) then
    raise exception 'only the person who archived this item, or Full Access, can restore it';
  end if;

  -- Parent must be live
  if p_kind = 'task' then
    if exists (select 1 from tasks t join projects p on p.id = t.project_id where t.id = p_id and p.is_archived) then
      raise exception 'this task''s project is archived -- restore the project first';
    end if;
    if exists (select 1 from tasks t join tasks pt on pt.id = t.parent_task_id where t.id = p_id and pt.is_archived) then
      raise exception 'this task''s parent task is archived -- restore the parent first';
    end if;
  elsif p_kind = 'time_entry' then
    if exists (select 1 from time_entries te join tasks t on t.id = te.task_id where te.id = p_id and t.is_archived) then
      raise exception 'this entry''s task is archived -- restore the task first';
    end if;
  elsif p_kind = 'kb_entry' then
    if exists (select 1 from kb_entries e join kb_categories c on c.id = e.category_id where e.id = p_id and c.is_archived) then
      raise exception 'this entry''s category is archived -- restore the category first';
    end if;
  end if;

  -- Time entries coming back must not overlap anything logged AFTER they
  -- were archived (overlaps that already existed before archiving are
  -- historical and don't block putting things back exactly as they were).
  for r in
    select te.id, te.person_id, te.started_at, te.ended_at, te.archived_at
      from time_entries te
     where te.archive_batch_id = v_batch and te.is_archived and te.ended_at is not null
       and te.status in ('pending_confirm','pending_approval','confirmed','approved')
  loop
    select o.id into v_conflict
      from time_entries o
     where o.person_id = r.person_id and not o.is_archived and o.archive_batch_id is distinct from v_batch
       and o.status in ('pending_confirm','pending_approval','confirmed','approved')
       and o.created_at > r.archived_at
       and r.started_at < coalesce(o.ended_at, now()) and o.started_at < r.ended_at
     limit 1;
    if v_conflict is not null then
      raise exception 'can''t restore: % would overlap %, which is already logged', time_entry_label(r.id), time_entry_label(v_conflict);
    end if;
  end loop;

  perform archive_set_bypass_flags();

  -- Whole batch comes back together (the 12-hour cap trigger still checks
  -- each restored time entry).
  update projects set is_archived = false, archived_at = null, archived_by = null, archive_reason = null, archive_batch_id = null, archive_is_root = false where archive_batch_id = v_batch;
  update tasks set is_archived = false, archived_at = null, archived_by = null, archive_reason = null, archive_batch_id = null, archive_is_root = false where archive_batch_id = v_batch;
  update time_entries set is_archived = false, archived_at = null, archived_by = null, archive_reason = null, archive_batch_id = null, archive_is_root = false where archive_batch_id = v_batch;
  update kb_categories set is_archived = false, archived_at = null, archived_by = null, archive_reason = null, archive_batch_id = null, archive_is_root = false where archive_batch_id = v_batch;
  update kb_entries set is_archived = false, archived_at = null, archived_by = null, archive_reason = null, archive_batch_id = null, archive_is_root = false where archive_batch_id = v_batch;
  if p_kind not in ('project','task','time_entry','kb_category','kb_entry') then
    execute format(
      'update %I set is_archived = false, archived_at = null, archived_by = null, archive_reason = null, archive_batch_id = null, archive_is_root = false %s where id = $1',
      v_table, case when p_kind = 'holiday' then '' else ', is_active = true' end
    ) using p_id;
  end if;
end;
$$;

revoke all on function restore_item(text, uuid) from public, anon;
grant execute on function restore_item(text, uuid) to authenticated;

create or replace view archive_items as
with roots as (
  select 'project'::text kind, p.id, p.name label,
         coalesce('P-' || lpad(p.project_number::text, 4, '0'), null) ref,
         (select name from people where id = p.owner_id) context,
         p.archived_at, p.archived_by, p.archive_reason, p.archive_batch_id
    from projects p where p.is_archived and p.archive_is_root
  union all
  select 'task', t.id, t.name, 'T-' || lpad(t.task_number::text, 4, '0'),
         (select name from projects where id = t.project_id), t.archived_at, t.archived_by, t.archive_reason, t.archive_batch_id
    from tasks t where t.is_archived and t.archive_is_root
  union all
  select 'time_entry', te.id,
         coalesce((select name from tasks where id = te.task_id), (select name from non_project_activity_types where id = te.activity_type_id), 'Time entry')
           || ' · ' || to_char(te.started_at at time zone 'Asia/Manila', 'Mon DD HH12:MI AM') || coalesce(' – ' || to_char(te.ended_at at time zone 'Asia/Manila', 'HH12:MI AM'), ''),
         'TL-' || lpad(te.entry_number::text, 4, '0'),
         (select name from people where id = te.person_id), te.archived_at, te.archived_by, te.archive_reason, te.archive_batch_id
    from time_entries te where te.is_archived and te.archive_is_root
  union all
  select 'kb_category', c.id, c.name, null, 'Knowledge Base', c.archived_at, c.archived_by, c.archive_reason, c.archive_batch_id
    from kb_categories c where c.is_archived and c.archive_is_root
  union all
  select 'kb_entry', e.id, e.title, null, (select name from kb_categories where id = e.category_id), e.archived_at, e.archived_by, e.archive_reason, e.archive_batch_id
    from kb_entries e where e.is_archived and e.archive_is_root
  union all
  select 'holiday', h.id, coalesce(h.name, 'Holiday') || ' (' || to_char(h.date, 'Mon DD, YYYY') || ')', null, 'Holiday calendar', h.archived_at, h.archived_by, h.archive_reason, h.archive_batch_id
    from holidays h where h.is_archived and h.archive_is_root
  union all
  select 'time_off', x.id,
         (select name from people where id = x.person_id) || ' · ' || case x.status when 'half_day' then 'Half day' else 'Off' end
           || ' (' || to_char(x.date, 'Mon DD, YYYY') || ')',
         null, 'Time off', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id
    from archived_time_off x
  union all select 'project_type', x.id, x.name, null, 'Settings · Project Types', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from project_types x where x.is_archived and x.archive_is_root
  union all select 'project_category', x.id, x.name, null, 'Settings · Project Categories', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from project_categories x where x.is_archived and x.archive_is_root
  union all select 'project_source', x.id, x.name, null, 'Settings · Project Sources', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from project_sources x where x.is_archived and x.archive_is_root
  union all select 'project_phase', x.id, x.name, null, 'Settings · Project Phases', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from project_phases x where x.is_archived and x.archive_is_root
  union all select 'project_planning_type', x.id, x.name, null, 'Settings · Planning Types', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from project_planning_types x where x.is_archived and x.archive_is_root
  union all select 'work_type', x.id, x.name, null, 'Settings · Work Types', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from work_types x where x.is_archived and x.archive_is_root
  union all select 'output_type', x.id, x.name, null, 'Settings · Output Types', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from output_types x where x.is_archived and x.archive_is_root
  union all select 'activity_type', x.id, x.name, null, 'Settings · Non-Project Activity Types', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from non_project_activity_types x where x.is_archived and x.archive_is_root
  union all select 'time_entry_reason', x.id, x.name, null, 'Settings · Time Logging Reasons', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from time_entry_reasons x where x.is_archived and x.archive_is_root
  union all select 'cancellation_reason', x.id, x.name, null, 'Settings · Task Cancellation Reasons', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from task_cancellation_reasons x where x.is_archived and x.archive_is_root
  union all select 'decline_reason', x.id, x.name, null, 'Settings · Baseline Decline Reasons', x.archived_at, x.archived_by, x.archive_reason, x.archive_batch_id from baseline_decline_reasons x where x.is_archived and x.archive_is_root
)
select r.*,
       (select name from people where id = r.archived_by) archived_by_name,
       r.archived_at + interval '90 days' purge_at,
       (select count(*) from tasks where archive_batch_id = r.archive_batch_id and not archive_is_root) bundled_tasks,
       (select count(*) from time_entries where archive_batch_id = r.archive_batch_id and not archive_is_root) bundled_time_entries,
       (select count(*) from kb_entries where archive_batch_id = r.archive_batch_id and not archive_is_root) bundled_kb_entries
  from roots r;

grant select on archive_items to authenticated;
