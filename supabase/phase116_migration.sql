-- Phase 116 (2026-09-24): clear Work Type / Output Type / Output Count on
-- parent tasks (Sandra: parents are N/A -- outputs live on sub-tasks).
-- The app already hides and ignores these; this just cleans the data.
begin;
select set_config('app.bypass_closed_project_lock', 'on', true);
select set_config('app.bypass_done_task_lock', 'on', true);
select set_config('app.bypass_status_baseline_lock', 'on', true);

update tasks p
   set work_type_id = null, output_type_id = null, output_count = null
 where exists (select 1 from tasks c where c.parent_task_id = p.id)
   and (p.work_type_id is not null or p.output_type_id is not null or p.output_count is not null)
returning 'T-' || lpad(p.task_number::text, 4, '0') as task_id, p.name;
commit;
