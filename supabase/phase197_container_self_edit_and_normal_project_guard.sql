-- phase197 (2026-10-14, Sandra -- Parking Lot #23 + #25, Access Model v1.1)
--
-- #23 Ongoing containers (projects.is_operational): the assignee can edit their
--     own task, including its dates, while the due date has not passed yet.
--     Once the due date has passed, a due-date change still needs an approved
--     extension request (unchanged). Owner, owner's supervisor and Full Access
--     can edit any task in the container.
-- #25 Normal projects (is_operational false): only the project owner, the
--     owner's direct supervisor or Full Access can add tasks or change a task's
--     plan (name, dates, hours, assignee, structure). The assignee keeps their
--     execution updates (status, completion, output count, notes).
-- Container rules (phase190b and the above) only ever apply when
-- is_operational is true.

-- Helpers ---------------------------------------------------------------------
create or replace function public.r2_can_manage_project_tasks(p_project_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_access_level() = 'full'
      or exists (
        select 1 from projects p left join people o on o.id = p.owner_id
        where p.id = p_project_id
          and (p.owner_id = public.my_person_id() or o.reports_to = public.my_person_id())
      );
$$;
grant execute on function public.r2_can_manage_project_tasks(uuid) to authenticated;

create or replace function public.r2_is_open_container(p_project_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects p where p.id = p_project_id
                 and coalesce(p.is_operational, false) and coalesce(p.wbs_status, '') <> 'closed');
$$;
grant execute on function public.r2_is_open_container(uuid) to authenticated;

-- Insert (#25 + phase190b kept) -------------------------------------------------
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    public.r2_can_manage_project_tasks(project_id)
    or (
      (assignee_id = public.my_person_id() or public.is_approver_for(assignee_id))
      and public.r2_is_open_container(project_id)
    )
  );

-- Update (#25: owner's supervisor added; assignee keeps own-task updates) -------
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (public.r2_can_manage_project_tasks(project_id) or assignee_id = public.my_person_id())
  with check (public.r2_can_manage_project_tasks(project_id) or assignee_id = public.my_person_id());

-- #25 planning guard: in normal projects an assignee who is not the owner, the
-- owner's supervisor or Full Access can't change the task's plan. ---------------
create or replace function public.trg_r2_planning_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;               -- cascades from other triggers
  if public.my_person_id() is null then return new; end if;        -- system jobs
  if coalesce(current_setting('app.bypass_due_date_lock', true), '') = 'on'
     or coalesce(current_setting('app.bypass_start_date_lock', true), '') = 'on'
     or coalesce(current_setting('app.bypass_validation_rpc', true), '') = 'on'
     or coalesce(current_setting('app.bypass_status_baseline_lock', true), '') = 'on'
     or coalesce(current_setting('app.r2_review_return', true), '') = 'on' then
    return new;                                                      -- approved RPC paths
  end if;
  if public.r2_can_manage_project_tasks(new.project_id) then return new; end if;
  if public.r2_is_open_container(new.project_id) then return new; end if;  -- #23 handles containers
  if new.name is distinct from old.name
     or new.start_date is distinct from old.start_date
     or new.start_date_full is distinct from old.start_date_full
     or new.start_date_standard is distinct from old.start_date_standard
     or new.original_due_date is distinct from old.original_due_date
     or new.current_due_date is distinct from old.current_due_date
     or new.estimated_hours is distinct from old.estimated_hours
     or new.assignee_id is distinct from old.assignee_id
     or new.parent_task_id is distinct from old.parent_task_id
     or new.project_id is distinct from old.project_id then
    raise exception 'Only the project owner, their supervisor or Full Access can change this task''s plan (name, dates, hours or assignee).';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_r2_planning_guard on public.tasks;
create trigger trg_r2_planning_guard before update on public.tasks
  for each row execute function public.trg_r2_planning_guard();

-- #23 due-date lock: containers let the assignee (or owner / supervisor / Full
-- Access) move dates while the due date hasn't passed. Patched in place on the
-- live function so nothing else in it changes. ---------------------------------
create or replace function public.r2_container_date_edit_ok(p_project_id uuid, p_assignee uuid, p_old_due date) returns boolean
language sql stable security definer set search_path = public as $$
  select public.r2_is_open_container(p_project_id)
     and (p_old_due is null or p_old_due >= (now() at time zone 'Asia/Manila')::date)
     and (p_assignee = public.my_person_id() or public.r2_can_manage_project_tasks(p_project_id));
$$;
grant execute on function public.r2_container_date_edit_ok(uuid, uuid, date) to authenticated;

do $$
declare
  d text := pg_get_functiondef('public.enforce_due_date_lock'::regproc);
  needle text := 'raise exception ''current_due_date can only be changed via an approved extension request''';
begin
  if position('r2_container_date_edit_ok' in d) > 0 then return; end if;
  if position(needle in d) = 0 then raise exception 'phase197: due-date lock text not found, nothing changed'; end if;
  d := replace(d, needle,
    'if not public.r2_container_date_edit_ok(NEW.project_id, OLD.assignee_id, OLD.current_due_date) then ' || needle || '; end if');
  -- Containers track no baseline: a new session can be due after the
  -- container's (locked) end date. Normal projects keep the check.
  d := replace(d, 'raise exception ''new task due date is beyond the project''''s locked timeline',
    'if not public.r2_is_open_container(NEW.project_id) then raise exception ''new task due date is beyond the project''''s locked timeline');
  d := replace(d, 'or set an earlier due date'';', 'or set an earlier due date''; end if;');
  execute d;
end $$;
