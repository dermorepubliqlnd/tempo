-- phase179 (2026-10-09, Sandra): Phase = production step of ACTIVE projects only.
-- Draft projects have no Phase; Backlog / Queued retired (Stage covers them); Done set by Close Project.
create or replace function public.a_project_lifecycle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.wbs_status = 'closed' and coalesce(new.status, '') not in ('Cancelled', 'Completed') then
    new.status := 'Completed';
    new.phase := 'Done';
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  if tg_op = 'UPDATE' and old.wbs_status = 'closed' and coalesce(new.wbs_status, '') <> 'closed' and new.status = 'Completed' then
    new.status := 'In Progress';
    new.completed_at := null;
    if new.phase = 'Done' then new.phase := null; end if;
  end if;
  if coalesce(new.wbs_status, 'draft') = 'draft' then
    new.phase := null;
  end if;
  if coalesce(new.wbs_status, 'draft') not in ('draft', 'closed') then
    if coalesce(new.status, 'Not Started') in ('Not Started', 'Completed') then
      new.status := 'In Progress';
    end if;
    if new.phase in ('Backlog', 'Queued', 'Done') then
      new.phase := null;
    end if;
  end if;
  new.stage := public.project_stage_of(new.status, new.wbs_status, new.id);
  return new;
end;
$$;
update public.project_phases set is_active = false where name in ('Backlog', 'Queued');
alter table public.projects disable trigger trg_touch_activity_projects;
update public.projects set phase = null where coalesce(wbs_status, 'draft') = 'draft' and phase is not null;
alter table public.projects enable trigger trg_touch_activity_projects;
