-- phase237 (2026-11-20, Sandra: "Allow everyone for ongoing projects to add tasks for their peers";
-- peers = anyone in Tempo, straight to Live). Ongoing containers (projects.is_operational, open):
-- any signed-in person may add a task for ANY active person, not only themselves / people below
-- them (phase190b/197). Normal projects unchanged: owner, owner's supervisor or Full Access.
-- Reassigning an existing task is unchanged (tasks_update, phase197: owner/supervisor/Full Access).
-- APPLIED LIVE 2026-11-20.

create or replace function public.r2_is_active_person(p_person uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where id = p_person and is_active = true);
$$;
grant execute on function public.r2_is_active_person(uuid) to authenticated;

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    public.r2_can_manage_project_tasks(project_id)
    or (
      (assignee_id = public.my_person_id()
        or public.is_approver_for(assignee_id)
        or public.r2_is_active_person(assignee_id))
      and public.r2_is_open_container(project_id)
    )
  );

-- Rollback (restores phase197):
-- drop policy if exists tasks_insert on public.tasks;
-- create policy tasks_insert on public.tasks for insert to authenticated
--   with check (public.r2_can_manage_project_tasks(project_id)
--     or ((assignee_id = public.my_person_id() or public.is_approver_for(assignee_id)) and public.r2_is_open_container(project_id)));
-- drop function if exists public.r2_is_active_person(uuid);
