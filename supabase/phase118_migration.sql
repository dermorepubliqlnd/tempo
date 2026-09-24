-- Phase 118 (2026-09-24): Paused projects, Resume and Schedule Review.
--   Pause   = temporary suspension of schedule monitoring (reason required).
--   Resume  = any exit from Paused back to an active status; sets a
--             Schedule Review Required flag (not a new status).
--   Review  = owner confirms the dates or updates them via the existing
--             extension requests (Re-baseline was retired 2026-08-27).
-- Pause never touches the baseline or any task/project dates. History is
-- written to project_notes as system notes.

-- 1. Columns -----------------------------------------------------------------
alter table projects add column if not exists paused_at timestamptz;          -- start of the current/last pause
alter table projects add column if not exists paused_by uuid references people(id);
alter table projects add column if not exists pause_reason text;
alter table projects add column if not exists pause_category text;
alter table projects add column if not exists pause_expected_resume date;
alter table projects add column if not exists pause_note text;
alter table projects add column if not exists resumed_at timestamptz;
alter table projects add column if not exists schedule_review_required boolean not null default false;

alter table project_notes add column if not exists note_type text not null default 'manual';
alter table project_notes drop constraint if exists project_notes_note_type_check;
alter table project_notes add constraint project_notes_note_type_check check (note_type in ('manual','system'));

-- People can only write manual notes; system notes come from the functions below.
drop policy if exists project_notes_insert on project_notes;
create policy project_notes_insert on project_notes for insert
  with check (can_see_project(project_id) and author_id = my_person_id() and note_type = 'manual');

-- 2. Helpers -----------------------------------------------------------------
create or replace function add_system_project_note(p_project_id uuid, p_author uuid, p_body text) returns void
language plpgsql security definer as $$
begin
  insert into project_notes (project_id, author_id, body, mentioned_person_ids, note_type)
  values (p_project_id, coalesce(p_author, (select owner_id from projects where id = p_project_id)), p_body, '{}', 'system');
end;
$$;
revoke all on function add_system_project_note(uuid, uuid, text) from public, anon, authenticated;

create or replace function can_manage_project_schedule(p_project_id uuid) returns boolean
language sql stable security definer as $$
  select my_access_level() = 'full'
      or exists (select 1 from projects where id = p_project_id and (owner_id = my_person_id() or is_approver_for(owner_id)));
$$;
grant execute on function can_manage_project_schedule(uuid) to authenticated;

-- 3. Pause (the only way into Paused) ------------------------------------------
create or replace function pause_project(
  p_project_id uuid,
  p_reason text,
  p_category text default null,
  p_expected_resume date default null,
  p_note text default null
) returns void
language plpgsql security definer as $$
declare
  v_p projects%rowtype;
  v_body text;
begin
  select * into v_p from projects where id = p_project_id;
  if not found then
    raise exception 'project not found';
  end if;
  if not (my_access_level() = 'full' or v_p.owner_id = my_person_id()) then
    raise exception 'only the project owner or Full Access can pause this project';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'a pause reason is required';
  end if;
  if v_p.status = 'Paused' then
    raise exception 'this project is already paused';
  end if;
  if v_p.status in ('Completed','Cancelled') or v_p.wbs_status in ('draft','closed') then
    raise exception 'only an active project can be paused';
  end if;

  perform set_config('app.pause_rpc', 'on', true);
  update projects set
    status = 'Paused',
    paused_at = now(),
    paused_by = my_person_id(),
    pause_reason = trim(p_reason),
    pause_category = nullif(trim(p_category), ''),
    pause_expected_resume = p_expected_resume,
    pause_note = nullif(trim(p_note), ''),
    resumed_at = null,
    schedule_review_required = false
  where id = p_project_id;
  perform set_config('app.pause_rpc', '', true);

  v_body := 'Project Paused' || E'\n' || 'Reason: ' || trim(p_reason)
    || coalesce(E'\n' || 'Category: ' || nullif(trim(p_category), ''), '')
    || coalesce(E'\n' || 'Expected resume: ' || to_char(p_expected_resume, 'Mon DD, YYYY'), '')
    || coalesce(E'\n' || 'Note: ' || nullif(trim(p_note), ''), '');
  perform add_system_project_note(p_project_id, my_person_id(), v_body);
end;
$$;
revoke all on function pause_project(uuid, text, text, date, text) from public, anon;
grant execute on function pause_project(uuid, text, text, date, text) to authenticated;

-- 4. Status trigger: guard the way in, handle the way out ---------------------
create or replace function handle_project_pause_status() returns trigger
language plpgsql security definer as $$
declare
  v_days int;
begin
  if NEW.status is not distinct from OLD.status then
    return NEW;
  end if;

  if NEW.status = 'Paused' then
    if coalesce(current_setting('app.pause_rpc', true), '') <> 'on' then
      raise exception 'use the Pause dialog to pause a project -- a pause reason is required';
    end if;
    return NEW;
  end if;

  if OLD.status = 'Paused' then
    v_days := greatest(0, (now()::date - coalesce(OLD.paused_at, now())::date));
    NEW.resumed_at := now();
    if NEW.status in ('In Progress','Not Started') then
      NEW.schedule_review_required := true;
      perform add_system_project_note(NEW.id, my_person_id(),
        'Project Resumed' || E'\n' || 'Project resumed after ' || v_days || ' day' || case when v_days = 1 then '' else 's' end
        || ' on pause.' || E'\n' || 'Schedule review required.');
    else
      NEW.schedule_review_required := false;
      perform add_system_project_note(NEW.id, my_person_id(),
        'Status Changed' || E'\n' || 'Project moved from Paused to ' || NEW.status || ' after ' || v_days || ' day'
        || case when v_days = 1 then '' else 's' end || ' on pause.');
    end if;
  elsif NEW.status in ('Completed','Cancelled') then
    -- Finishing or cancelling a project also ends any open schedule review.
    NEW.schedule_review_required := false;
  end if;
  return NEW;
end;
$$;
drop trigger if exists projects_pause_status on projects;
create trigger projects_pause_status
  before update of status on projects
  for each row execute function handle_project_pause_status();

-- 5. Resolve the schedule review ---------------------------------------------
create or replace function resolve_schedule_review(p_project_id uuid, p_outcome text, p_note text default null) returns void
language plpgsql security definer as $$
declare
  v_body text;
begin
  if not can_manage_project_schedule(p_project_id) then
    raise exception 'only the project owner, their Immediate Supervisor (or anyone above), or Full Access can confirm the schedule review';
  end if;
  if not exists (select 1 from projects where id = p_project_id and schedule_review_required) then
    raise exception 'this project has no pending schedule review';
  end if;
  if p_outcome not in ('no_change','schedule_updated') then
    raise exception 'unknown outcome';
  end if;
  update projects set schedule_review_required = false where id = p_project_id;
  v_body := 'Schedule Reviewed' || E'\n'
    || case when p_outcome = 'no_change'
            then 'Existing WBS dates remain valid. No schedule change required.'
            else 'Schedule updated following resumption (dates revised through extension requests).' end
    || coalesce(E'\n' || 'Note: ' || nullif(trim(p_note), ''), '');
  perform add_system_project_note(p_project_id, my_person_id(), v_body);
end;
$$;
revoke all on function resolve_schedule_review(uuid, text, text) from public, anon;
grant execute on function resolve_schedule_review(uuid, text, text) to authenticated;

-- 6. No time logging while Paused or until the schedule review is confirmed ---
create or replace function block_time_on_paused_projects() returns trigger
language plpgsql as $$
declare
  v_status text;
  v_review boolean;
begin
  if NEW.task_id is null or coalesce(current_setting('app.bypass_pause_time_block', true), '') = 'on' then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and NEW.task_id is not distinct from OLD.task_id then
    return NEW;   -- stopping a timer, corrections, approvals, archive/restore
  end if;
  select pr.status, pr.schedule_review_required into v_status, v_review
    from tasks t join projects pr on pr.id = t.project_id where t.id = NEW.task_id;
  if v_status = 'Paused' then
    raise exception 'this project is paused -- time can''t be logged on it until it resumes';
  end if;
  if coalesce(v_review, false) then
    raise exception 'this project was just resumed and its schedule review isn''t confirmed yet -- ask the project owner to review the WBS first';
  end if;
  return NEW;
end;
$$;
drop trigger if exists time_entries_block_paused on time_entries;
create trigger time_entries_block_paused
  before insert or update of task_id on time_entries
  for each row execute function block_time_on_paused_projects();

-- 7. Backfill the two projects already Paused (Sandra: pause date = Mon Sep 14, 2026)
update projects set
  paused_at = timestamptz '2026-09-14 00:00:00+08',
  paused_by = owner_id,
  pause_reason = coalesce(pause_reason, 'Paused before pause tracking was added')
where status = 'Paused' and paused_at is null and not is_archived;

insert into project_notes (project_id, author_id, body, mentioned_person_ids, note_type)
select id, owner_id, 'Project Paused' || E'\n' || 'Reason: Paused before pause tracking was added. Pause date set to Sep 14, 2026.', '{}', 'system'
  from projects p
 where status = 'Paused' and not is_archived and owner_id is not null
   and not exists (select 1 from project_notes n where n.project_id = p.id and n.note_type = 'system' and n.body like 'Project Paused%');

select 'P-' || lpad(project_number::text, 4, '0') as project_id, name, paused_at from projects where status = 'Paused' and not is_archived;
