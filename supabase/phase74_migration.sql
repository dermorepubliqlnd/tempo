-- Phase 74 (2026-09-23, Sandra: "what happens if it's rejected -- have
-- the same action as pending, they can either delete or update") --
-- extends phase62's self-service edit/delete for a still-pending manual
-- entry to also cover a Rejected one. Editing a Rejected entry resubmits
-- it: status flips back to 'pending_approval' and the old decision stamp
-- (decided_by/decided_at/decision_notes) is cleared, so it re-enters the
-- Approval Center queue for a fresh look rather than sitting there
-- corrected-but-still-labeled-Rejected forever. Deleting a Rejected entry
-- just removes it, same as deleting a Pending one.

create or replace function edit_pending_manual_time_entry(
  p_entry_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_reason_category text default null,
  p_notes text default null,
  p_activity_type_id uuid default null
) returns void
language plpgsql security definer as $$
declare
  v_source text;
  v_status text;
  v_person uuid;
  v_requested_by uuid;
  v_task_id uuid;
  v_activity_type_id uuid;
begin
  select source, status, person_id, requested_by, task_id, activity_type_id
    into v_source, v_status, v_person, v_requested_by, v_task_id, v_activity_type_id
    from time_entries where id = p_entry_id;

  if v_person is null then
    raise exception 'time entry not found';
  end if;
  if v_source <> 'manual' or v_status not in ('pending_approval', 'rejected') then
    raise exception 'only a still-pending or rejected manual entry can be edited -- once it''s approved, only a correction can change it';
  end if;
  if not (v_person = my_person_id() or v_requested_by = my_person_id() or my_access_level() = 'full') then
    raise exception 'not authorized to edit this time entry';
  end if;
  if p_ended_at <= p_started_at then
    raise exception 'end time must be after start time';
  end if;

  if v_task_id is not null then
    -- Project-task entry: reason category is the editable field, no
    -- activity type to touch.
    update time_entries
      set started_at = p_started_at,
          ended_at = p_ended_at,
          duration_minutes = round(extract(epoch from (p_ended_at - p_started_at)) / 60.0),
          reason_category = coalesce(p_reason_category, reason_category),
          reason_notes = coalesce(p_notes, reason_notes),
          status = 'pending_approval',
          decided_by = null,
          decided_at = null,
          decision_notes = null
      where id = p_entry_id;
  else
    -- Non-project entry: activity type is the editable field instead.
    if p_activity_type_id is not null and not exists (select 1 from non_project_activity_types where id = p_activity_type_id) then
      raise exception 'unknown activity type';
    end if;
    update time_entries
      set started_at = p_started_at,
          ended_at = p_ended_at,
          duration_minutes = round(extract(epoch from (p_ended_at - p_started_at)) / 60.0),
          activity_type_id = coalesce(p_activity_type_id, activity_type_id),
          reason_notes = coalesce(p_notes, reason_notes),
          status = 'pending_approval',
          decided_by = null,
          decided_at = null,
          decision_notes = null
      where id = p_entry_id;
  end if;
end;
$$;

grant execute on function edit_pending_manual_time_entry(uuid, timestamptz, timestamptz, text, text, uuid) to authenticated;

create or replace function delete_pending_manual_time_entry(p_entry_id uuid) returns void
language plpgsql security definer as $$
declare
  v_source text;
  v_status text;
  v_person uuid;
  v_requested_by uuid;
begin
  select source, status, person_id, requested_by
    into v_source, v_status, v_person, v_requested_by
    from time_entries where id = p_entry_id;

  if v_person is null then
    raise exception 'time entry not found';
  end if;
  if v_source <> 'manual' or v_status not in ('pending_approval', 'rejected') then
    raise exception 'only a still-pending or rejected manual entry can be deleted -- once it''s approved, it stays on record';
  end if;
  if not (v_person = my_person_id() or v_requested_by = my_person_id() or my_access_level() = 'full') then
    raise exception 'not authorized to delete this time entry';
  end if;

  delete from time_entries where id = p_entry_id;
end;
$$;

grant execute on function delete_pending_manual_time_entry(uuid) to authenticated;
