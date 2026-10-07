-- phase166 HOTFIX (2026-10-07, applied live): approving an extension failed with
-- "this task is Cancelled -- its scoping fields ... are locked" when a CANCELLED task
-- depended on the extended task (FDA-Complaint Product Claims: T-0642 'Untitled task'
-- depends on T-0395 Project Scoping). cascade_dependent_starts skipped Done
-- dependents but not Cancelled ones. Now skips both.
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

  v_next_start := v_new_due + 1;
  while extract(dow from v_next_start) in (0, 6) loop
    v_next_start := v_next_start + 1;
  end loop;

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
        v_delta := v_next_start - dep.start_date;
        v_new_dep_due := dep.current_due_date + v_delta;
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
$function$
;
