-- phase157 (2026-10-06): Draft = Planning. Until a project is started
-- (wbs_status leaves 'draft' via Start Project), its WBS/tasks are visible
-- only to the Project Owner, anyone above the Owner in the reporting line,
-- and Full Access. Contributors/collaborators/peers don't see Draft tasks.
-- Staged behind a switch:
--   * enforced for requests from the preview build (header x-tempo-channel: preview)
--   * enforced for everyone once app_settings.draft_task_privacy = true (go-live)
-- Revert = set the flag false (or drop the *_draft_privacy policies).

alter table public.app_settings add column if not exists draft_task_privacy boolean not null default false;

create or replace function public.draft_privacy_enforced() returns boolean
language sql stable set search_path = public as $$
  select coalesce((select draft_task_privacy from public.app_settings limit 1), false)
      or coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-tempo-channel', '') = 'preview'
$$;

create or replace function public.can_see_project_plan(p_project_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_status text;
  v_owner uuid;
  v_me uuid;
begin
  if p_project_id is null then return true; end if;
  if not public.draft_privacy_enforced() then return true; end if;
  select coalesce(wbs_status, 'draft'), owner_id into v_status, v_owner from public.projects where id = p_project_id;
  if not found or v_status <> 'draft' then return true; end if;
  v_me := public.my_person_id();
  if v_me is null then return false; end if;
  if v_owner = v_me then return true; end if;
  if coalesce(public.my_access_level() = 'full', false) then return true; end if;
  return public.is_approver_for(v_owner);  -- Owner's supervisor and everyone above
end;
$$;

create or replace function public.can_see_task_plan(p_task_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_see_project_plan((select project_id from public.tasks where id = p_task_id))
$$;

grant execute on function public.draft_privacy_enforced() to authenticated;
grant execute on function public.can_see_project_plan(uuid) to authenticated;
grant execute on function public.can_see_task_plan(uuid) to authenticated;

-- RESTRICTIVE policies AND with the existing permissive ones.
drop policy if exists tasks_draft_privacy on public.tasks;
create policy tasks_draft_privacy on public.tasks as restrictive for select to authenticated using (public.can_see_project_plan(project_id));
drop policy if exists tasks_draft_privacy_upd on public.tasks;
create policy tasks_draft_privacy_upd on public.tasks as restrictive for update to authenticated using (public.can_see_project_plan(project_id));

drop policy if exists task_collaborators_draft_privacy on public.task_collaborators;
create policy task_collaborators_draft_privacy on public.task_collaborators as restrictive for select to authenticated using (public.can_see_task_plan(task_id));
drop policy if exists task_dependencies_draft_privacy on public.task_dependencies;
create policy task_dependencies_draft_privacy on public.task_dependencies as restrictive for select to authenticated using (public.can_see_task_plan(task_id));
drop policy if exists task_assignee_history_draft_privacy on public.task_assignee_history;
create policy task_assignee_history_draft_privacy on public.task_assignee_history as restrictive for select to authenticated using (public.can_see_task_plan(task_id));
drop policy if exists task_effort_changes_draft_privacy on public.task_effort_changes;
create policy task_effort_changes_draft_privacy on public.task_effort_changes as restrictive for select to authenticated using (public.can_see_task_plan(task_id));
drop policy if exists task_planning_snapshots_draft_privacy on public.task_planning_snapshots;
create policy task_planning_snapshots_draft_privacy on public.task_planning_snapshots as restrictive for select to authenticated using (public.can_see_task_plan(task_id));
drop policy if exists project_plan_versions_draft_privacy on public.project_plan_versions;
create policy project_plan_versions_draft_privacy on public.project_plan_versions as restrictive for select to authenticated using (public.can_see_project_plan(project_id));
drop policy if exists project_notes_draft_privacy on public.project_notes;
create policy project_notes_draft_privacy on public.project_notes as restrictive for select to authenticated using (task_id is null or public.can_see_task_plan(task_id));
-- time_entries: own entries always visible; others' entries on a Draft task
-- stay visible only through the existing approver/Full clauses.
