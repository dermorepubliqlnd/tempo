-- phase183b -- RUN ONLY AT RELEASE, together with the main-branch code that
-- uses the new phase names (lib/notionOptions.ts PROJECT_PHASE_* lists,
-- PROJECT_PHASE_TONES, StagePhaseRules default). Running it earlier would
-- leave the live app's hard-coded phase lists out of step.
--
-- Renames the project Phase values for EVERY project (Sandra 2026-10-13:
-- "rename for everyone") and moves Evaluation & Closure after Implementation.
-- 2026-10-14 (Sandra): final names are Analysis & Scoping, Design, Development,
-- Implementation, Evaluation & Closure -- Design and Development keep their
-- current names; only Scoping, Delivery and Evaluation are renamed.
begin;
alter table public.projects disable trigger trg_touch_activity_projects;

update public.project_phases set name = 'Analysis & Scoping',        sort_order = 3 where name = 'Scoping';
update public.project_phases set sort_order = 4 where name = 'Design';
update public.project_phases set sort_order = 5 where name = 'Development';
update public.project_phases set name = 'Implementation',            sort_order = 6 where name = 'Delivery';
update public.project_phases set name = 'Evaluation & Closure',      sort_order = 7 where name = 'Evaluation';

update public.projects set phase = case phase
  when 'Scoping' then 'Analysis & Scoping'
  when 'Delivery' then 'Implementation'
  when 'Evaluation' then 'Evaluation & Closure'
  else phase end
where phase in ('Scoping', 'Delivery', 'Evaluation');

update public.lifecycle_phases set project_phase = label;

update public.app_settings
   set stage_phase_rules = jsonb_set(stage_phase_rules, '{draft,phase}', '"Analysis & Scoping"')
 where stage_phase_rules->'draft'->>'phase' = 'Scoping';

alter table public.projects enable trigger trg_touch_activity_projects;
commit;

-- phase218 KB -- RUN AT RELEASE, together with phase183b (phase rename).
-- Only two articles use the old phase names as phase names (the other
-- "Delivery" hits are "Training Delivery" / "Delivery risk", not phases).
insert into kb_entry_versions (entry_id, title, content, edited_by)
  select id, title, content, updated_by from kb_entries where article_number in (1, 14);
update kb_entries set content = replace(content,
    '{warning:Scoping}, {pink:Design}, {gold:Development}, {warning:Evaluation}, {accent:Delivery}',
    '{warning:Analysis & Scoping}, {pink:Design}, {gold:Development}, {accent:Implementation}, {warning:Evaluation & Closure}'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
 where article_number = 1;
update kb_entries set content = replace(content, 'Draft projects show **Scoping**', 'Draft projects show **Analysis & Scoping**'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
 where article_number = 14;

-- Release 2026-10-23: every new project uses the new lifecycle.
alter table public.projects alter column lifecycle_version set default 2;
-- Publish KB-0033 (October 23 Release).
update public.kb_entries set is_active = true, updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6' where article_number = 33;

select 'phases: ' || (select string_agg(name, ' > ' order by sort_order) from project_phases)
 || ' | old names left: ' || (select count(*) from projects where phase in ('Scoping','Delivery','Evaluation'))
 || ' | default: ' || (select column_default from information_schema.columns where table_name='projects' and column_name='lifecycle_version')
 || ' | KB1/14 renamed: ' || (select string_agg(article_number||'='||(position('Analysis & Scoping' in content)>0)::text, ',') from kb_entries where article_number in (1,14))
 || ' | KB33 active: ' || (select is_active::text || ' / ' || title from kb_entries where article_number=33);
