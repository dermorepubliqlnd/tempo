-- Phase 121 (2026-09-25): Full Access can't approve their own upline.
-- Sandra: "while a full access basically can approve anyone's, can you
-- not let anyone below someone approve logs -- e.g. Jo reports to me but
-- he is able to approve my logs. No."
--
-- Rule (applies to every reporting-line approval: time entries, time
-- corrections, extensions, task validation/lock/reopen):
--   * Reporting line (is_approver_for) is unchanged.
--   * Full Access still overrides for anyone EXCEPT people above them in
--     their own Reports-to chain, and except themselves.
--   * Top of chain (no active manager above): time entries auto-approve on
--     submit, since nobody is left who may approve them.

-- 1. Helpers ---------------------------------------------------------------
create or replace function is_in_my_upline(p_person_id uuid) returns boolean
language plpgsql stable security definer as $$
declare
  v_cur uuid;
  v_depth int := 0;
begin
  if p_person_id is null or my_person_id() is null then
    return false;
  end if;
  select reports_to into v_cur from people where id = my_person_id();
  while v_cur is not null and v_depth < 20 loop
    if v_cur = p_person_id then
      return true;
    end if;
    select reports_to into v_cur from people where id = v_cur;
    v_depth := v_depth + 1;
  end loop;
  return false;
end;
$$;
grant execute on function is_in_my_upline(uuid) to authenticated;

-- Full Access override, minus self and minus upline. A null subject (e.g.
-- unassigned task) keeps the plain Full Access override.
create or replace function can_full_access_approve(p_subject uuid) returns boolean
language plpgsql stable security definer as $$
begin
  if coalesce(my_access_level(), '') <> 'full' then
    return false;
  end if;
  if p_subject is null then
    return true;
  end if;
  if p_subject = my_person_id() then
    return nearest_active_manager(p_subject) is null;   -- top of chain only
  end if;
  return not is_in_my_upline(p_subject);
end;
$$;
grant execute on function can_full_access_approve(uuid) to authenticated;

-- 2. Small deciders, rewritten ---------------------------------------------
create or replace function can_decide_extension(p_request_id uuid) returns boolean
language sql stable security definer as $$
  select coalesce(exists (
    select 1 from extension_requests er
    where er.id = p_request_id
      and (can_full_access_approve(er.requested_by) or is_approver_for(er.requested_by))
  ), false)
$$;

create or replace function can_decide_time_entry(p_entry_id uuid) returns boolean
language sql stable security definer as $$
  select coalesce(exists (
    select 1 from time_entries te
    where te.id = p_entry_id
      and (can_full_access_approve(te.person_id) or is_approver_for(te.person_id))
  ), false)
$$;

create or replace function can_decide_time_entry_correction(p_request_id uuid) returns boolean
language plpgsql stable security definer as $$
declare
  v_requester uuid;
begin
  select requested_by into v_requester from time_entry_correction_requests where id = p_request_id;
  if v_requester is null then
    return false;
  end if;
  if v_requester = my_person_id() then
    return nearest_active_manager(v_requester) is null;
  end if;
  return can_full_access_approve(v_requester) or is_approver_for(v_requester);
end;
$$;

-- 3. Larger functions: patch the Full Access branch in the LIVE definition
--    (avoids drift from repo copies). Fails loudly if a pattern is missing.
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('validate_task_completion',
       'my_access_level() = ''full'' or (v_assignee_id is not null and is_approver_for(v_assignee_id))',
       'can_full_access_approve(v_assignee_id) or (v_assignee_id is not null and is_approver_for(v_assignee_id))'),
      ('lock_task_validation',
       'my_access_level() = ''full'' or (v_assignee_id is not null and is_approver_for(v_assignee_id))',
       'can_full_access_approve(v_assignee_id) or (v_assignee_id is not null and is_approver_for(v_assignee_id))'),
      ('reopen_task',
       'my_access_level() = ''full''
          or (v_assignee_id is not null and v_assignee_id <> my_person_id() and is_approver_for(v_assignee_id))',
       'can_full_access_approve(v_assignee_id)
          or (v_assignee_id is not null and v_assignee_id <> my_person_id() and is_approver_for(v_assignee_id))')
    ) as t(fname, old_txt, new_txt)
  loop
    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = r.fname;
    if v_def is null then
      raise exception 'phase121: function % not found', r.fname;
    end if;
    if position(r.old_txt in v_def) = 0 then
      raise exception 'phase121: pattern not found in %', r.fname;
    end if;
    v_new := replace(v_def, r.old_txt, r.new_txt);
    execute v_new;
  end loop;
end;
$$;

-- 4. Top of chain: auto-approve time entries
create or replace function auto_approve_top_of_chain_time_entry() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'pending_approval'
     and new.person_id is not null
     and nearest_active_manager(new.person_id) is null then
    new.status := 'approved';
    new.decided_by := new.person_id;
    new.decided_at := now();
    new.decision_notes := coalesce(new.decision_notes, 'Auto-approved: no one above in the reporting line');
  end if;
  return new;
end;
$$;

drop trigger if exists time_entries_auto_approve_top on time_entries;
create trigger time_entries_auto_approve_top
  before insert or update on time_entries
  for each row execute function auto_approve_top_of_chain_time_entry();

-- 5. Backfill (no-op today: 0 pending for top-of-chain people)
update time_entries set status = 'pending_approval'
  where status = 'pending_approval'
    and nearest_active_manager(person_id) is null;
