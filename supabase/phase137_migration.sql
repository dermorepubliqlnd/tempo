-- phase137 (Sandra, 2026-10-04): notes on tasks as well as projects.
-- A task note is still a project note (same RLS: can_see_project), with
-- task_id set. Deleting a task keeps its notes on the project.
alter table project_notes add column if not exists task_id uuid references tasks(id) on delete set null;
create index if not exists project_notes_task_id_idx on project_notes(task_id);
