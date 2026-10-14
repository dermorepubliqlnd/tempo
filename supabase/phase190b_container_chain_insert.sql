-- phase190b (2026-10-14, Sandra): ongoing containers (is_operational: P-0079, P-0095) --
-- anyone can add a task for themselves, and anyone above them in the reporting
-- line (is_approver_for) can add one on their behalf. Regular projects unchanged:
-- Full Access or the project owner only. Applied in Supabase 2026-10-14.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    public.my_access_level() = 'full'
    or exists (select 1 from public.projects p where p.id = project_id and p.owner_id = public.my_person_id())
    or (
      (assignee_id = public.my_person_id() or public.is_approver_for(assignee_id))
      and exists (
        select 1 from public.projects p
        where p.id = project_id
          and coalesce(p.is_operational, false)
          and coalesce(p.wbs_status, '') <> 'closed'
      )
    )
  );
