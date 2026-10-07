-- phase171 (2026-10-07, Sandra): shifted due dates no longer land on weekends.
-- cascade_dependent_starts moved dependents by CALENDAR days (start skipped
-- weekends, due didn't). Now a dependent starts on the next WORKING day after
-- the task it depends on and keeps its length in WORKING days (weekends and
-- holidays skipped). Preview-gated like phase169 until go-live
-- (auto_approvals_enabled()); otherwise the previous behaviour runs.

create or replace function public.next_working_day(p_from date) returns date
language plpgsql stable set search_path = public as $$
declare d date := p_from + 1;
begin
  while extract(isodow from d) >= 6 or exists (select 1 from holidays h where h.date = d) loop
    d := d + 1;
  end loop;
  return d;
end $$;

create or replace function public.add_working_days(p_from date, p_n int) returns date
language plpgsql stable set search_path = public as $$
declare d date := p_from; i int := 0;
begin
  while i < coalesce(p_n, 0) loop
    d := public.next_working_day(d);
    i := i + 1;
  end loop;
  return d;
end $$;

CREATE OR REPLACE FUNCTION public.cascade_dependent_starts(p_task_id uuid, p_visited uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_new_due date;
  v_next_start date;
  v_delta int;
  v_new_dep_due date;
  v_visited uuid[];
  v_working boolean := public.auto_approvals_enabled();   -- phase171 gate
  dep record;
begin
  perform set_config('app.bypass_start_date_lock', 'on', true);
  perform set_config('app.bypass_due_date_lock', 'on', true);

  if p_task_id = any(p_visited) then
    return;
  end if;
  v_visited := p_visited || array[p_task_id];

  select current_due_date into v_new_due from tasks where id = p_task_id;
  if v_new_due is null then
    return;
  end if;

  if v_working then
    v_next_start := public.next_working_day(v_new_due);
  else
    v_next_start := v_new_due + 1;
    while extract(dow from v_next_start) in (0, 6) loop
      v_next_start := v_next_start + 1;
    end loop;
  end if;

  for dep in
    select tk.id, tk.start_date, tk.start_date_full, tk.start_date_standard,
           tk.start_full_auto, tk.start_standard_auto, tk.status, tk.current_due_date
    from task_dependencies td
    join tasks tk on tk.id = td.task_id
    where td.depends_on_task_id = p_task_id
      and coalesce(tk.is_archived, false) = false
  loop
    if dep.status in ('Done', 'Cancelled') then  -- 2026-10-07: never move cancelled dependents (their dates are locked)
      continue;
    end if;

    if dep.start_date is null or dep.start_date <= v_new_due then
      if dep.start_date is not null and dep.current_due_date is not null then
        if v_working then
          -- keep the task's length in working days
          v_new_dep_due := public.add_working_days(v_next_start, public.working_days_after(dep.start_date, dep.current_due_date));
        else
          v_delta := v_next_start - dep.start_date;
          v_new_dep_due := dep.current_due_date + v_delta;
        end if;
        update tasks set start_date = v_next_start, current_due_date = v_new_dep_due where id = dep.id;
        perform record_due_date_change_audit(dep.id, dep.current_due_date, v_new_dep_due);
        if not (dep.id = any(v_visited)) then
          perform cascade_dependent_starts(dep.id, v_visited);
        end if;
      else
        update tasks set start_date = v_next_start where id = dep.id;
      end if;
    end if;

    if coalesce(dep.start_full_auto, false) and (dep.start_date_full is null or dep.start_date_full <= v_new_due) then
      update tasks set start_date_full = v_next_start where id = dep.id;
    end if;
    if coalesce(dep.start_standard_auto, false) and (dep.start_date_standard is null or dep.start_date_standard <= v_new_due) then
      update tasks set start_date_standard = v_next_start where id = dep.id;
    end if;
  end loop;
end;
$function$;
