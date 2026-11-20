-- phase238 dry run: run right after the phase238 statements in ONE batch; the final raise rolls everything back.
do $x$
declare nikki uuid; nikki_auth uuid; princess uuid; gem uuid; inactive_p uuid; p95 uuid; t_hb uuid; t_own uuid; t_norm uuid; n int; out text := '';
begin
  select id, auth_user_id into nikki, nikki_auth from people where name ilike 'Nikki%' and is_active;
  select id into princess from people where name ilike 'Princess%';
  select id into gem from people where name ilike 'Gemmabelle%';
  select id into inactive_p from people where not is_active limit 1;
  select id into p95 from projects where project_number = 95;
  select id into t_hb from tasks where project_id = p95 and name = 'Handbook revisions';
  select id into t_own from tasks where project_id = p95 and assignee_id = nikki and not coalesce(is_archived,false) limit 1;
  select t.id into t_norm from tasks t join projects p on p.id = t.project_id left join people o on o.id = p.owner_id
    where not coalesce(p.is_operational,false) and coalesce(p.wbs_status,'') not in ('closed') and t.assignee_id <> nikki
      and p.owner_id <> nikki and coalesce(o.reports_to,'00000000-0000-0000-0000-000000000000'::uuid) <> nikki and not coalesce(t.is_archived,false) limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', nikki_auth, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', nikki_auth::text, true);
  set local role authenticated;
  begin update tasks set assignee_id = princess where id = t_hb; get diagnostics n = row_count; out := out || ' T1 Gemma task -> Princess rows=' || n;
  exception when others then out := out || ' T1 ERROR ' || sqlerrm; end;
  begin update tasks set name = name || ' x' where id = t_hb; get diagnostics n = row_count; out := out || ' | T2 rename other''s task rows=' || n;
  exception when others then out := out || ' | T2 rename blocked'; end;
  begin update tasks set assignee_id = gem where id = t_own; get diagnostics n = row_count; out := out || ' | T3 own -> Gemma rows=' || n;
  exception when others then out := out || ' | T3 ERROR ' || sqlerrm; end;
  if inactive_p is not null then
  begin update tasks set assignee_id = inactive_p where id = t_hb; get diagnostics n = row_count; out := out || ' | T4 -> inactive rows=' || n;
  exception when others then out := out || ' | T4 inactive blocked'; end; end if;
  begin update tasks set assignee_id = princess where id = t_norm; get diagnostics n = row_count; out := out || ' | T5 normal project rows=' || n || ' (0 = blocked)';
  exception when others then out := out || ' | T5 normal project blocked'; end;
  raise exception 'VERIFY DRYRUN%', out;
end $x$;
