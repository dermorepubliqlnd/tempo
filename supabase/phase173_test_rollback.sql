-- phase173 dry run: run AFTER phase173_time_entry_guard.sql (same request is fine).
-- Everything is rolled back by the final RAISE; the results are in its message.
-- Uses direct inserts/updates as the SQL-editor role (no RPCs), on 2020-01-06
-- (a Monday far in the past, so no real entries collide).
-- Expected: T1 future=ERR, T2 end<=start=ERR, T3 ok=OK, T4 overlap=ERR naming T3,
-- T5 edit into overlap=ERR, T6 timer confirm (seconds only)=OK,
-- T7 timer confirm edited into overlap=ERR, T8 timer confirm edited to future=ERR,
-- T9 manual on Done task=ERR "This task is Done...", T10 follow-up on Done task=OK
-- (or another trigger's message, e.g. baseline lock), T11 archive of a
-- pending entry=OK, T12 gate off (no preview header)=future insert OK
-- unless auto_approvals_live is already true.
do $$
declare
  out text := '';
  v_person uuid := (select id from people where is_active order by name limit 1);
  v_act uuid := (select id from non_project_activity_types where is_active order by sort_order limit 1);
  v_a uuid; v_c uuid; v_t uuid; v_t2 uuid;
  v_done uuid; v_done_person uuid;
  d timestamptz := '2020-01-06 00:00+08';
begin
  perform set_config('request.headers', '{"x-tempo-channel":"preview"}', true);
  perform set_config('app.bypass_time_entry_lock', 'on', true);
  out := out || ' | gate=' || public.auto_approvals_enabled();

  -- T1 future end
  begin
    insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes)
    values (v_person, v_act, now() - interval '10 minutes', now() + interval '30 minutes', 40, 'manual', 'pending_approval', v_person, 'phase173 test');
    out := out || ' | T1 future: OK (unexpected)';
  exception when others then out := out || ' | T1 future: ERR ' || sqlerrm; end;

  -- T2 end <= start
  begin
    insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes)
    values (v_person, v_act, d + interval '10 hours', d + interval '9 hours', 1, 'manual', 'pending_approval', v_person, 'phase173 test');
    out := out || ' | T2 end<=start: OK (unexpected)';
  exception when others then out := out || ' | T2 end<=start: ERR ' || sqlerrm; end;

  -- T3 valid entry 09:00-10:00
  begin
    insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes)
    values (v_person, v_act, d + interval '9 hours', d + interval '10 hours', 60, 'manual', 'pending_approval', v_person, 'phase173 test')
    returning id into v_a;
    out := out || ' | T3 valid: OK';
  exception when others then out := out || ' | T3 valid: ERR ' || sqlerrm; end;

  -- T4 overlap 09:30-10:30
  begin
    insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes)
    values (v_person, v_act, d + interval '9 hours 30 minutes', d + interval '10 hours 30 minutes', 60, 'manual', 'pending_approval', v_person, 'phase173 test');
    out := out || ' | T4 overlap: OK (unexpected)';
  exception when others then out := out || ' | T4 overlap: ERR ' || sqlerrm; end;

  -- T5 edit a pending entry into an overlap (11:00-12:00 -> 09:30-11:00)
  begin
    insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes)
    values (v_person, v_act, d + interval '11 hours', d + interval '12 hours', 60, 'manual', 'pending_approval', v_person, 'phase173 test')
    returning id into v_c;
    update time_entries set started_at = d + interval '9 hours 30 minutes', ended_at = d + interval '11 hours' where id = v_c;
    out := out || ' | T5 edit overlap: OK (unexpected)';
  exception when others then out := out || ' | T5 edit overlap: ERR ' || sqlerrm; end;

  -- T6 timer confirm, only seconds trimmed (13:00:20-13:30:40 -> 13:00-13:30)
  begin
    insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, reason_notes)
    values (v_person, v_act, d + interval '13 hours 20 seconds', d + interval '13 hours 30 minutes 40 seconds', 30, 'timer', 'pending_confirm', 'phase173 test')
    returning id into v_t;
    update time_entries set status = 'confirmed', started_at = d + interval '13 hours', ended_at = d + interval '13 hours 30 minutes' where id = v_t;
    out := out || ' | T6 timer confirm (seconds only): OK';
  exception when others then out := out || ' | T6 timer confirm (seconds only): ERR ' || sqlerrm; end;

  -- T7 timer confirm edited into the 09:00-10:00 entry (14:00-14:30 -> 09:45-14:30)
  insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, reason_notes)
  values (v_person, v_act, d + interval '14 hours', d + interval '14 hours 30 minutes', 30, 'timer', 'pending_confirm', 'phase173 test')
  returning id into v_t2;
  begin
    update time_entries set status = 'confirmed', started_at = d + interval '9 hours 45 minutes' where id = v_t2;
    out := out || ' | T7 timer confirm overlap: OK (unexpected)';
  exception when others then out := out || ' | T7 timer confirm overlap: ERR ' || sqlerrm; end;

  -- T8 timer confirm edited to end in the future
  begin
    update time_entries set status = 'confirmed', ended_at = now() + interval '1 hour' where id = v_t2;
    out := out || ' | T8 timer confirm future: OK (unexpected)';
  exception when others then out := out || ' | T8 timer confirm future: ERR ' || sqlerrm; end;

  -- T9 / T10 Done task (started, not closed project)
  select t.id, t.assignee_id into v_done, v_done_person
    from tasks t join projects p on p.id = t.project_id
   where t.status = 'Done' and not t.is_archived and t.assignee_id is not null
     and p.timelines_locked and p.wbs_status <> 'closed'
   limit 1;
  if v_done is null then
    out := out || ' | T9/T10: skipped (no Done task found)';
  else
    begin
      insert into time_entries (task_id, person_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_category)
      values (v_done, v_done_person, d + interval '16 hours', d + interval '17 hours', 60, 'manual', 'pending_approval', v_done_person, 'Other');
      out := out || ' | T9 manual on Done task: OK (unexpected)';
    exception when others then out := out || ' | T9 manual on Done task: ERR ' || sqlerrm; end;
    begin
      insert into time_entries (task_id, person_id, started_at, ended_at, duration_minutes, source, status, requested_by, is_follow_up, follow_up_reason)
      values (v_done, v_done_person, d + interval '16 hours', d + interval '17 hours', 60, 'manual', 'pending_approval', v_done_person, true, 'scope_change');
      out := out || ' | T10 follow-up on Done task: OK';
    exception when others then out := out || ' | T10 follow-up on Done task: ERR ' || sqlerrm; end;
  end if;

  -- T11 archive a pending manual entry (must pass through)
  begin
    update time_entries set is_archived = true, archived_at = now() where id = v_a;
    out := out || ' | T11 archive: OK';
  exception when others then out := out || ' | T11 archive: ERR ' || sqlerrm; end;

  -- T12 gate off: no preview header -> guard does nothing (unless live flag is on)
  perform set_config('request.headers', '{}', true);
  out := out || ' | gate now=' || public.auto_approvals_enabled();
  begin
    insert into time_entries (person_id, activity_type_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes)
    values (v_person, v_act, now() - interval '10 minutes', now() + interval '30 minutes', 40, 'manual', 'pending_approval', v_person, 'phase173 test');
    out := out || ' | T12 gate off, future: OK (guard skipped)';
  exception when others then out := out || ' | T12 gate off: ERR ' || sqlerrm; end;

  raise exception 'PHASE173 TEST (rolled back)%', out;
end $$;
