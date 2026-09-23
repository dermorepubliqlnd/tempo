-- Phase 65 (2026-09-23, Sandra, live bug report): "Couldn't archive this
-- entry: this time entry is finalized -- use a correction instead of
-- editing it directly."
--
-- Root cause: enforce_time_entry_lock() blocks ANY update to a
-- confirmed/approved/rejected row unless the session config
-- app.bypass_time_entry_lock is set to 'on' first (correct_time_entry
-- already does this). archive_time_entry/unarchive_time_entry (phase63)
-- never set that flag before their own UPDATE, so the lock trigger fired
-- and rejected every archive/restore attempt. Fixed by adding the same
-- `perform set_config('app.bypass_time_entry_lock', 'on', true);` call
-- correct_time_entry already uses.

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

  perform set_config('app.bypass_time_entry_lock', 'on', true);
  update time_entries
    set is_archived = true,
        archived_at = now(),
        archived_by = my_person_id(),
        archive_reason = p_reason
    where id = p_entry_id;
end;
$$;

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

  perform set_config('app.bypass_time_entry_lock', 'on', true);
  update time_entries
    set is_archived = false,
        archived_at = null,
        archived_by = null,
        archive_reason = null
    where id = p_entry_id;
end;
$$;
