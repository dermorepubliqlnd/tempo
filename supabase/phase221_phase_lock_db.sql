-- phase221 (2026-10-22, Sandra: "has to be bullet proof"): the phase lock is
-- enforced in the database too. On new-lifecycle projects, while Analysis &
-- Scoping is part of the project, no task can be added to (or moved into)
-- Design, Development, Implementation or Evaluation until every scoping task
-- is Done (incl. Scope Sign-Off). Same rule as the WBS screen. Removing the
-- Analysis & Scoping phase opens everything. Existing tasks are untouched.
create or replace function public.trg_r2_phase_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_total int;
  v_open int;
begin
  if new.wbs_phase is null or new.wbs_phase = 'analysis' then return new; end if;
  if tg_op = 'UPDATE' and new.wbs_phase is not distinct from old.wbs_phase then return new; end if;
  if public.my_person_id() is null then return new; end if; -- system jobs / SQL editor
  if not exists (select 1 from projects p where p.id = new.project_id and p.lifecycle_version = 2) then return new; end if;
  -- Analysis & Scoping removed from this project? Then nothing is locked.
  if not exists (select 1 from project_milestones m where m.project_id = new.project_id and m.phase_key = 'analysis' and m.is_included) then
    return new;
  end if;
  select count(*), count(*) filter (where t.status is distinct from 'Done')
    into v_total, v_open
  from tasks t
  where t.project_id = new.project_id and t.wbs_phase = 'analysis'
    and not coalesce(t.is_archived, false) and coalesce(t.status, '') <> 'Cancelled'
    and not exists (select 1 from tasks c where c.parent_task_id = t.id and not coalesce(c.is_archived, false));
  if v_total = 0 or v_open > 0 then
    raise exception 'This phase opens once Analysis & Scoping is done and signed off. Finish the scoping tasks first, or remove Analysis & Scoping from the project.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_r2_phase_lock on public.tasks;
create trigger trg_r2_phase_lock before insert or update of wbs_phase on public.tasks
  for each row execute function public.trg_r2_phase_lock();
