-- October 9 Release go-live switches
update public.app_settings set auto_approvals_live = true, timer_10pm_stop_live = true;
-- daily auto-validation sweep at 06:00 Manila (22:00 UTC)
select cron.schedule('auto-validations-daily', '0 22 * * *', $$select public.run_auto_validations()$$)
 where not exists (select 1 from cron.job where jobname = 'auto-validations-daily');
select (select auto_approvals_live from app_settings limit 1) aa_live,
       (select timer_10pm_stop_live from app_settings limit 1) t10_live,
       public.auto_approvals_enabled() aa_enabled,
       (select string_agg(jobname || ' ' || schedule || ' active=' || active, '; ') from cron.job) jobs;
