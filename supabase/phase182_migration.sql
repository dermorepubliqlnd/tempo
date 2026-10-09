-- phase182 (2026-10-09, Sandra): extensions by someone with no one above them
-- in the reporting line are approved on submit (the client confirms first).
-- Guard: the live auto_approve_extension must still match phase169's rules.
do $$
declare d text;
begin
  select pg_get_functiondef('public.auto_approve_extension()'::regprocedure) into d;
  if position('phase182' in d) > 0 then raise exception 'phase182 already applied'; end if;
  if position('greatest(v_end, coalesce(v_max_before, v_end))' in d) = 0
     or position('not the first extension on this task' in d) = 0
     or position('requested after the due date had passed' in d) = 0
     or position('working_days_after(t.due, NEW.requested_new_due_date::date)' in d) = 0 then
    raise exception 'live auto_approve_extension differs from phase169 -- stop';
  end if;
end $$;

create or replace function public.auto_approve_extension() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_end date;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_wd int;
  v_note text := null;
  v_max_before date;
begin
  if NEW.task_id is null or NEW.status <> 'Pending' or coalesce(NEW.is_manager_initiated, false)
     or coalesce(NEW.request_type, 'due_date') <> 'due_date' or not public.auto_approvals_enabled() then
    return null;
  end if;
  select tk.id, tk.project_id, tk.current_due_date::date as due into t from tasks tk where tk.id = NEW.task_id;
  select end_date::date into v_end from projects where id = t.project_id;
  v_wd := public.working_days_after(t.due, NEW.requested_new_due_date::date);

  -- phase182 (Sandra, 10-09): no one above the requester in the reporting
  -- line -> approved on submit, whatever the size (the form asked them to
  -- confirm first). Same decide_extension_request path, so the due date,
  -- audit and dependent cascade are identical to a manual approval.
  if NEW.requested_by is not null and public.nearest_active_manager(NEW.requested_by) is null
     and t.due is not null and NEW.requested_new_due_date::date > t.due then
    begin
      perform set_config('app.auto_approval', 'on', true);
      perform public.decide_extension_request(NEW.id, 'Approved',
        'Auto-approved: no one above in the reporting line (' || v_wd || ' working day' ||
        case when v_wd = 1 then '' else 's' end || ', ' || to_char(t.due, 'Mon DD') || ' -> ' ||
        to_char(NEW.requested_new_due_date::date, 'Mon DD') || ')');
      update extension_requests set auto_approved = true, decided_by = NEW.requested_by where id = NEW.id;
      perform set_config('app.auto_approval', 'off', true);
      return null;
    exception when others then
      update extension_requests set auto_check_note = 'could not be approved automatically (' || left(sqlerrm, 120) || ')' where id = NEW.id;
      return null;
    end;
  end if;

  if t.due is null or NEW.requested_new_due_date::date <= t.due then
    v_note := 'the new date is not later than the current due date';
  elsif v_wd > 2 then
    v_note := v_wd || ' working days (auto-approval is for 2 or less)';
  elsif exists (select 1 from extension_requests er where er.task_id = NEW.task_id and er.id <> NEW.id) then
    v_note := 'not the first extension on this task';
  elsif v_today > t.due then
    v_note := 'requested after the due date had passed';
  end if;

  if v_note is null then
    select max(x.current_due_date)::date into v_max_before from tasks x
     where x.project_id = t.project_id and not x.is_archived and coalesce(x.status, '') <> 'Cancelled';
    begin
      perform set_config('app.auto_approval', 'on', true);
      perform public.decide_extension_request(NEW.id, 'Approved',
        'Auto-approved: ' || v_wd || ' working day' || case when v_wd = 1 then '' else 's' end ||
        ' (' || to_char(t.due, 'Mon DD') || ' -> ' || to_char(NEW.requested_new_due_date::date, 'Mon DD') || ')');
      -- "Impacts the project end" = after the move (dependents included) the
      -- latest task finishes later than both the project end date and the
      -- latest finish before this request (a project already running past
      -- its end date isn't blocked by a slip that doesn't push it further).
      if v_end is not null and exists (
           select 1 from tasks x
            where x.project_id = t.project_id and not x.is_archived
              and coalesce(x.status, '') <> 'Cancelled'
              and x.current_due_date::date > greatest(v_end, coalesce(v_max_before, v_end))) then
        raise exception using errcode = 'P0169', message = 'past project end';
      end if;
      update extension_requests set auto_approved = true, decided_by = null where id = NEW.id;
      perform set_config('app.auto_approval', 'off', true);
      return null;
    exception
      when sqlstate 'P0169' then
        v_note := 'it would push a task past the project end date (' || to_char(v_end, 'Mon DD') || ')';
      when others then
        v_note := 'could not be auto-checked (' || left(sqlerrm, 120) || ')';
    end;
  end if;
  update extension_requests set auto_check_note = v_note where id = NEW.id;
  return null;
end;
$$;

-- check
select position('phase182' in pg_get_functiondef('public.auto_approve_extension()'::regprocedure)) > 0 as phase182_live;
