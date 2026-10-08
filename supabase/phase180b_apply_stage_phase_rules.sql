-- phase180b: apply Stage -> Phase rules to existing projects (Site Settings save).
create or replace function public.apply_stage_phase_rules() returns int
language plpgsql security definer set search_path = public as $$
declare v_rules jsonb; n int := 0; m int; v_dp text; v_cp text;
begin
  if coalesce(my_access_level(), '') <> 'full' then raise exception 'only Full Access can change the Stage → Phase rules'; end if;
  select stage_phase_rules into v_rules from app_settings limit 1;
  v_dp := v_rules->'draft'->>'phase';
  v_cp := coalesce(v_rules->'closed'->>'phase', 'Done');
  if coalesce((v_rules->'draft'->>'auto')::boolean, true) then
    update projects set phase = v_dp where coalesce(wbs_status, 'draft') = 'draft' and not coalesce(is_archived, false) and phase is distinct from v_dp;
    get diagnostics m = row_count; n := n + m;
  end if;
  if coalesce((v_rules->'closed'->>'auto')::boolean, true) then
    update projects set phase = v_cp where wbs_status = 'closed' and coalesce(status, '') <> 'Cancelled' and not coalesce(is_archived, false) and phase is distinct from v_cp;
    get diagnostics m = row_count; n := n + m;
  end if;
  return n;
end;
$$;
grant execute on function public.apply_stage_phase_rules() to authenticated;
