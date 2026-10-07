-- phase167 (2026-10-07): parent task status roll-up moves into the database.
-- Bug: on P-0049 (Moodle Priority Courses Upload) 5 parent tasks stayed
-- "Not Started" although every sub-task was Done. The roll-up ran only in
-- the browser (Projects.tsx recomputeAncestorStatus) as the person who
-- changed the sub-task; assignees aren't allowed to update a parent row
-- (RLS: owner / Full Access / the parent's own assignee), so the update was
-- silently ignored. Now an AFTER trigger (security definer) recomputes the
-- parent from its children every time, with the same rule as the app:
--   no non-cancelled children -> Not Started; all Done -> Done;
--   all Not Started -> Not Started; otherwise In Progress.
-- Cancelled parents are left alone.

create or replace function public.rollup_parent_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_parent uuid;
  v_rel int; v_done int; v_ns int;
  v_new text; v_cur text;
begin
  v_parent := coalesce((to_jsonb(NEW) ->> 'parent_task_id')::uuid, (to_jsonb(OLD) ->> 'parent_task_id')::uuid);
  if v_parent is null then return null; end if;
  select count(*) filter (where coalesce(status, '') <> 'Cancelled'),
         count(*) filter (where status = 'Done'),
         count(*) filter (where coalesce(status, 'Not Started') = 'Not Started')
    into v_rel, v_done, v_ns
  from public.tasks where parent_task_id = v_parent and not coalesce(is_archived, false);
  v_new := case when v_rel = 0 then 'Not Started'
                when v_done = v_rel then 'Done'
                when v_ns = v_rel then 'Not Started'
                else 'In Progress' end;
  select status into v_cur from public.tasks where id = v_parent;
  if v_cur is null or v_cur = 'Cancelled' or v_cur = v_new then return null; end if;
  perform set_config('app.bypass_done_task_lock', 'on', true);
  begin
    update public.tasks
       set status = v_new,
           submitted_on = case when v_new = 'Done' then now() else null end,
           submitted_by = null
     where id = v_parent;
  exception when others then
    -- never let a locked parent (e.g. validated) block the sub-task's own change
    raise notice 'parent roll-up skipped for %: %', v_parent, sqlerrm;
  end;
  perform set_config('app.bypass_done_task_lock', 'off', true);
  return null;
end $$;

drop trigger if exists trg_rollup_parent_status on public.tasks;
create trigger trg_rollup_parent_status
  after insert or delete or update of status, parent_task_id, is_archived on public.tasks
  for each row execute function public.rollup_parent_status();

-- Backfill: fix every parent whose status disagrees with its children.
do $$
declare r record; v_new text;
begin
  perform set_config('app.bypass_done_task_lock', 'on', true);
  perform set_config('app.bypass_closed_project_lock', 'on', true);
  for r in
    select par.id, par.status,
           count(*) filter (where coalesce(c.status, '') <> 'Cancelled') rel,
           count(*) filter (where c.status = 'Done') done,
           count(*) filter (where coalesce(c.status, 'Not Started') = 'Not Started') ns
    from public.tasks par join public.tasks c on c.parent_task_id = par.id and not coalesce(c.is_archived, false)
    where not coalesce(par.is_archived, false) and coalesce(par.status, '') <> 'Cancelled'
    group by par.id, par.status
  loop
    v_new := case when r.rel = 0 then 'Not Started' when r.done = r.rel then 'Done' when r.ns = r.rel then 'Not Started' else 'In Progress' end;
    if r.status is distinct from v_new then
      update public.tasks set status = v_new,
        submitted_on = case when v_new = 'Done' then coalesce(submitted_on, now()) else null end
      where id = r.id;
    end if;
  end loop;
end $$;
