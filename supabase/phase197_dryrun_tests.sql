-- phase197 dry-run tests: appended after phase197 in ONE transaction; the final
-- raise rolls back phase197 and every test change. Nothing is saved.
do $$
declare
  fritzie uuid; fritzie_auth uuid; khim uuid; khim_auth uuid; rhen uuid;
  p79 uuid; p94 uuid;
  t_own uuid; t_own_past uuid; t_rhen uuid; t_94 uuid;
  n int; out text := ''; d date := (now() at time zone 'Asia/Manila')::date;
  procedure_name text;
begin
  select id, auth_user_id into fritzie, fritzie_auth from people where name ilike 'Fritzie%';
  select id, auth_user_id into khim, khim_auth from people where name ilike 'Khim%';
  select id into rhen from people where name ilike 'Rhenmart%';
  select id into p79 from projects where project_number = 79;
  select id into p94 from projects where project_number = 94;
  select id into t_own from tasks where project_id = p79 and assignee_id = fritzie and status <> 'Done' and not coalesce(is_archived,false) and current_due_date >= d order by current_due_date limit 1;
  select id into t_own_past from tasks where project_id = p79 and assignee_id = fritzie and status <> 'Done' and not coalesce(is_archived,false) and current_due_date < d limit 1;
  select id into t_rhen from tasks where project_id = p79 and assignee_id = rhen and not coalesce(is_archived,false) limit 1;
  select id into t_94 from tasks where project_id = p94 and assignee_id = fritzie and status <> 'Done' and not coalesce(is_archived,false) limit 1;

  -- act as Fritzie (Limited, not owner of P-0079 or P-0094)
  perform set_config('request.jwt.claims', json_build_object('sub', fritzie_auth, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', fritzie_auth::text, true);
  set local role authenticated;

  begin update tasks set start_date = d + 2, current_due_date = d + 2 where id = t_own; get diagnostics n = row_count; out := out || E'\nT1 P79 own dates (future due): rows=' || n;
  exception when others then out := out || E'\nT1 P79 own dates: ERROR ' || sqlerrm; end;

  begin update tasks set status = 'In Progress' where id = t_own; get diagnostics n = row_count; out := out || E'\nT2 P79 own status: rows=' || n;
  exception when others then out := out || E'\nT2 P79 own status: ERROR ' || sqlerrm; end;

  begin update tasks set name = name || ' x' where id = t_rhen; get diagnostics n = row_count; out := out || E'\nT3 P79 Rhenmart task: rows=' || n || ' (0 = blocked)';
  exception when others then out := out || E'\nT3 P79 Rhenmart task: ERROR ' || sqlerrm; end;

  if t_own_past is not null then
    begin update tasks set current_due_date = d + 3 where id = t_own_past; get diagnostics n = row_count; out := out || E'\nT4 P79 own past-due date: rows=' || n;
    exception when others then out := out || E'\nT4 P79 own past-due date: ERROR ' || sqlerrm; end;
  else out := out || E'\nT4 skipped: no past-due open task for Fritzie in P79'; end if;

  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p79, 'DRYRUN own session', fritzie, 'Not Started', d + 1, d + 1, d + 1); out := out || E'\nT5 P79 add own task: OK';
  exception when others then out := out || E'\nT5 P79 add own task: ERROR ' || sqlerrm; end;

  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p79, 'DRYRUN for Rhenmart', rhen, 'Not Started', d + 1, d + 1, d + 1); out := out || E'\nT6 P79 add task for Rhenmart: OK (unexpected)';
  exception when others then out := out || E'\nT6 P79 add task for Rhenmart: blocked (' || sqlerrm || ')'; end;

  begin update tasks set estimated_hours = coalesce(estimated_hours,0) + 1 where id = t_94; get diagnostics n = row_count; out := out || E'\nT7 P94 own task hours (plan): rows=' || n || ' (should be blocked)';
  exception when others then out := out || E'\nT7 P94 own task hours: blocked (' || sqlerrm || ')'; end;

  begin update tasks set name = name || ' x' where id = t_94; get diagnostics n = row_count; out := out || E'\nT7b P94 own task name (plan): rows=' || n || ' (should be blocked)';
  exception when others then out := out || E'\nT7b P94 own task name: blocked (' || sqlerrm || ')'; end;

  begin update tasks set output_count = coalesce(output_count, 0) where id = t_94; get diagnostics n = row_count; out := out || E'\nT8 P94 own task execution field: rows=' || n;
  exception when others then out := out || E'\nT8 P94 own task execution field: ERROR ' || sqlerrm; end;

  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p94, 'DRYRUN normal', fritzie, 'Not Started', d, d, d); out := out || E'\nT9 P94 add task: OK (unexpected)';
  exception when others then out := out || E'\nT9 P94 add task: blocked (' || sqlerrm || ')'; end;

  -- act as Khim (Limited, owner of P-0094)
  perform set_config('request.jwt.claims', json_build_object('sub', khim_auth, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', khim_auth::text, true);
  begin update tasks set name = name || ' y' where id = t_94; get diagnostics n = row_count; out := out || E'\nT10 P94 owner edits plan: rows=' || n;
  exception when others then out := out || E'\nT10 P94 owner edits plan: ERROR ' || sqlerrm; end;
  begin update tasks set name = name || ' y' where id = t_rhen; get diagnostics n = row_count; out := out || E'\nT11 Khim edits Rhenmart task in P79: rows=' || n || ' (0 = blocked)';
  exception when others then out := out || E'\nT11 Khim edits Rhenmart task in P79: ERROR ' || sqlerrm; end;

  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p94, 'DRYRUN owner add', khim, 'Not Started', d, d, d); out := out || E'\nT12 P94 owner adds task: OK';
  exception when others then out := out || E'\nT12 P94 owner adds task: ERROR ' || sqlerrm; end;
  out := out || E'\nLOCK FN: ' || (select case when position('r2_is_open_container' in pg_get_functiondef('public.enforce_due_date_lock'::regproc)) > 0 then 'patched' else 'NOT patched' end);
  raise exception 'DRYRUN (rolled back) %', out;
end $$;
