-- Phase 41 (2026-09-07): Auto-generated Project ID
-- Sandra: "can you also add a project ID. This is an automated sequence
-- number base it from the date when the project was added created."
-- Clarified via AskUserQuestion: projects had no created_at at all.
-- Sandra's call: "use the project start date or task with earliest date
-- for existing ones then future will capture actual created date."
--
-- created_at: new column, defaults to now() for every future insert.
-- Existing rows backfilled from (in order of preference): the project's
-- own start_date, else the earliest start_date among its tasks, else the
-- earliest original_due_date among its tasks, else now() (only reachable
-- for a project with no start date and literally zero tasks).
--
-- project_number: a stable integer assigned once to existing projects by
-- row_number() over (order by created_at, id) -- i.e. earliest
-- created_at gets #1 -- then driven by a real sequence for every project
-- created from here on (nextval always issues a number after the highest
-- existing one, so ordering stays date-consistent going forward). Display
-- format (see WbsPlanning.tsx) is "P-0007" (4-digit, zero-padded).

alter table projects add column if not exists created_at timestamptz;

update projects set created_at = coalesce(
  start_date::timestamptz,
  (select min(t.start_date) from tasks t where t.project_id = projects.id)::timestamptz,
  (select min(t.original_due_date) from tasks t where t.project_id = projects.id)::timestamptz,
  now()
) where created_at is null;

alter table projects alter column created_at set default now();
alter table projects alter column created_at set not null;

alter table projects add column if not exists project_number integer;

with numbered as (
  select id, row_number() over (order by created_at, id) as rn from projects
)
update projects p set project_number = numbered.rn from numbered where numbered.id = p.id and p.project_number is null;

create sequence if not exists project_number_seq;
select setval('project_number_seq', coalesce((select max(project_number) from projects), 0) + 1, false);

alter table projects alter column project_number set default nextval('project_number_seq');
alter table projects alter column project_number set not null;

create unique index if not exists projects_project_number_key on projects(project_number);
