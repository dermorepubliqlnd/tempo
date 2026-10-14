-- phase190 (2026-10-14, Sandra): ongoing containers (is_operational projects,
-- e.g. P-0079 Training Delivery - H2 2026) -- team members can add their own
-- tasks. Until now only Full Access or the project owner could add tasks
-- anywhere, so Limited trainers got "Couldn't create the task".
--
-- Rule after this: Full Access, or the project owner, or -- on an ongoing
-- container that isn't closed -- anyone adding a task assigned to THEMSELVES.
-- Regular (non-container) projects are unchanged.

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    public.my_access_level() = 'full'
    or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = public.my_person_id())
    or (
      assignee_id = public.my_person_id()
      and exists (
        select 1 from public.projects p
        where p.id = project_id
          and coalesce(p.is_operational, false)
          and coalesce(p.wbs_status, '') <> 'closed'
      )
    )
  );
