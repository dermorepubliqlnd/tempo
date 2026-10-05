-- phase149 (2026-10-05, Sandra): Operational projects.
-- A Project Type can be flagged Operational (e.g. Training Delivery). Every
-- project of that type is an open, cumulative container (one per quarter):
--   * trainers add their own session tasks after Start Project (add_session_task)
--   * sessions can be rescheduled without an extension request (reschedule_session)
--   * the app shows Health "Ongoing" / WBS Status "Ongoing" -- no baseline variance
--   * Task Completion Validation is UNCHANGED.

alter table project_types add column if not exists is_operational boolean not null default false;
alter table projects      add column if not exists is_operational boolean not null default false;

-- projects.is_operational always mirrors its Project Type (can't be set by hand).
create or replace function sync_project_is_operational() returns trigger
language plpgsql as $$
begin
  NEW.is_operational := coalesce((select pt.is_operational from project_types pt where pt.id = NEW.project_type_id), false);
  return NEW;
end $$;

drop trigger if exists projects_sync_is_operational on projects;
create trigger projects_sync_is_operational
  before insert or update on projects
  for each row execute function sync_project_is_operational();

create or replace function propagate_project_type_operational() returns trigger
language plpgsql security definer as $$
begin
  if NEW.is_operational is distinct from OLD.is_operational then
    update projects set is_operational = NEW.is_operational where project_type_id = NEW.id;
  end if;
  return NEW;
end $$;

drop trigger if exists project_types_propagate_operational on project_types;
create trigger project_types_propagate_operational
  after update of is_operational on project_types
  for each row execute function propagate_project_type_operational();

-- Sandra's decision: Training Delivery is operational.
update project_types set is_operational = true where name = 'Training Delivery';
update projects p set is_operational = coalesce(pt.is_operational, false)
  from project_types pt where pt.id = p.project_type_id and p.is_operational is distinct from coalesce(pt.is_operational, false);

-- ---------------------------------------------------------------------
-- add_session_task: anyone can add a session for THEMSELVES on a started,
-- open operational project; owner / Full Access can add for anyone (and
-- on a Draft one). Work Type = Training Delivery, Output Type = Session,
-- Output Count = 1, start/end pinned to the session date.
create or replace function add_session_task(
  p_project_id uuid, p_name text, p_date date, p_hours numeric, p_assignee uuid default null
) returns uuid
language plpgsql security definer as $$
declare
  v_me uuid := my_person_id();
  v_assignee uuid := coalesce(p_assignee, my_person_id());
  v_p projects%rowtype;
  v_manager boolean;
  v_id uuid;
begin
  if v_me is null then raise exception 'not signed in'; end if;
  select * into v_p from projects where id = p_project_id and not is_archived;
  if v_p.id is null then raise exception 'Project not found.'; end if;
  if not v_p.is_operational then raise exception 'Sessions can only be added to operational projects (e.g. Training Delivery).'; end if;
  if v_p.wbs_status = 'closed' or coalesce(v_p.status, '') in ('Completed', 'Cancelled') then
    raise exception 'This project is completed or closed -- add the session to the current quarter''s project.';
  end if;
  v_manager := coalesce(my_access_level() = 'full', false) or v_p.owner_id = v_me;
  if not v_manager then
    if v_assignee <> v_me then raise exception 'You can only add sessions for yourself.'; end if;
    if coalesce(v_p.wbs_status, 'draft') = 'draft' then
      raise exception 'This project hasn''t been started yet -- ask the project owner to Start Project first.';
    end if;
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Session name is required.'; end if;
  if p_date is null then raise exception 'Session date is required.'; end if;
  if p_hours is null or p_hours <= 0 or p_hours > 12 then raise exception 'Session hours must be more than 0 and at most 12.'; end if;
  if not exists (select 1 from people where id = v_assignee and is_active) then raise exception 'Assignee is not an active user.'; end if;

  perform set_config('app.bypass_due_date_lock', 'on', true);
  insert into tasks (
    project_id, name, status, assignee_id,
    start_date, start_date_full, start_date_standard, start_full_auto, start_standard_auto, manual_end_date,
    original_due_date, current_due_date, estimated_hours,
    work_type_id, output_type_id, output_count, sort_order, created_by
  ) values (
    p_project_id, btrim(p_name), 'Not Started', v_assignee,
    p_date, p_date, p_date, false, false, p_date,
    p_date, p_date, p_hours,
    (select id from work_types where name = 'Training Delivery' order by is_active desc limit 1),
    (select id from output_types where name = 'Session' order by is_active desc limit 1),
    1, extract(epoch from clock_timestamp()) * 1000, v_me
  ) returning id into v_id;
  perform set_config('app.bypass_due_date_lock', 'off', true);
  return v_id;
end $$;

grant execute on function add_session_task(uuid, text, date, numeric, uuid) to authenticated;

-- reschedule_session: move a not-yet-done session on an operational
-- project. Not an extension (no approval, no Days Extended).
create or replace function reschedule_session(p_task_id uuid, p_date date)
returns void
language plpgsql security definer as $$
declare
  v_me uuid := my_person_id();
  v_t tasks%rowtype;
  v_p projects%rowtype;
begin
  select * into v_t from tasks where id = p_task_id and not is_archived;
  if v_t.id is null then raise exception 'Task not found.'; end if;
  select * into v_p from projects where id = v_t.project_id;
  if not v_p.is_operational then raise exception 'Only sessions on operational projects can be rescheduled this way -- request an extension instead.'; end if;
  if v_p.wbs_status = 'closed' then raise exception 'This project is closed.'; end if;
  if v_t.status in ('Done', 'Cancelled') then raise exception 'Done or cancelled sessions can''t be rescheduled.'; end if;
  if exists (select 1 from tasks c where c.parent_task_id = v_t.id and not c.is_archived) then
    raise exception 'Reschedule the individual sessions under this task instead.';
  end if;
  if not (coalesce(my_access_level() = 'full', false) or v_p.owner_id = v_me or v_t.assignee_id = v_me) then
    raise exception 'Only the assignee, the project owner or Full Access can reschedule this session.';
  end if;
  if p_date is null then raise exception 'New date is required.'; end if;

  perform set_config('app.bypass_due_date_lock', 'on', true);
  perform set_config('app.bypass_start_date_lock', 'on', true);
  update tasks set
    start_date = p_date, start_date_full = p_date, start_date_standard = p_date,
    start_full_auto = false, start_standard_auto = false, manual_end_date = p_date,
    original_due_date = p_date, current_due_date = p_date
  where id = p_task_id;
  perform set_config('app.bypass_due_date_lock', 'off', true);
  perform set_config('app.bypass_start_date_lock', 'off', true);
end $$;

grant execute on function reschedule_session(uuid, date) to authenticated;

select 'phase149' t,
  (select count(*) from projects where is_operational) operational_projects,
  (select string_agg(name, ', ') from project_types where is_operational) operational_types;
