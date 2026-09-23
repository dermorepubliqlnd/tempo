-- Phase 104 (2026-09-23): Archive = recycle bin. Core rule: NOTHING is
-- hard-deleted from the app. Every delete routes to the Archive, tagged by
-- type, and is auto-purged 90 days after archiving (Sandra's choices:
-- records + Settings lists; projects/parent tasks archive as one bundle;
-- auto-purge after 90 days; everyone can SEE the archive, only the person
-- who archived an item or Full Access can RESTORE it).
--
-- Kinds (kind -> table):
--   project -> projects            (bundle: its tasks + their time entries)
--   task -> tasks                  (bundle: descendant sub-tasks + all their time entries)
--   time_entry -> time_entries
--   kb_category -> kb_categories   (bundle: its entries)
--   kb_entry -> kb_entries
--   holiday -> holidays
--   Settings lists: project_type, project_category, project_source,
--   project_phase, project_planning_type, work_type, output_type,
--   activity_type (non_project_activity_types), time_entry_reason,
--   cancellation_reason (task_cancellation_reasons),
--   decline_reason (baseline_decline_reasons)
--
-- Background switches (task_dependencies, task_daily_hidden,
-- person_availability, work_type_output_types, project_status_phase_mapping)
-- are toggles, not records, and keep their normal delete.

-- 1. Archive columns everywhere ------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['projects','tasks','time_entries','kb_categories','kb_entries','holidays',
    'project_types','project_categories','project_sources','project_phases','project_planning_types',
    'work_types','output_types','non_project_activity_types','time_entry_reasons',
    'task_cancellation_reasons','baseline_decline_reasons'] loop
    execute format('alter table %I add column if not exists is_archived boolean not null default false', t);
    execute format('alter table %I add column if not exists archived_at timestamptz', t);
    execute format('alter table %I add column if not exists archived_by uuid references people(id)', t);
    execute format('alter table %I add column if not exists archive_reason text', t);
    execute format('alter table %I add column if not exists archive_batch_id uuid', t);
    execute format('alter table %I add column if not exists archive_is_root boolean not null default false', t);
  end loop;
end $$;

-- Backfill what was already archived under the old 30-day scheme.
-- (lock triggers would otherwise reject touching finalized/closed rows)
select set_config('app.bypass_time_entry_lock', 'on', false),
       set_config('app.bypass_closed_project_lock', 'on', false),
       set_config('app.bypass_done_task_lock', 'on', false),
       set_config('app.bypass_due_date_lock', 'on', false),
       set_config('app.bypass_start_date_lock', 'on', false),
       set_config('app.bypass_status_baseline_lock', 'on', false),
       set_config('app.bypass_timelines_lock_governance', 'on', false),
       set_config('app.bypass_time_entry_daily_cap', 'on', false);
update projects set archive_batch_id = gen_random_uuid(), archive_is_root = true, archived_at = coalesce(archived_at, now())
 where is_archived and archive_batch_id is null;
update tasks t set archive_batch_id = p.archive_batch_id, archive_is_root = false, archived_at = coalesce(t.archived_at, p.archived_at)
  from projects p
 where t.project_id = p.id and t.is_archived and p.is_archived and t.archive_batch_id is null;
update tasks set archive_batch_id = gen_random_uuid(), archive_is_root = true, archived_at = coalesce(archived_at, now())
 where is_archived and archive_batch_id is null;
update time_entries set archive_batch_id = gen_random_uuid(), archive_is_root = true, archived_at = coalesce(archived_at, now())
 where is_archived and archive_batch_id is null;
select set_config('app.bypass_time_entry_lock', '', false),
       set_config('app.bypass_closed_project_lock', '', false),
       set_config('app.bypass_done_task_lock', '', false),
       set_config('app.bypass_due_date_lock', '', false),
       set_config('app.bypass_start_date_lock', '', false),
       set_config('app.bypass_status_baseline_lock', '', false),
       set_config('app.bypass_timelines_lock_governance', '', false),
       set_config('app.bypass_time_entry_daily_cap', '', false);

-- 2. Kind registry --------------------------------------------------------
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
  end
$$;

create or replace function archive_set_bypass_flags() returns void
language plpgsql as $$
begin
  perform set_config('app.bypass_closed_project_lock', 'on', true);
  perform set_config('app.bypass_done_task_lock', 'on', true);
  perform set_config('app.bypass_due_date_lock', 'on', true);
  perform set_config('app.bypass_start_date_lock', 'on', true);
  perform set_config('app.bypass_status_baseline_lock', 'on', true);
  perform set_config('app.bypass_time_entry_lock', 'on', true);
  perform set_config('app.bypass_timelines_lock_governance', 'on', true);
end;
$$;

-- 3. Daily-cap trigger: archived entries don't count, and archiving is
--    never blocked by the cap.
create or replace function enforce_time_entry_daily_cap() returns trigger
language plpgsql as $$
declare
  v_day date;
  v_other_minutes numeric;
  v_total_minutes numeric;
  v_cap constant numeric := 720;
begin
  if coalesce(current_setting('app.bypass_time_entry_daily_cap', true), '') = 'on' then
    return NEW;
  end if;
  if NEW.duration_minutes is null or NEW.status in ('running', 'rejected') or NEW.is_archived then
    return NEW;
  end if;
  v_day := (NEW.started_at at time zone 'Asia/Manila')::date;
  select coalesce(sum(duration_minutes), 0) into v_other_minutes
    from time_entries
   where person_id = NEW.person_id and id <> NEW.id
     and status not in ('running', 'rejected') and not is_archived
     and (started_at at time zone 'Asia/Manila')::date = v_day;
  v_total_minutes := v_other_minutes + NEW.duration_minutes;
  if v_total_minutes > v_cap then
    raise exception 'this would bring logged hours for % to %h, over the 12-hour daily limit (% h already logged/pending that day)',
      to_char(v_day, 'Mon DD, YYYY'), round(v_total_minutes / 60.0, 2), round(v_other_minutes / 60.0, 2);
  end if;
  return NEW;
end;
$$;

-- 4. archive_item ----------------------------------------------------------
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
  if p_kind = 'project' then
    select owner_id into v_owner from projects where id = p_id;
    if not (v_full or v_owner = v_me) then
      raise exception 'only the project owner or Full Access can archive this project';
    end if;
  elsif p_kind = 'task' then
    select pr.owner_id, pr.wbs_status into v_owner, v_wbs from tasks t left join projects pr on pr.id = t.project_id where t.id = p_id;
    if not (v_full or v_owner = v_me) then
      raise exception 'only the project owner or Full Access can archive this task';
    end if;
    if v_wbs = 'closed' then
      raise exception 'this project is closed -- its tasks are final and can no longer be archived';
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

grant execute on function archive_item(text, uuid, text) to authenticated;

-- 5. restore_item -------------------------------------------------------------
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

  -- Time entries coming back must not overlap live entries.
  for r in
    select te.id, te.person_id, te.started_at, te.ended_at
      from time_entries te
     where te.archive_batch_id = v_batch and te.is_archived and te.ended_at is not null
       and te.status in ('pending_confirm','pending_approval','confirmed','approved')
  loop
    v_conflict := find_time_entry_overlap(r.person_id, r.started_at, r.ended_at,
                    array(select id from time_entries where archive_batch_id = v_batch));
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

grant execute on function restore_item(text, uuid) to authenticated;

-- 6. Archive listing (everyone sees everything; roots only + bundle counts)
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
         coalesce('T-' || lpad((select task_number from tasks where id = te.task_id)::text, 4, '0'), 'NP-' || lpad(te.non_project_entry_number::text, 4, '0')),
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

-- 7. Archived KB items and holidays disappear from normal reads (nothing
--    references them by id for display, so hiding them at the RLS layer is
--    the least invasive way to drop them from every page at once).
drop policy if exists kb_categories_select on kb_categories;
create policy kb_categories_select on kb_categories for select using (not is_archived);
drop policy if exists kb_entries_select on kb_entries;
create policy kb_entries_select on kb_entries for select using (not is_archived);
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'holidays' and cmd = 'SELECT' loop
    execute format('drop policy %I on holidays', pol.policyname);
  end loop;
end $$;
create policy holidays_select on holidays for select using (not is_archived);

-- 8. No hard deletes from the app: remove DELETE policies on archivable
--    tables and lock the old hard-delete RPCs.
do $$
declare pol record;
begin
  for pol in select tablename, policyname from pg_policies
              where schemaname = 'public' and cmd = 'DELETE'
                and tablename in ('projects','tasks','time_entries','kb_categories','kb_entries','holidays',
                  'project_types','project_categories','project_sources','project_phases','project_planning_types',
                  'work_types','output_types','non_project_activity_types','time_entry_reasons',
                  'task_cancellation_reasons','baseline_decline_reasons') loop
    execute format('drop policy %I on %I', pol.policyname, pol.tablename);
  end loop;
end $$;
revoke execute on function delete_tasks_and_dependents(uuid[]) from anon, authenticated;
revoke execute on function delete_project_and_dependents(uuid) from anon, authenticated;
revoke execute on function delete_pending_manual_time_entry(uuid) from anon, authenticated;

-- 9. Auto-purge after 90 days (daily, pg_cron). The only hard delete left,
--    and it's the system's. Keeps the historical Utilization snapshot
--    behavior the old permanent-delete path had.
create or replace function purge_expired_archive() returns void
language plpgsql security definer as $$
declare
  v_cutoff timestamptz := now() - interval '90 days';
  r record;
  v_ids uuid[];
  tid uuid;
  t text;
begin
  perform set_config('app.bypass_closed_project_lock', 'on', true);

  -- Projects (whole bundle)
  for r in select id, archive_batch_id from projects where is_archived and archived_at < v_cutoff loop
    perform archive_project_pm_overhead(r.id);
    select array_agg(id) into v_ids from tasks where project_id = r.id;
    if v_ids is not null then
      foreach tid in array v_ids loop perform archive_task_utilization(tid); end loop;
      delete from extension_requests where task_id = any(v_ids);
      delete from task_effort_changes where task_id = any(v_ids);
      delete from time_entries where task_id = any(v_ids);
      delete from task_collaborators where task_id = any(v_ids);
      delete from task_planning_snapshots where task_id = any(v_ids);
      delete from task_dependencies where task_id = any(v_ids) or depends_on_task_id = any(v_ids);
      delete from tasks where id = any(v_ids);
    end if;
    delete from projects where id = r.id;
  end loop;

  -- Tasks archived on their own (with their bundled sub-tasks)
  select array_agg(id) into v_ids from tasks where is_archived and archived_at < v_cutoff;
  if v_ids is not null then
    foreach tid in array v_ids loop perform archive_task_utilization(tid); end loop;
    delete from extension_requests where task_id = any(v_ids);
    delete from task_effort_changes where task_id = any(v_ids);
    delete from time_entries where task_id = any(v_ids);
    delete from task_collaborators where task_id = any(v_ids);
    delete from task_planning_snapshots where task_id = any(v_ids);
    delete from task_dependencies where task_id = any(v_ids) or depends_on_task_id = any(v_ids);
    delete from tasks where id = any(v_ids);
  end if;

  delete from time_entries where is_archived and archived_at < v_cutoff;
  delete from kb_entries where is_archived and archived_at < v_cutoff;
  delete from kb_categories where is_archived and archived_at < v_cutoff;
  delete from holidays where is_archived and archived_at < v_cutoff;

  -- Settings lists: skip any row still referenced somewhere (it just stays archived).
  foreach t in array array['project_types','project_categories','project_sources','project_phases','project_planning_types',
    'work_types','output_types','non_project_activity_types','time_entry_reasons','task_cancellation_reasons','baseline_decline_reasons'] loop
    for r in execute format('select id from %I where is_archived and archived_at < $1', t) using v_cutoff loop
      begin
        execute format('delete from %I where id = $1', t) using r.id;
      exception when foreign_key_violation then
        null;
      end;
    end loop;
  end loop;
end;
$$;

revoke execute on function purge_expired_archive() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('purge-expired-archive');
exception when others then null;
end $$;
select cron.schedule('purge-expired-archive', '30 18 * * *', 'select purge_expired_archive()');  -- 02:30 Asia/Manila

-- The old single-purpose time-entry archive/restore RPCs are superseded by
-- archive_item/restore_item (restore must go through the batch-aware path).
revoke execute on function archive_time_entry(uuid, text) from anon, authenticated;
revoke execute on function unarchive_time_entry(uuid) from anon, authenticated;
