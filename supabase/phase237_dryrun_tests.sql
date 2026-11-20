-- phase237 dry run: applied in ONE transaction with the tests; the final raise rolls everything back.
do $$
declare nikki uuid; nikki_auth uuid; gem uuid; inactive_p uuid; p95 uuid; p_normal uuid; d date := (now() at time zone 'Asia/Manila')::date; out text := '';
begin
  select id, auth_user_id into nikki, nikki_auth from people where name ilike 'Nikki%' and is_active;
  select id into gem from people where name ilike 'Gemmabelle%';
  select id into inactive_p from people where not is_active limit 1;
  select id into p95 from projects where project_number = 95;
  select p.id into p_normal from projects p left join people o on o.id = p.owner_id
    where not coalesce(p.is_operational,false) and coalesce(p.wbs_status,'') not in ('closed','draft') and p.owner_id <> nikki and coalesce(o.reports_to, '00000000-0000-0000-0000-000000000000'::uuid) <> nikki limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', nikki_auth, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', nikki_auth::text, true);
  set local role authenticated;
  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p95, 'DRYRUN for Gemma', gem, 'Not Started', d, d, d); out := out || ' T1 P95 Nikki->Gemma: OK';
  exception when others then out := out || ' T1 P95 Nikki->Gemma: ERROR ' || sqlerrm; end;
  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p95, 'DRYRUN own', nikki, 'Not Started', d, d, d); out := out || ' | T2 P95 own: OK';
  exception when others then out := out || ' | T2 P95 own: ERROR ' || sqlerrm; end;
  if inactive_p is not null then
  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p95, 'DRYRUN inactive', inactive_p, 'Not Started', d, d, d); out := out || ' | T3 P95 inactive person: OK (unexpected)';
  exception when others then out := out || ' | T3 P95 inactive person: blocked'; end; end if;
  begin insert into tasks (project_id, name, assignee_id, status, start_date, original_due_date, current_due_date) values (p_normal, 'DRYRUN normal', gem, 'Not Started', d, d, d); out := out || ' | T4 normal project Nikki->Gemma: OK (unexpected)';
  exception when others then out := out || ' | T4 normal project: blocked'; end;
  begin update tasks set assignee_id = nikki where project_id = p95 and name = 'Handbook revisions'; out := out || ' | T5 reassign rows=' || (select count(*) from tasks where project_id=p95 and name='Handbook revisions' and assignee_id=nikki);
  exception when others then out := out || ' | T5 reassign: blocked'; end;
  raise exception 'VERIFY DRYRUN%', out;
end $$;
