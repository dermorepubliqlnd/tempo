-- Phase 63 (2026-09-23, Sandra):
--
-- 1) "why are the reasons the same for project vs non-project
--    corrections -- is that relevant?" -- they weren't supposed to be.
--    The pending-entry self-service Edit flow (phase62) already branches
--    correctly: a project-task entry's editable field is reason_category
--    (Forgot to Start Timer / Worked Offline / etc -- "why was this
--    logged manually instead of the timer"), a non-project entry's is
--    activity_type_id (Meeting / Coaching / Training / Admin / Others --
--    "what was this time for", the thing that actually needed
--    correcting). Full Access's correct_time_entry (for an
--    already-decided entry) never got that same branch -- it always
--    showed/sent reason_category, even for a non-project row, and had no
--    way to fix a wrong Activity Type on an approved entry at all. Fixed
--    to match the same branch edit_pending_manual_time_entry already
--    uses.
--
-- 2) Admin soft-delete ("can be soft first and archived") for a
--    confirmed/approved time entry -- mirrors the reversible
--    is_archived/archived_at pattern already used by projects/tasks, not
--    a hard delete. Archived entries stay on record (trail, audit) but
--    drop out of every Spent Hrs / Scoped-vs-Logged / dashboard rollup,
--    exactly like a Cancelled task drops out of scheduling/variance
--    totals. Reversible via unarchive_time_entry.

drop function if exists correct_time_entry(uuid, numeric, text, text);

create or replace function correct_time_entry(
  p_entry_id uuid,
  p_duration_minutes numeric,
  p_notes text,
  p_reason_category text default null,
  p_activity_type_id uuid default null
) returns void
language plpgsql security definer as $$
declare
  v_status text;
  v_current_duration numeric;
  v_task_id uuid;
begin
  if my_access_level() <> 'full' then
    raise exception 'only Full Access can correct a finalized time entry';
  end if;

  select status, duration_minutes, task_id into v_status, v_current_duration, v_task_id
    from time_entries where id = p_entry_id;
  if v_status is null then
    raise exception 'time entry not found';
  end if;
  if v_status not in ('confirmed','approved') then
    raise exception 'only a confirmed or approved time entry can be corrected';
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'corrected duration must be greater than zero';
  end if;

  perform set_config('app.bypass_time_entry_lock', 'on', true);

  if v_task_id is not null then
    -- Project-task entry: reason category is the correctable field, same
    -- as before. Activity type doesn't apply.
    update time_entries
      set duration_minutes = p_duration_minutes,
          original_duration_minutes = coalesce(original_duration_minutes, v_current_duration),
          corrected_by = my_person_id(),
          corrected_at = now(),
          correction_notes = p_notes,
          reason_category = coalesce(p_reason_category, reason_category)
      where id = p_entry_id;
  else
    -- Non-project entry: activity type is the correctable field instead
    -- -- reason_category was never asked/shown at submission for these,
    -- so it stays untouched here too.
    if p_activity_type_id is not null and not exists (select 1 from non_project_activity_types where id = p_activity_type_id) then
      raise exception 'unknown activity type';
    end if;
    update time_entries
      set duration_minutes = p_duration_minutes,
          original_duration_minutes = coalesce(original_duration_minutes, v_current_duration),
          corrected_by = my_person_id(),
          corrected_at = now(),
          correction_notes = p_notes,
          activity_type_id = coalesce(p_activity_type_id, activity_type_id)
      where id = p_entry_id;
  end if;
end;
$$;

grant execute on function correct_time_entry(uuid, numeric, text, text, uuid) to authenticated;

-- --- Archive (soft-delete) for a confirmed/approved entry ---

alter table time_entries add column if not exists is_archived boolean not null default false;
alter table time_entries add column if not exists archived_at timestamptz;
alter table time_entries add column if not exists archived_by uuid references people(id);
alter table time_entries add column if not exists archive_reason text;

create or replace function archive_time_entry(p_entry_id uuid, p_reason text default null) returns void
language plpgsql security definer as $$
declare
  v_status text;
  v_is_archived boolean;
begin
  if my_access_level() <> 'full' then
    raise exception 'only Full Access can archive a finalized time entry';
  end if;

  select status, is_archived into v_status, v_is_archived from time_entries where id = p_entry_id;
  if v_status is null then
    raise exception 'time entry not found';
  end if;
  if v_status not in ('confirmed','approved') then
    raise exception 'only a confirmed or approved time entry can be archived';
  end if;
  if v_is_archived then
    raise exception 'this entry is already archived';
  end if;

  update time_entries
    set is_archived = true,
        archived_at = now(),
        archived_by = my_person_id(),
        archive_reason = p_reason
    where id = p_entry_id;
end;
$$;

grant execute on function archive_time_entry(uuid, text) to authenticated;

create or replace function unarchive_time_entry(p_entry_id uuid) returns void
language plpgsql security definer as $$
declare
  v_is_archived boolean;
begin
  if my_access_level() <> 'full' then
    raise exception 'only Full Access can restore an archived time entry';
  end if;

  select is_archived into v_is_archived from time_entries where id = p_entry_id;
  if v_is_archived is null then
    raise exception 'time entry not found';
  end if;
  if not v_is_archived then
    raise exception 'this entry is not archived';
  end if;

  update time_entries
    set is_archived = false,
        archived_at = null,
        archived_by = null,
        archive_reason = null
    where id = p_entry_id;
end;
$$;

grant execute on function unarchive_time_entry(uuid) to authenticated;
