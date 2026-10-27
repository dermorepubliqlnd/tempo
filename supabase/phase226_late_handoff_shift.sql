-- phase226 (2026-10-23, Sandra): a task finished AFTER its due date shifts the
-- tasks that depend on it, the same way an approved extension already does
-- (cascade_dependent_starts): next working day after the actual finish, same
-- length in working days, only ever later, original due date kept. Started
-- projects only. Every shift is recorded (who caused it, by how much) for the
-- Shifted tooltip and the close-out report.
create table if not exists public.task_schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  source_task_id uuid references public.tasks(id) on delete set null,
  source_task_name text,
  source_due date,
  source_finished date,
  days_late int,
  previous_due date,
  new_due date,
  reason text not null default 'Late hand-off',
  created_at timestamptz not null default now()
);
create index if not exists task_schedule_shifts_project_idx on public.task_schedule_shifts(project_id);
create index if not exists task_schedule_shifts_task_idx on public.task_schedule_shifts(task_id, created_at desc);
alter table public.task_schedule_shifts enable row level security;
drop policy if exists task_schedule_shifts_select on public.task_schedule_shifts;
create policy task_schedule_shifts_select on public.task_schedule_shifts for select to authenticated using (true);

create or replace function public.trg_r2_late_handoff_shift() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_done date;
  v_start date;
  v_new_due date;
  v_late int;
  dep record;
begin
  if new.status is distinct from 'Done' or old.status is not distinct from 'Done' then return new; end if;
  if new.current_due_date is null then return new; end if;
  select coalesce(wbs_status, 'draft') into v_status from projects where id = new.project_id;
  if v_status not in ('baseline_locked', 'changed_after_baseline') then return new; end if;
  v_done := coalesce(new.actual_completion_date::date, (now() at time zone 'Asia/Manila')::date);
  if v_done <= new.current_due_date::date then return new; end if;
  v_late := public.working_days_after(new.current_due_date::date, v_done);
  v_start := public.next_working_day(v_done);

  perform set_config('app.bypass_start_date_lock', 'on', true);
  perform set_config('app.bypass_due_date_lock', 'on', true);
  for dep in
    select tk.id, tk.start_date, tk.current_due_date, tk.status, tk.start_date_full, tk.start_date_standard,
           tk.start_full_auto, tk.start_standard_auto
    from task_dependencies td join tasks tk on tk.id = td.task_id
    where td.depends_on_task_id = new.id and not coalesce(tk.is_archived, false)
      and coalesce(tk.status, '') not in ('Done', 'Cancelled')
  loop
    if dep.start_date is not null and dep.start_date <= v_done then
      if dep.current_due_date is not null then
        v_new_due := public.add_working_days(v_start, public.working_days_after(dep.start_date, dep.current_due_date::date));
        if v_new_due > dep.current_due_date::date then
          update tasks set start_date = v_start, current_due_date = v_new_due where id = dep.id;
          perform public.record_due_date_change_audit(dep.id, dep.current_due_date::date, v_new_due);
          insert into task_schedule_shifts (project_id, task_id, source_task_id, source_task_name, source_due, source_finished, days_late, previous_due, new_due)
          values (new.project_id, dep.id, new.id, new.name, new.current_due_date::date, v_done, v_late, dep.current_due_date::date, v_new_due);
          perform public.cascade_dependent_starts(dep.id);
        else
          update tasks set start_date = v_start where id = dep.id;
        end if;
      else
        update tasks set start_date = v_start where id = dep.id;
      end if;
    end if;
    if coalesce(dep.start_full_auto, false) and (dep.start_date_full is null or dep.start_date_full <= v_done) then
      update tasks set start_date_full = v_start where id = dep.id;
    end if;
    if coalesce(dep.start_standard_auto, false) and (dep.start_date_standard is null or dep.start_date_standard <= v_done) then
      update tasks set start_date_standard = v_start where id = dep.id;
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_r2_late_handoff_shift on public.tasks;
create trigger trg_r2_late_handoff_shift after update of status on public.tasks
  for each row execute function public.trg_r2_late_handoff_shift();
