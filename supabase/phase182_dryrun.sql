-- Rolled-back dry run: Sandra (top of chain) asks for +7 calendar days on one of her open tasks.
do $$
declare v_me uuid := 'e7e52a30-4c13-449b-889d-280dc0ca16c6'; v_task record; v_id uuid; r record; v_new date;
begin
  select tk.id, tk.task_number, tk.current_due_date::date as due into v_task
    from tasks tk join projects p on p.id = tk.project_id
   where tk.assignee_id = v_me and not tk.is_archived and coalesce(tk.status,'') not in ('Done','Cancelled')
     and tk.current_due_date is not null and p.timelines_locked and coalesce(p.wbs_status,'') <> 'closed'
   order by tk.current_due_date desc limit 1;
  insert into extension_requests (task_id, requested_by, requested_new_due_date, reason_category, reason_notes)
  values (v_task.id, v_me, v_task.due + 7, (select reason_category from extension_requests where reason_category is not null limit 1), 'phase182 dry run')
  returning id into v_id;
  select status, auto_approved, auto_check_note, decided_by into r from extension_requests where id = v_id;
  select current_due_date::date into v_new from tasks where id = v_task.id;
  raise exception 'DRYRUN top=% T-% due % -> task due now % | status % auto % decided_by_me % note %',
    public.nearest_active_manager(v_me) is null, v_task.task_number, v_task.due, v_new, r.status, r.auto_approved, r.decided_by = v_me, r.auto_check_note;
end $$;
