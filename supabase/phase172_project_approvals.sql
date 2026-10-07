-- phase172 (2026-10-08, Sandra, item J): Start Project and Close Project
-- requests are ROUTED like every other approval.
--
-- Routed approver = start at effective_approver(requester) (leave +
-- delegation, phase130) and walk up the reporting line (active people,
-- nearest_active_manager) to the first person who holds the right:
--   'start' -> people.can_approve_rebaseline
--   'close' -> people.can_approve_closures or access_level = 'full'
-- Nobody in the line holds the right -> NULL (no routing; the existing
-- can_decide_* checks apply unchanged).
-- Mirrored in TS: src/lib/approvalRouting.ts routeProjectRequest().
--
-- Enforcement is STAGING-GATED: the triggers do nothing unless
-- auto_approvals_enabled() (preview header or go-live flag) and skip system
-- decisions (auto_approval_active()). When on, deciding a pending request
-- (status -> approved/rejected) requires caller = routed approver, or an
-- approval_overrides row by the caller for that request in the last 15
-- minutes (same pattern as assert_routed_or_overridden, phase131).
-- Additive only: new function, new trigger function, two new triggers. No
-- existing function is changed.

create or replace function public.project_request_approver(p_kind text, p_requester uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_p uuid;
  v_i int := 0;
begin
  if p_requester is null or p_kind not in ('start', 'close') then return null; end if;
  v_p := public.effective_approver(p_requester);
  while v_p is not null and v_i < 25 loop
    if exists (
      select 1 from public.people pe
      where pe.id = v_p and pe.is_active
        and (
          (p_kind = 'start' and coalesce(pe.can_approve_rebaseline, false))
          or (p_kind = 'close' and (coalesce(pe.can_approve_closures, false) or pe.access_level = 'full'))
        )
    ) then
      return v_p;
    end if;
    v_p := public.nearest_active_manager(v_p);
    v_i := v_i + 1;
  end loop;
  return null;
end;
$$;
grant execute on function public.project_request_approver(text, uuid) to authenticated;

-- TG_ARGV[0] = 'start' | 'close'
create or replace function public.enforce_route_project_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid;
  v_routed uuid;
begin
  if not public.auto_approvals_enabled() then return new; end if;   -- staging only until go-live
  if public.auto_approval_active() then return new; end if;        -- system decisions
  if old.status is distinct from 'pending' or new.status not in ('approved', 'rejected') then return new; end if;
  v_me := public.my_person_id();
  if v_me is null then return new; end if;                          -- service jobs
  v_routed := public.project_request_approver(tg_argv[0], new.requested_by);
  if v_routed is null or v_routed = v_me then return new; end if;
  if exists (select 1 from public.approval_overrides o
             where o.item_id = new.id and o.overridden_by = v_me
               and o.created_at > now() - interval '15 minutes') then
    return new;
  end if;
  raise exception 'This request is routed to %. Use Override in Approval Center (Team view) and give a reason.',
    coalesce((select name from public.people where id = v_routed), 'another approver');
end;
$$;

drop trigger if exists enforce_route_baseline_request on public.project_baseline_requests;
create trigger enforce_route_baseline_request before update on public.project_baseline_requests
  for each row execute function public.enforce_route_project_request('start');

drop trigger if exists enforce_route_closure_request on public.project_closure_requests;
create trigger enforce_route_closure_request before update on public.project_closure_requests
  for each row execute function public.enforce_route_project_request('close');

-- check
select tgname, tgrelid::regclass from pg_trigger where tgname like 'enforce_route_%' order by 1;
-- e.g. who each pending request is routed to:
-- select 'start' k, r.id, r.requested_by, public.project_request_approver('start', r.requested_by) from project_baseline_requests r where status = 'pending'
-- union all
-- select 'close', r.id, r.requested_by, public.project_request_approver('close', r.requested_by) from project_closure_requests r where status = 'pending';
