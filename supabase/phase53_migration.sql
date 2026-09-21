-- Phase 53 migration (2026-09-21): remove project-owner self-approval
-- from closure decisions.
--
-- Sandra, after finding Gemmabelle Aragon (owner of P-0028, access_level
-- 'limited', can_approve_closures = false) had approved her own
-- project's closure: "How come Gemma was able to approve project close
-- when she does not have the permission to do so?" -- can_decide_closure
-- (phase11_migration.sql) had a third branch letting any project owner
-- approve their OWN project's closure request regardless of
-- can_approve_closures or access level. That was by design since Phase 2
-- (mirrors WbsPlanning.tsx's/ApprovalCenter.tsx's own canDecideClosure),
-- but Sandra confirmed it's not how she wants it to work: "Yes. that's
-- how it should work" (i.e. remove it) -- an owner can still REQUEST
-- their own project's closure (can_manage_wbs, unchanged), just not
-- approve it themselves.

create or replace function can_decide_closure(p_request_id uuid) returns boolean
language sql stable security definer as $$
  select coalesce(
    my_access_level() = 'full'
    or exists (select 1 from people me where me.id = my_person_id() and me.can_approve_closures),
    false
  )
$$;

grant execute on function can_decide_closure(uuid) to authenticated;
