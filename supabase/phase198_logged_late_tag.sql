-- phase198 (2026-10-14, Sandra -- Parking Lot #24, Access Model v1.1)
-- "Logged late": a task whose due date is earlier than the day it was created
-- (e.g. a session logged the day after it happened).
--   * Done            -> late_log_kind = 'logged_late'. No approval needed if it was
--                        logged within 3 working days of its due date; older ones need
--                        the owner / the assignee's manager / Full Access to confirm.
--   * not Done        -> late_log_kind = 'extended' (the app warns when it's saved).
-- Applies to tasks created on/after 13 Oct 2026. Additive: one tag column and its
-- confirmation fields; nothing existing changes behaviour.

alter table public.tasks add column if not exists late_log_kind text;
alter table public.tasks drop constraint if exists tasks_late_log_kind_check;
alter table public.tasks add constraint tasks_late_log_kind_check check (late_log_kind in ('logged_late', 'extended'));
alter table public.tasks add column if not exists late_log_confirmed_by uuid references public.people(id);
alter table public.tasks add column if not exists late_log_confirmed_at timestamptz;

-- Mon-Fri days after p_from up to and including p_to (0 when p_to <= p_from).
create or replace function public.r2_working_days_between(p_from date, p_to date) returns int
language sql immutable as $$
  select count(*)::int from generate_series(p_from + 1, p_to, interval '1 day') g(d)
  where p_to > p_from and extract(isodow from g.d) < 6;
$$;

create or replace function public.trg_r2_late_log_tag() returns trigger
language plpgsql as $$
declare
  v_created date := (coalesce(new.created_at, now()) at time zone 'Asia/Manila')::date;
begin
  if v_created < date '2026-10-13' or new.current_due_date is null then
    return new;
  end if;
  if new.current_due_date < v_created then
    new.late_log_kind := case when new.status = 'Done' then 'logged_late' else 'extended' end;
  else
    new.late_log_kind := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_r2_late_log_tag on public.tasks;
create trigger trg_r2_late_log_tag before insert or update of status, current_due_date on public.tasks
  for each row execute function public.trg_r2_late_log_tag();

-- Confirm a late log older than 3 working days (owner, owner's supervisor,
-- the assignee's manager, or Full Access).
create or replace function public.r2_confirm_late_log(p_task_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from tasks where id = p_task_id;
  if t.id is null then raise exception 'Task not found.'; end if;
  if t.late_log_kind is distinct from 'logged_late' then raise exception 'This task is not logged late.'; end if;
  if not (public.r2_can_manage_project_tasks(t.project_id) or public.is_approver_for(t.assignee_id)) then
    raise exception 'Only the project owner, the assignee''s manager or Full Access can confirm a late log.';
  end if;
  update tasks set late_log_confirmed_by = public.my_person_id(), late_log_confirmed_at = now() where id = p_task_id;
end;
$$;
grant execute on function public.r2_confirm_late_log(uuid) to authenticated;

-- Tag tasks created since 13 Oct that already match.
update public.tasks t set late_log_kind = case when t.status = 'Done' then 'logged_late' else 'extended' end
where (t.created_at at time zone 'Asia/Manila')::date >= date '2026-10-13'
  and t.current_due_date is not null
  and t.current_due_date < (t.created_at at time zone 'Asia/Manila')::date
  and not coalesce(t.is_archived, false);
