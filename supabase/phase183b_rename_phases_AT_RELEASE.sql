-- phase183b -- RUN ONLY AT RELEASE, together with the main-branch code that
-- uses the new phase names (lib/notionOptions.ts PROJECT_PHASE_* lists,
-- PROJECT_PHASE_TONES, StagePhaseRules default). Running it earlier would
-- leave the live app's hard-coded phase lists out of step.
--
-- Renames the project Phase values for EVERY project (Sandra 2026-10-13:
-- "rename for everyone") and moves Evaluation & Closure after Delivery.
begin;
alter table public.projects disable trigger trg_touch_activity_projects;

update public.project_phases set name = 'Analysis & Scoping',        sort_order = 3 where name = 'Scoping';
update public.project_phases set name = 'Learning Design',           sort_order = 4 where name = 'Design';
update public.project_phases set name = 'Learning Development',      sort_order = 5 where name = 'Development';
update public.project_phases set name = 'Implementation / Delivery', sort_order = 6 where name = 'Delivery';
update public.project_phases set name = 'Evaluation & Closure',      sort_order = 7 where name = 'Evaluation';

update public.projects set phase = case phase
  when 'Scoping' then 'Analysis & Scoping'
  when 'Design' then 'Learning Design'
  when 'Development' then 'Learning Development'
  when 'Delivery' then 'Implementation / Delivery'
  when 'Evaluation' then 'Evaluation & Closure'
  else phase end
where phase in ('Scoping', 'Design', 'Development', 'Delivery', 'Evaluation');

update public.lifecycle_phases set project_phase = label;

update public.app_settings
   set stage_phase_rules = jsonb_set(stage_phase_rules, '{draft,phase}', '"Analysis & Scoping"')
 where stage_phase_rules->'draft'->>'phase' = 'Scoping';

alter table public.projects enable trigger trg_touch_activity_projects;
commit;
