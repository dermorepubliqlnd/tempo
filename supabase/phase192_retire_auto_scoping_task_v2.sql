-- phase192 (2026-10-14, Sandra): retire the automatic 'Scoping & WBS planning' task for
-- new-lifecycle projects (lifecycle_version = 2) -- the Analysis & Scoping template covers it.
-- Older projects keep it exactly as before. Applied in Supabase 2026-10-14.
do $$
declare d text := pg_get_functiondef('public.ensure_scoping_task'::regproc);
begin
  if position('lifecycle_version' in d) > 0 then return; end if;
  d := regexp_replace(d, '\mbegin\M', 'begin
  -- phase192: new-lifecycle projects use the Analysis & Scoping template instead.
  if (select lifecycle_version from public.projects where id = p_project_id) = 2 then return null; end if;', 'i');
  execute d;
end $$;

update public.tasks t set is_archived = true
where t.is_scoping and not coalesce(t.is_archived, false) and t.status <> 'Done'
  and exists (select 1 from public.projects p where p.id = t.project_id and p.lifecycle_version = 2)
  and not exists (select 1 from public.time_entries e where e.task_id = t.id and not coalesce(e.is_archived, false));
