-- Phase 124 (2026-09-29, Sandra: "in the project type I can edit the list
-- or options but no option to choose colors ... apply to all list options
-- that has color coding so I can customize colors for its pill appearance
-- on the projects list or task list").
--
-- Adds an admin-chosen pill color (a status-pill tone name, same palette
-- Project Categories already use) to every Site Settings list that shows
-- as a pill on the Projects / Tasks lists. Backfilled with the colors the
-- app was hardcoding by name, so nothing changes visually until Sandra
-- picks new ones.

alter table project_types          add column if not exists color text not null default 'neutral';
alter table project_planning_types add column if not exists color text not null default 'neutral';
alter table project_phases         add column if not exists color text not null default 'neutral';
alter table project_sources        add column if not exists color text not null default 'neutral';
alter table work_types             add column if not exists color text not null default 'neutral';
alter table output_types           add column if not exists color text not null default 'neutral';

update project_types set color = case name when 'BAU' then 'success' when 'Development' then 'accent' else color end
 where color = 'neutral';
update project_planning_types set color = case name when 'Planned' then 'success' when 'Ad Hoc' then 'warning' else color end
 where color = 'neutral';
update project_phases set color = case name
    when 'Scoping' then 'warning' when 'Design' then 'pink' when 'Development' then 'gold'
    when 'Delivery' then 'accent' when 'Evaluation' then 'warning' when 'Done' then 'success'
    else color end
 where color = 'neutral';

select 'project_types' t, name, color from project_types
union all select 'planning', name, color from project_planning_types
union all select 'phases', name, color from project_phases
order by 1, 2;
