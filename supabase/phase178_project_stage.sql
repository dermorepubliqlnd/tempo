-- phase178 (2026-10-09, Sandra item G): ONE PROJECT LIFECYCLE -- "Stage".
-- Stage is worked out from Status + WBS Status + pending Start/Close requests:
--   Cancelled > Closed > Paused > Closing > Awaiting Start > Draft > Active.
-- Status, WBS Status and Phase stay underneath (nothing deleted), kept in step:
--   * Close Project approved (wbs_status -> closed) sets Status = Completed, Phase = Done.
--   * Reopening a closed WBS puts Status back to In Progress.
--   * A started project (not draft/closed) is In Progress, never Not Started or Completed.
--   * Backlog / Queued / Done phases are cleared on started projects (Stage covers them).
-- "Plan changed" is deliberately NOT a Stage (back end only: wbs_status + Audit Trail).

alter table public.projects add column if not exists stage text;

create or replace function public.project_stage_of(p_status text, p_wbs text, p_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_status = 'Cancelled' then 'Cancelled'
    when p_wbs = 'closed' then 'Closed'
    when p_status = 'Paused' then 'Paused'
    when exists (select 1 from project_closure_requests r where r.project_id = p_id and r.status = 'pending') then 'Closing'
    when coalesce(p_wbs, 'draft') = 'draft'
         and exists (select 1 from project_baseline_requests r where r.project_id = p_id and r.status = 'pending') then 'Awaiting Start'
    when coalesce(p_wbs, 'draft') = 'draft' then 'Draft'
    else 'Active'
  end
$$;
grant execute on function public.project_stage_of(text, text, uuid) to authenticated;

-- Named "a_..." so it runs before the other BEFORE triggers (guards see the synced status).
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

drop trigger if exists a_project_lifecycle on public.projects;
create trigger a_project_lifecycle before insert or update on public.projects
  for each row execute function public.a_project_lifecycle();

-- Start / Close requests change the Stage (Awaiting Start, Closing).
create or replace function public.refresh_project_stage_from_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pid uuid := coalesce(new.project_id, old.project_id);
begin
  update projects p set stage = public.project_stage_of(p.status, p.wbs_status, p.id)
   where p.id = v_pid and p.stage is distinct from public.project_stage_of(p.status, p.wbs_status, p.id);
  return null;
end;
$$;
drop trigger if exists zz_refresh_stage on public.project_closure_requests;
create trigger zz_refresh_stage after insert or update or delete on public.project_closure_requests
  for each row execute function public.refresh_project_stage_from_request();
drop trigger if exists zz_refresh_stage on public.project_baseline_requests;
create trigger zz_refresh_stage after insert or update or delete on public.project_baseline_requests
  for each row execute function public.refresh_project_stage_from_request();

-- Backfill without resetting "last activity" (idle Draft reminders).
alter table public.projects disable trigger trg_touch_activity_projects;
update public.projects set stage = stage;
alter table public.projects enable trigger trg_touch_activity_projects;
