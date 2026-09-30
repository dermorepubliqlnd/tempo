-- phase126r (2026-10-01, approved by Sandra): 3 projects were CLOSED before the
-- phase114 guardrail (Completed required before closure), so their Status was
-- left "In Progress". Closed projects are locked for owners, so this is an
-- admin data fix. Status -> Completed, Phase -> Done, completed_at = last
-- finished task (actual_completion_date / submitted_on), else closed date.
-- Before: P-0034, P-0036, P-0022 all status='In Progress', wbs_status='closed', phase='Delivery'.
begin;
select set_config('app.bypass_closed_project_lock', 'on', true);
select set_config('app.bypass_status_baseline_lock', 'on', true);
update projects p
   set status = 'Completed',
       phase = 'Done',
       completed_at = coalesce(p.completed_at, (
         select max(coalesce(t.actual_completion_date, t.submitted_on::date))::timestamptz
           from tasks t
          where t.project_id = p.id and t.status = 'Done' and not coalesce(t.is_archived, false)
       ), p.actual_close_date::timestamptz, now())
 where p.project_number in (34, 36, 22) and p.wbs_status = 'closed' and p.status = 'In Progress';
commit;
select 'X' t, 'P-' || lpad(project_number::text, 4, '0') pid, name, status, phase, wbs_status, completed_at::date from projects where project_number in (34, 36, 22) order by project_number;

-- Follow-up (same day): the completed_at stamp trigger set completed_at = now()
-- when Status changed; reset it to the last finished task's date (Manila).
begin;
select set_config('app.bypass_closed_project_lock', 'on', true);
update projects p set completed_at = (select max(coalesce(t.actual_completion_date, t.submitted_on::date)) from tasks t where t.project_id = p.id and t.status = 'Done')::timestamp at time zone 'Asia/Manila'
 where project_number in (22, 34, 36) and wbs_status = 'closed';
commit;
-- Result: P-0036 2026-09-23, P-0034 2026-09-24, P-0022 2026-09-24 (Manila).
