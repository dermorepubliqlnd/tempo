-- phase131 (2026-10-02, Sandra): enforce the Override reason in the DB.
-- Deciding an item that is NOT routed to you (effective_approver) now
-- requires an approval_overrides row by you for that item in the last
-- 15 minutes (the app writes it, with the reason, before deciding).

drop policy if exists approval_overrides_update on approval_overrides;
create policy approval_overrides_update on approval_overrides for update to authenticated
  using (overridden_by = my_person_id()) with check (overridden_by = my_person_id());

create or replace function assert_routed_or_overridden(p_item_id uuid, p_subject uuid) returns void
language plpgsql stable security definer as $$
declare
  v_me uuid := my_person_id();
  v_routed uuid;
begin
  if v_me is null or p_subject is null then return; end if;   -- system / service jobs
  v_routed := effective_approver(p_subject);
  if v_routed = v_me then return; end if;
  if exists (select 1 from approval_overrides o
             where o.item_id = p_item_id and o.overridden_by = v_me
               and o.created_at > now() - interval '15 minutes') then
    return;
  end if;
  raise exception 'This item is routed to %. Use Override in Approval Center (Team view) and give a reason.',
    coalesce((select name from people where id = v_routed), 'another approver');
end;
$$;

create or replace function enforce_override_extension() returns trigger language plpgsql as $$
begin
  if old.status = 'Pending' and new.status in ('Approved','Rejected') then
    perform assert_routed_or_overridden(new.id, new.requested_by);
  end if;
  return new;
end $$;
drop trigger if exists enforce_override_extension on extension_requests;
create trigger enforce_override_extension before update on extension_requests
  for each row execute function enforce_override_extension();

create or replace function enforce_override_time_entry() returns trigger language plpgsql as $$
begin
  if old.status = 'pending_approval' and new.status in ('approved','rejected') then
    perform assert_routed_or_overridden(new.id, new.person_id);
  end if;
  return new;
end $$;
drop trigger if exists enforce_override_time_entry on time_entries;
create trigger enforce_override_time_entry before update on time_entries
  for each row execute function enforce_override_time_entry();

create or replace function enforce_override_correction() returns trigger language plpgsql as $$
begin
  if old.status = 'pending' and new.status in ('approved','rejected') then
    perform assert_routed_or_overridden(new.id, new.requested_by);
  end if;
  return new;
end $$;
drop trigger if exists enforce_override_correction on time_entry_correction_requests;
create trigger enforce_override_correction before update on time_entry_correction_requests
  for each row execute function enforce_override_correction();

create or replace function enforce_override_task_validation() returns trigger language plpgsql as $$
begin
  if old.validated_completion_date is null and new.validated_completion_date is not null then
    perform assert_routed_or_overridden(new.id, new.assignee_id);
  end if;
  return new;
end $$;
drop trigger if exists enforce_override_task_validation on tasks;
create trigger enforce_override_task_validation before update on tasks
  for each row execute function enforce_override_task_validation();

select tgname from pg_trigger where tgname like 'enforce_override_%' order by 1;
