-- phase186 (2026-10-13, Sandra): Analysis & Scoping tasks of new-lifecycle
-- projects run BEFORE Start Project, so their status (In Progress / Done)
-- must be changeable while the project is Draft -- otherwise the scope
-- statement can never be marked Done and the review never unlocks.
-- Every other task keeps the existing rule (status changes only after
-- Start Project). Based on the live definition read 2026-10-13.
create or replace function public.enforce_status_baseline_lock() returns trigger
language plpgsql as $$
declare
  v_locked boolean;
  v_wbs_status text;
  v_lifecycle smallint;
begin
  if TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    if coalesce(current_setting('app.bypass_status_baseline_lock', true), '') <> 'on' then
      select timelines_locked, wbs_status, lifecycle_version into v_locked, v_wbs_status, v_lifecycle from projects where id = NEW.project_id;
      if v_wbs_status = 'closed' then
        raise exception 'this project is closed -- task statuses are final and can no longer be changed';
      end if;
      if not coalesce(v_locked, false) and not coalesce(NEW.wbs_phase = 'analysis' and v_lifecycle = 2, false) then
        raise exception 'task status can only be changed once this project has been started (WBS Planning -> Start Project)';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;
