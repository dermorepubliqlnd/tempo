-- Phase 59 (2026-09-22, Sandra: "the team work on non-project tasks
-- sometimes -- example meetings, the team weekly huddles -- how do we
-- make the system capture that without plotting it in the project
-- tasks?") -- gives non-project time its own lane in the same
-- time_entries table, rather than faking a task under a real project
-- (which would have polluted Scoped/Spent Hours, Actual Progress, and
-- Materials Output for that project).

-- 1. Admin-configurable activity type list, same id/name/sort_order/
--    is_active shape as work_types/output_types/time_entry_reasons.
create table if not exists non_project_activity_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null,
  is_active boolean not null default true
);

alter table non_project_activity_types enable row level security;

drop policy if exists "non_project_activity_types_select" on non_project_activity_types;
create policy "non_project_activity_types_select" on non_project_activity_types for select using (true);

drop policy if exists "non_project_activity_types_write" on non_project_activity_types;
create policy "non_project_activity_types_write" on non_project_activity_types for all
  using (my_access_level() = 'full') with check (my_access_level() = 'full');

insert into non_project_activity_types (name, sort_order) values
  ('Admin', 1),
  ('Coaching', 2),
  ('Team Huddle', 3),
  ('Training', 4),
  ('Others', 5)
on conflict (name) do nothing;

-- 2. time_entries: task_id becomes optional, activity_type_id is its
--    non-project counterpart. Exactly one of the two must be set --
--    never both, never neither.
alter table time_entries alter column task_id drop not null;
alter table time_entries add column if not exists activity_type_id uuid references non_project_activity_types(id);

alter table time_entries drop constraint if exists time_entries_task_xor_activity;
alter table time_entries add constraint time_entries_task_xor_activity check (
  (task_id is not null and activity_type_id is null) or
  (task_id is null and activity_type_id is not null)
);

create index if not exists time_entries_activity_type_idx on time_entries(activity_type_id);

-- 3. submit_non_project_time_entry: mirrors submit_manual_time_entry,
-- but logs against an activity type instead of a task. Self-only unless
-- Full Access is logging on someone else's behalf (mirrors the
-- assignee-or-Full-Access rule submit_manual_time_entry already uses).
-- Always lands pending_approval -- Sandra: "we still want this routed
-- for approval for now" -- no auto-confirm path for any activity type.
create or replace function submit_non_project_time_entry(
  p_person_id uuid,
  p_activity_type_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_notes text
) returns uuid
language plpgsql security definer as $$
declare
  v_new_id uuid;
begin
  if p_person_id <> my_person_id() and my_access_level() <> 'full' then
    raise exception 'you can only log non-project time for yourself';
  end if;
  if p_ended_at <= p_started_at then
    raise exception 'end time must be after start time';
  end if;
  if not exists (select 1 from non_project_activity_types where id = p_activity_type_id) then
    raise exception 'unknown activity type';
  end if;

  insert into time_entries
    (task_id, activity_type_id, person_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_notes)
  values
    (null, p_activity_type_id, p_person_id, p_started_at, p_ended_at,
     round(extract(epoch from (p_ended_at - p_started_at)) / 60.0),
     'manual', 'pending_approval', my_person_id(), p_notes)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function submit_non_project_time_entry(uuid, uuid, timestamptz, timestamptz, text) to authenticated;

-- 4. can_decide_time_entry: the existing rule (project owner, or their
-- manager if the owner logged it themself) only works when the entry
-- joins to a task/project. A non-project entry has neither, so decision
-- authority instead follows the logger's own manager chain -- same
-- nearest-active-manager-with-skip-level model validate_task_completion
-- already uses, including its "no one active above me" self-exemption
-- (mirrors Sandra's 2026-09-08 self-validation exemption for tasks).
create or replace function can_decide_time_entry(p_entry_id uuid) returns boolean
language plpgsql stable security definer as $$
declare
  v_task_id uuid;
  v_person_id uuid;
  v_manager uuid;
begin
  if my_access_level() = 'full' then
    return true;
  end if;

  select task_id, person_id into v_task_id, v_person_id from time_entries where id = p_entry_id;
  if v_task_id is not null then
    return exists (
      select 1
      from time_entries te
      join tasks t on t.id = te.task_id
      join projects pr on pr.id = t.project_id
      left join people owner on owner.id = pr.owner_id
      where te.id = p_entry_id
        and (
          (pr.owner_id = my_person_id() and te.requested_by <> pr.owner_id)
          or (te.requested_by = pr.owner_id and owner.reports_to = my_person_id())
        )
    );
  end if;

  -- Non-project entry: authority is the logger's nearest active manager,
  -- or the logger themself if nobody active sits above them at all.
  v_manager := nearest_active_manager(v_person_id);
  return v_manager = my_person_id() or (v_manager is null and v_person_id = my_person_id());
end;
$$;

grant execute on function can_decide_time_entry(uuid) to authenticated;
