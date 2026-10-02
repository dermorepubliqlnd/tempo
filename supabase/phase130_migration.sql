-- phase130 (2026-10-02, Sandra): approvals keep the reporting line, but
-- each item has ONE routed approver; others see it read-only and may
-- Override with a required reason. Delegation while on leave, and
-- auto-routing up the chain when the approver is on leave (Time Off "off")
-- with no delegate.

create table if not exists approval_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references people(id),
  delegate_id uuid not null references people(id),
  start_date date not null,
  end_date date not null,
  created_by uuid references people(id) default my_person_id(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint approval_delegations_dates check (end_date >= start_date),
  constraint approval_delegations_not_self check (delegator_id <> delegate_id)
);
alter table approval_delegations enable row level security;
drop policy if exists approval_delegations_select on approval_delegations;
create policy approval_delegations_select on approval_delegations for select to authenticated using (true);
drop policy if exists approval_delegations_insert on approval_delegations;
create policy approval_delegations_insert on approval_delegations for insert to authenticated
  with check (delegator_id = my_person_id() or my_access_level() = 'full');
drop policy if exists approval_delegations_update on approval_delegations;
create policy approval_delegations_update on approval_delegations for update to authenticated
  using (delegator_id = my_person_id() or my_access_level() = 'full')
  with check (delegator_id = my_person_id() or my_access_level() = 'full');

create table if not exists approval_overrides (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  item_id uuid not null,
  subject_person_id uuid references people(id),
  routed_approver_id uuid references people(id),
  overridden_by uuid not null references people(id) default my_person_id(),
  decision text not null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);
alter table approval_overrides enable row level security;
drop policy if exists approval_overrides_select on approval_overrides;
create policy approval_overrides_select on approval_overrides for select to authenticated using (true);
drop policy if exists approval_overrides_insert on approval_overrides;
create policy approval_overrides_insert on approval_overrides for insert to authenticated
  with check (overridden_by = my_person_id());

-- Who an item about p_person is routed to today (Manila date).
create or replace function effective_approver(p_person_id uuid) returns uuid
language plpgsql stable security definer as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_m uuid;
  v_up uuid;
  v_d uuid;
  v_i int := 0;
begin
  if p_person_id is null then return null; end if;
  v_m := nearest_active_manager(p_person_id);
  if v_m is null then return p_person_id; end if;   -- top of chain
  while v_i < 20 loop
    select ad.delegate_id into v_d
    from approval_delegations ad join people dp on dp.id = ad.delegate_id and dp.is_active
    where ad.delegator_id = v_m and ad.cancelled_at is null
      and v_today between ad.start_date and ad.end_date
      and ad.delegate_id <> p_person_id
    order by ad.created_at desc limit 1;
    if v_d is not null then return v_d; end if;
    if exists (select 1 from person_availability pa where pa.person_id = v_m and pa.date = v_today and pa.status = 'off') then
      v_up := nearest_active_manager(v_m);
      if v_up is null then return v_m; end if;
      v_m := v_up;
    else
      return v_m;
    end if;
    v_i := v_i + 1;
  end loop;
  return v_m;
end;
$$;
grant execute on function effective_approver(uuid) to authenticated;

-- Reporting line (unchanged) OR the routed/acting approver today.
create or replace function is_decider_for(p_person_id uuid) returns boolean
language sql stable security definer as $$
  select coalesce(
    is_approver_for(p_person_id)
    or (p_person_id is not null and p_person_id <> my_person_id() and effective_approver(p_person_id) = my_person_id()),
    false)
$$;
grant execute on function is_decider_for(uuid) to authenticated;

-- Swap is_approver_for -> is_decider_for in the DECISION functions only
-- (archive/delete and schedule rights keep the plain reporting line).
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('can_decide_extension','can_decide_time_entry','can_decide_time_entry_correction',
                        'validate_task_completion','lock_task_validation','reopen_task')
  loop
    v_def := pg_get_functiondef(r.oid);
    if position('is_approver_for(' in v_def) > 0 then
      execute replace(v_def, 'is_approver_for(', 'is_decider_for(');
    end if;
  end loop;
end $$;

-- check
select p.proname, position('is_decider_for(' in pg_get_functiondef(p.oid)) > 0 as patched
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('can_decide_extension','can_decide_time_entry','can_decide_time_entry_correction','validate_task_completion','lock_task_validation','reopen_task')
order by 1;
