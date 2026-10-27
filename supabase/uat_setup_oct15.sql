-- UAT setup (2026-10-14, Sandra): archive the old test projects (their time
-- logs are archived with them, so they no longer count), then create the UAT
-- project. Runs as Sandra through the preview channel, same as the app.
do $$
declare
  sandra uuid := 'e7e52a30-4c13-449b-889d-280dc0ca16c6';
  joseph uuid := 'e3f54985-6f7f-43a0-af6c-131b6d9997da';
  nikki  uuid := 'f7dcc180-b8a3-4468-a790-95af20ac40f3';
  princess uuid := '00321581-82e4-4e1b-8a40-6865c417ad22';
  r record;
  v_pid uuid;
  v_mod text := 'M1 GMP Basics';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c4131d85-871b-4d0d-b6eb-d160cef8fae0', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c4131d85-871b-4d0d-b6eb-d160cef8fae0', true);
  perform set_config('request.headers', '{"x-tempo-channel":"preview"}', true);
  set local role authenticated;

  -- 1. Archive the test projects (cascades to tasks and time logs).
  for r in select id from projects where project_number in (111, 112, 113) and not coalesce(is_archived, false) loop
    perform public.archive_item('project', r.id, 'Test project archived before UAT (14 Oct)');
  end loop;

  -- 2. UAT project, owned by Joseph, in Draft.
  insert into projects (name, owner_id, status, wbs_status, phase, start_date, end_date, is_unsaved, lifecycle_version,
                        scoping_effort_mode, category, priority, source_id, planning_type_id, project_type_id, effort_level, description, sort_order)
  values ('UAT – GMP Basics Refresher', joseph, 'Not Started', 'draft', 'Scoping', date '2026-10-15', date '2026-10-30', false, 2,
          'manual', 'Onboarding', 'High', 'd3563705-8f4d-4a36-8e05-397029d7314c', '29614542-c705-4ec8-b3ae-a59260834968',
          'f58b0b92-7cd2-472e-b66e-2e8028579fb9', 'Level 1',
          'UAT project for the 16 Oct Tempo release. One module (M1 GMP Basics) taken from Analysis & Scoping through Design and Development sign-off. Test data only.',
          (extract(epoch from clock_timestamp()) * 1000)::bigint)
  returning id into v_pid;

  -- 3. Phases: Analysis & Scoping, Design, Development only.
  update project_milestones set is_included = false where project_id = v_pid and phase_key in ('delivery', 'evaluation');

  -- 4. Analysis & Scoping template: Nikki does the work, Joseph reviews, Sandra signs off.
  perform public.r2_apply_template(v_pid, 'scoping');
  update tasks set assignee_id = case
      when name ilike '%review scope%' then joseph
      when name ilike '%sign-off%' then sandra
      else nikki end
  where project_id = v_pid;

  -- 5. One module: Nikki designs, Princess builds, Joseph reviews, Sandra signs off.
  perform public.r2_add_module(v_pid, v_mod, nikki);
  update tasks set assignee_id = princess where project_id = v_pid and name = 'Build · ' || v_mod;
  update tasks set assignee_id = joseph   where project_id = v_pid and name like 'Review · %' || v_mod;
  update tasks set assignee_id = sandra   where project_id = v_pid and name like 'Sign-Off · %' || v_mod;
end $$;

select p.project_number, p.name, o.name as owner, p.wbs_status, p.lifecycle_version,
       (select string_agg(phase_key || case when is_included then '' else ' (off)' end, ', ' order by sort_order) from project_milestones m where m.project_id = p.id) as phases,
       (select string_agg(t.name || ' → ' || a.name, ' | ' order by t.sort_order) from tasks t left join people a on a.id = t.assignee_id where t.project_id = p.id and not t.is_archived) as tasks
from projects p join people o on o.id = p.owner_id
where p.name = 'UAT – GMP Basics Refresher' and not p.is_archived
union all
select project_number, name, 'archived', wbs_status, null, null, null from projects where project_number in (111,112,113) and is_archived;
