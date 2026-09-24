-- Phase 113 (2026-09-24): Time Log IDs. Sandra: "for time log entries
-- please add time log entry IDs -- apply to all instances where this needs
-- to be seen." Every time entry (timer, manual, non-project, follow-up)
-- gets a permanent sequence-backed number shown as "TL-0001", same pattern
-- as task_number (T-0001) / non_project_entry_number (NP-0001).
create sequence if not exists time_entry_number_seq;
alter table time_entries add column if not exists entry_number bigint;

-- Backfill chronologically (lock triggers bypassed for this one write).
select set_config('app.bypass_time_entry_lock', 'on', false),
       set_config('app.bypass_time_entry_daily_cap', 'on', false);
with ordered as (
  select id, row_number() over (order by created_at, started_at, id) rn
    from time_entries where entry_number is null
)
update time_entries te set entry_number = o.rn + coalesce((select max(entry_number) from time_entries), 0)
  from ordered o where o.id = te.id;
select set_config('app.bypass_time_entry_lock', '', false),
       set_config('app.bypass_time_entry_daily_cap', '', false);

select setval('time_entry_number_seq', greatest((select coalesce(max(entry_number), 0) from time_entries), 1));
alter table time_entries alter column entry_number set default nextval('time_entry_number_seq');
alter table time_entries alter column entry_number set not null;
create unique index if not exists time_entries_entry_number_key on time_entries(entry_number);

-- Messages (overlap / trim / restore) now lead with the Time Log ID.
create or replace function time_entry_label(p_entry_id uuid) returns text
language sql stable security definer as $$
  select 'TL-' || lpad(te.entry_number::text, 4, '0') || ' · '
         || coalesce('T-' || lpad(t.task_number::text, 4, '0'), 'NP-' || lpad(te.non_project_entry_number::text, 4, '0'), 'entry')
         || ' (' || to_char(te.started_at at time zone 'Asia/Manila', 'Mon DD HH12:MI AM')
         || ' - ' || coalesce(to_char(te.ended_at at time zone 'Asia/Manila', 'HH12:MI AM'), 'running') || ')'
    from time_entries te
    left join tasks t on t.id = te.task_id
   where te.id = p_entry_id
$$;

-- Archive page: time entries show their Time Log ID.
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
