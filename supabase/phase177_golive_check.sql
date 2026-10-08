-- October 9 Release: read-only check of what the first auto-validation sweep would touch
select
  count(*) filter (where t.actual_completion_date::date > t.current_due_date::date) as late_now,
  count(*) filter (where t.actual_completion_date::date = t.current_due_date::date
     and public.working_days_after(coalesce((t.submitted_on at time zone 'Asia/Manila')::date, t.actual_completion_date::date), (now() at time zone 'Asia/Manila')::date) >= 2) as on_due_waited,
  count(*) filter (where t.actual_completion_date::date < t.current_due_date::date) as early_stays,
  string_agg(t.task_number || ' ' || p.project_number || case when t.actual_completion_date::date > t.current_due_date::date then ' late' else ' on-due' end, ', ' order by t.task_number)
    filter (where t.actual_completion_date::date >= t.current_due_date::date) as list,
  (select auto_approvals_live from app_settings limit 1) as aa_live,
  (select timer_10pm_stop_live from app_settings limit 1) as t10_live,
  (select string_agg(jobname || ' ' || schedule || ' active=' || active, '; ') from cron.job) as jobs
from tasks t join projects p on p.id = t.project_id
where t.status = 'Done' and not t.is_archived and t.validated_completion_date is null
  and t.actual_completion_date is not null and t.current_due_date is not null and not t.validation_hold
  and not exists (select 1 from tasks c where c.parent_task_id = t.id and not c.is_archived)
  and coalesce(p.wbs_status, '') <> 'closed';
