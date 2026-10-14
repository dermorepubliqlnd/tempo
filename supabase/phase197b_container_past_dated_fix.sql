-- phase197b (2026-10-14, Sandra -- #23 follow-up): Fritzie's P-0079 session
-- (T-0891) was created on 14 Oct with the container's end date (5 Oct) as its
-- default due date, so it was "past due" the moment it existed and the #23 rule
-- still sent her to an extension request. In containers the extension rule now
-- only applies when the due date passed AFTER the task was created; a task that
-- was created already past-dated can have its dates corrected by its assignee.

create or replace function public.r2_container_date_edit_ok(p_project_id uuid, p_assignee uuid, p_old_due date, p_created_at timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select public.r2_is_open_container(p_project_id)
     and (p_old_due is null
          or p_old_due >= (now() at time zone 'Asia/Manila')::date
          or p_old_due < (coalesce(p_created_at, now()) at time zone 'Asia/Manila')::date)
     and (p_assignee = public.my_person_id() or public.r2_can_manage_project_tasks(p_project_id));
$$;
grant execute on function public.r2_container_date_edit_ok(uuid, uuid, date, timestamptz) to authenticated;

do $$
declare d text := pg_get_functiondef('public.enforce_due_date_lock'::regproc);
begin
  if position('OLD.current_due_date, OLD.created_at)' in d) > 0 then return; end if;
  if position('r2_container_date_edit_ok(NEW.project_id, OLD.assignee_id, OLD.current_due_date)' in d) = 0 then
    raise exception 'phase197b: phase197 patch not found, nothing changed';
  end if;
  d := replace(d, 'r2_container_date_edit_ok(NEW.project_id, OLD.assignee_id, OLD.current_due_date)',
                  'r2_container_date_edit_ok(NEW.project_id, OLD.assignee_id, OLD.current_due_date, OLD.created_at)');
  execute d;
end $$;
