-- phase230 (2026-10-27, Sandra): fix "Utilization This Week 1438%".
-- Cause: permanently deleting the UAT test projects (purge_archive_items, phase209)
-- kept their planned hours as utilization history (deleted_person_day_hours),
-- e.g. 316h for Sandra in the week of 19 Oct.
-- 1. Manual permanent delete (Full Access, Archive) no longer keeps utilization
--    history: it means "it never happened". The 90-day auto-expiry
--    (purge_expired_archive) still keeps history for real work.
-- 2. Clean-up (Sandra chose "test testers only"): remove 7-23 Oct history for
--    Sandra, Nikki, Joseph and Princess. Fritzie, Gemmabelle and Khim kept.
do $$
declare v_src text;
begin
  select pg_get_functiondef('public.purge_archive_items'::regproc) into v_src;
  v_src := regexp_replace(v_src, 'perform archive_project_pm_overhead\([^)]*\);', 'null; /* phase230 */', 'g');
  v_src := regexp_replace(v_src, 'perform archive_task_utilization\([^)]*\);', 'null; /* phase230 */', 'g');
  execute v_src;
end $$;

delete from public.deleted_person_day_hours d using public.people p
 where p.id = d.person_id and p.name in ('Sandra Barlao', 'Nikki Wong', 'Joseph San Jose', 'Princess Diaz')
   and d.date between '2026-10-07' and '2026-10-23';
delete from public.deleted_person_day_points d using public.people p
 where p.id = d.person_id and p.name in ('Sandra Barlao', 'Nikki Wong', 'Joseph San Jose', 'Princess Diaz')
   and d.date between '2026-10-07' and '2026-10-23';

select 'purge keeps history: ' || (position('perform archive_task_utilization' in prosrc) > 0)::text
  || ' | rows left 10-07..10-23: ' || (select count(*) || ' (' || coalesce(round(sum(hours),1),0) || 'h)' from deleted_person_day_hours where date between '2026-10-07' and '2026-10-23')
from pg_proc where proname = 'purge_archive_items';

-- APPLIED TO LIVE 2026-10-27. Result: purge keeps history = false; 5 rows (36.3h) left for 7-23 Oct (Fritzie, Gemmabelle, Khim).
