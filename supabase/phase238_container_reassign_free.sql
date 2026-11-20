-- phase238 (2026-11-20, Sandra: "bypass this, an ongoing container should be free for all").
-- Ongoing containers (projects.is_operational, not closed): ANY signed-in person may move ANY task
-- to any active person. Only the Assignee opens up: on someone else's task a non-manager still
-- cannot change anything else (name, dates, hours, structure...). Normal projects unchanged.
-- Builds on phase237 (anyone can add tasks for anyone on containers). APPLIED LIVE 2026-11-20.

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (
    public.r2_can_manage_project_tasks(project_id)
    or assignee_id = public.my_person_id()
    or public.r2_is_open_container(project_id)
  )
  with check (
    public.r2_can_manage_project_tasks(project_id)
    or assignee_id = public.my_person_id()
    or (public.r2_is_open_container(project_id) and public.r2_is_active_person(assignee_id))
  );

-- Runs first among BEFORE UPDATE triggers (name sorts first), so it sees the row as the user sent it.
create or replace function public.trg_a_r2_container_reassign_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if public.my_person_id() is null then return new; end if;                       -- system jobs
  if not public.r2_is_open_container(old.project_id) then return new; end if;     -- normal projects: phase197 rules
  if public.r2_can_manage_project_tasks(old.project_id) then return new; end if;  -- owner / supervisor / Full Access
  if old.assignee_id = public.my_person_id() then return new; end if;             -- own task: existing rules
  if (to_jsonb(new) - 'assignee_id') is distinct from (to_jsonb(old) - 'assignee_id') then
    raise exception 'On ongoing projects you can reassign anyone''s task, but only the assignee, the project owner, their supervisor or Full Access can change its other details.';
  end if;
  return new;
end;
$$;
drop trigger if exists a_r2_container_reassign_guard on public.tasks;
create trigger a_r2_container_reassign_guard before update on public.tasks
  for each row execute function public.trg_a_r2_container_reassign_guard();

-- Rollback (restores phase197 update rule):
-- drop trigger if exists a_r2_container_reassign_guard on public.tasks;
-- drop function if exists public.trg_a_r2_container_reassign_guard();
-- drop policy if exists tasks_update on public.tasks;
-- create policy tasks_update on public.tasks for update to authenticated
--   using (public.r2_can_manage_project_tasks(project_id) or assignee_id = public.my_person_id())
--   with check (public.r2_can_manage_project_tasks(project_id) or assignee_id = public.my_person_id());
