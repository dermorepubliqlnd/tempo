-- phase169 dry run: run AFTER phase169_migration.sql in the SAME request.
-- Everything is rolled back by the final RAISE.
do $$
declare
  out text := '';
  v_sandra_auth uuid := (select auth_user_id from people where email = 'sbarlao@dermorepubliq.com');
  v_member_auth uuid := 'a59dc1b6-9051-48bd-b908-59b91ace2eca';
  v_t513 uuid := '2a46b077-e07c-4a26-b2ed-551ec8f254e5';
  v_t499 uuid := 'cd683a87-314a-4617-b6c3-dbc502089463';
  v_id uuid; v_st text; v_auto boolean; v_note text; v_due date; v_dep_due_before date; v_dep_due_after date; v_dep uuid;
  v_proj uuid; v_n int; v_task uuid; v_ok boolean;
begin
  update app_settings set auto_approvals_live = true where id = true;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member_auth, 'role', 'authenticated')::text, true);

  -- T1 manual 30 min yesterday -> auto
  v_id := submit_manual_time_entry(v_t513, '2026-10-06 06:00+08', '2026-10-06 06:30+08', 'Forgot to start timer', 'dry run');
  select status, auto_approved into v_st, v_auto from time_entries where id = v_id;
  out := out || ' | T1 30min: ' || v_st || '/' || v_auto;
  -- T2 manual 3h -> pending
  v_id := submit_manual_time_entry(v_t513, '2026-10-05 05:00+08', '2026-10-05 08:00+08', 'Forgot to start timer', 'dry run');
  select status, auto_approved into v_st, v_auto from time_entries where id = v_id;
  out := out || ' | T2 3h: ' || v_st || '/' || v_auto;

  -- T3 extension 1 WD on T-0513 (has a dependent) -> auto + cascade
  select td.task_id into v_dep from task_dependencies td where td.depends_on_task_id = v_t513 limit 1;
  select current_due_date into v_dep_due_before from tasks where id = v_dep;
  insert into extension_requests (task_id, requested_by, requested_new_due_date, reason_category, reason_notes)
  values (v_t513, (select id from people where auth_user_id = v_member_auth), '2026-10-14', 'Other', 'dry run') returning id into v_id;
  select status, auto_approved, coalesce(auto_check_note, '-') into v_st, v_auto, v_note from extension_requests where id = v_id;
  select current_due_date into v_due from tasks where id = v_t513;
  select current_due_date into v_dep_due_after from tasks where id = v_dep;
  out := out || ' | T3 ext 1WD: ' || v_st || '/' || v_auto || ' note=' || v_note || ' due=' || v_due || ' dep ' || coalesce(v_dep_due_before::text,'-') || '->' || coalesce(v_dep_due_after::text,'-')
             || ' revchg=' || (select count(*) from project_revision_changes);
  -- T3b second request on same task -> pending (not first)
  insert into extension_requests (task_id, requested_by, requested_new_due_date, reason_category, reason_notes)
  values (v_t513, (select id from people where auth_user_id = v_member_auth), '2026-10-15', 'Other', 'dry run') returning id into v_id;
  select status, coalesce(auto_check_note, '-') into v_st, v_note from extension_requests where id = v_id;
  out := out || ' | T3b 2nd: ' || v_st || ' note=' || v_note;
  -- T4 extension 3 WD on T-0499 -> pending
  insert into extension_requests (task_id, requested_by, requested_new_due_date, reason_category, reason_notes)
  values (v_t499, (select id from people where auth_user_id = v_member_auth), '2026-10-21', 'Other', 'dry run') returning id into v_id;
  select status, coalesce(auto_check_note, '-') into v_st, v_note from extension_requests where id = v_id;
  out := out || ' | T4 3WD: ' || v_st || ' note=' || v_note;

  -- T5 validation sweep as Sandra on the project with most on-time/late unvalidated Done tasks
  perform set_config('request.jwt.claims', json_build_object('sub', v_sandra_auth, 'role', 'authenticated')::text, true);
  select t.project_id into v_proj from tasks t join projects p on p.id = t.project_id
   where t.status = 'Done' and t.validated_completion_date is null and not t.is_archived and p.wbs_status <> 'closed'
     and t.actual_completion_date >= t.current_due_date
     and not exists (select 1 from tasks c where c.parent_task_id = t.id and not c.is_archived)
   group by 1 order by count(*) desc limit 1;
  out := out || ' | T5 eligible(all)=' || (select count(*) from tasks t join projects p on p.id = t.project_id
     where t.status = 'Done' and t.validated_completion_date is null and not t.is_archived and p.wbs_status <> 'closed'
       and t.actual_completion_date >= t.current_due_date and not exists (select 1 from tasks c where c.parent_task_id = t.id and not c.is_archived))
     || ' early(all)=' || (select count(*) from tasks t where t.status = 'Done' and t.validated_completion_date is null and not t.is_archived and t.actual_completion_date < t.current_due_date);
  if v_proj is not null then
    v_n := run_auto_validations(v_proj, true);
    out := out || ' ran=' || v_n;
    select id into v_task from tasks where project_id = v_proj and auto_validated limit 1;
    if v_task is not null then
      begin
        perform reverse_auto_validation(v_task, 'dry run');
        select validated_completion_date is null and validation_hold and status = 'Done' into v_ok from tasks where id = v_task;
        out := out || ' reverse=' || v_ok;
        perform set_validation_hold(v_task, false);
        out := out || ' hold-release=' || (select not validation_hold from tasks where id = v_task);
      exception when others then out := out || ' REVERSE-ERR=' || sqlerrm; end;
    end if;
  end if;

  -- T6 reverse auto time as Sandra (full) on T1 entry
  select id into v_id from time_entries where auto_approved and reason_notes = 'dry run' limit 1;
  begin
    perform reverse_auto_approved_time(v_id, 'dry run');
    out := out || ' | T6 reverse time: ' || (select status from time_entries where id = v_id);
  exception when others then out := out || ' | T6 ERR=' || sqlerrm; end;

  raise exception 'DRYRUN%', out;
end $$;
