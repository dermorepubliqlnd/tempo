-- phase175 (Sandra 2026-10-08): "I want the first date ever set to be seen and
-- trapped. Any delays or any completion after the original project due date."
--
-- Committed date = the date in force when Start Project was approved (project
-- leaves Draft). Never changed afterwards by extensions, cascades, WBS
-- re-plans or re-baselines. Tasks added after Start commit the date they are
-- added with (same-day edits by the planner still follow, until an extension
-- request exists).
--
-- Additive only: new columns + triggers + backfill. Nothing reads them except
-- the new UI columns.

alter table public.tasks
  add column if not exists committed_due_date date,
  add column if not exists committed_due_source text,
  add column if not exists committed_due_at timestamptz;

alter table public.projects
  add column if not exists committed_end_date date,
  add column if not exists committed_end_source text,
  add column if not exists committed_end_at timestamptz;

comment on column public.tasks.committed_due_source is
  'start = stamped at Start Project approval; added = task added after Start; backfill_history / backfill_original / backfill_current = reconstructed 2026-10-08 (estimated)';
comment on column public.projects.committed_end_source is
  'start = stamped at Start Project approval; backfill_baseline / backfill_current = reconstructed 2026-10-08 (estimated)';

-- 1) Stamp at commit time of the transaction that moves a project out of Draft,
--    so the dates read are the final ones after the approval RPC is done.
create or replace function public.stamp_committed_dates_on_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.wbs_status, 'draft') = 'draft' then
    return null;
  end if;
  perform set_config('app.committed_stamp', 'on', true);
  update public.projects
     set committed_end_date = end_date, committed_end_source = 'start', committed_end_at = now()
   where id = new.id and committed_end_date is null and end_date is not null;
  update public.tasks
     set committed_due_date = current_due_date, committed_due_source = 'start', committed_due_at = now()
   where project_id = new.id and committed_due_date is null and current_due_date is not null;
  perform set_config('app.committed_stamp', 'off', true);
  return null;
end;
$$;

drop trigger if exists trg_committed_on_start on public.projects;
create constraint trigger trg_committed_on_start
  after update of wbs_status on public.projects
  deferrable initially deferred
  for each row
  when (coalesce(old.wbs_status, 'draft') = 'draft' and coalesce(new.wbs_status, 'draft') <> 'draft')
  execute function public.stamp_committed_dates_on_start();

-- 2) Projects: committed_end_* is write-once.
create or replace function public.guard_project_committed_end() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.committed_stamp', true), '') = 'on'
     or coalesce(current_setting('app.committed_override', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.committed_end_date := null; new.committed_end_source := null; new.committed_end_at := null;
  else
    new.committed_end_date := old.committed_end_date;
    new.committed_end_source := old.committed_end_source;
    new.committed_end_at := old.committed_end_at;
  end if;
  return new;
end;
$$;
drop trigger if exists zzz_guard_project_committed_end on public.projects;
create trigger zzz_guard_project_committed_end
  before insert or update on public.projects
  for each row execute function public.guard_project_committed_end();

-- 3) Tasks: write-once, plus "added after Start".
--    A project started in THIS transaction (started_at = now()) is left to the
--    deferred stamp above so it reads the final dates.
create or replace function public.guard_task_committed_due() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_wbs text;
  v_started timestamptz;
begin
  if coalesce(current_setting('app.committed_stamp', true), '') = 'on'
     or coalesce(current_setting('app.committed_override', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.committed_due_date := null; new.committed_due_source := null; new.committed_due_at := null;
  else
    new.committed_due_date := old.committed_due_date;
    new.committed_due_source := old.committed_due_source;
    new.committed_due_at := old.committed_due_at;
    -- same-day grace for a task added after Start: the planner is still
    -- setting it up, so its committed date follows until the day ends or an
    -- extension is requested.
    if old.committed_due_source = 'added'
       and new.current_due_date is not null
       and new.current_due_date is distinct from old.current_due_date
       and (old.committed_due_at at time zone 'Asia/Manila')::date = (now() at time zone 'Asia/Manila')::date
       and not exists (select 1 from public.extension_requests e where e.task_id = new.id) then
      new.committed_due_date := new.current_due_date;
    end if;
  end if;

  if new.committed_due_date is null and new.current_due_date is not null then
    select wbs_status, started_at into v_wbs, v_started from public.projects where id = new.project_id;
    if coalesce(v_wbs, 'draft') <> 'draft' and (v_started is null or v_started < now()) then
      new.committed_due_date := new.current_due_date;
      new.committed_due_source := 'added';
      new.committed_due_at := now();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists zzz_guard_task_committed_due on public.tasks;
create trigger zzz_guard_task_committed_due
  before insert or update on public.tasks
  for each row execute function public.guard_task_committed_due();

-- 4) Backfill (estimated) for projects already started.
-- Other user triggers (roll-ups, activity, locks) are switched off for the
-- backfill only: it writes the new columns and nothing else.
do $$
begin
  perform set_config('app.committed_stamp', 'on', true);
  alter table public.projects disable trigger user;
  alter table public.tasks disable trigger user;

  with b as (
    select distinct on (pb.project_id) pb.project_id, pb.end_date, pb.captured_at
      from public.project_baselines pb
     order by pb.project_id, pb.version_number nulls last, pb.captured_at
  )
  update public.projects p
     set committed_end_date = coalesce(b.end_date, p.end_date),
         committed_end_source = case when b.end_date is not null then 'backfill_baseline' else 'backfill_current' end,
         committed_end_at = coalesce(b.captured_at, p.started_at, now())
    from public.projects p2
    left join b on b.project_id = p2.id
   where p2.id = p.id
     and p.committed_end_date is null
     and coalesce(p.wbs_status, 'draft') <> 'draft'
     and coalesce(b.end_date, p.end_date) is not null;

  with h as (
    select distinct on (c.task_id) c.task_id, (c.previous_value #>> '{}')::date first_due, c.changed_at
      from public.project_revision_changes c
     where c.field = 'current_due_date' and c.task_id is not null
       and jsonb_typeof(c.previous_value) = 'string'
     order by c.task_id, c.changed_at
  ), src as (
    select t.id,
           coalesce(h.first_due, t.original_due_date, t.current_due_date) d,
           case when h.first_due is not null then 'backfill_history'
                when t.original_due_date is not null then 'backfill_original'
                else 'backfill_current' end s,
           coalesce(h.changed_at, pr.started_at, t.created_at) a
      from public.tasks t
      join public.projects pr on pr.id = t.project_id
      left join h on h.task_id = t.id
     where t.committed_due_date is null
       and coalesce(pr.wbs_status, 'draft') <> 'draft'
  )
  update public.tasks t
     set committed_due_date = src.d, committed_due_source = src.s, committed_due_at = src.a
    from src
   where src.id = t.id and src.d is not null;

  alter table public.projects enable trigger user;
  alter table public.tasks enable trigger user;
  perform set_config('app.committed_stamp', 'off', true);
end;
$$;
