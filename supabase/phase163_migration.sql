-- phase163 (2026-10-07, Sandra): Output Count rules per Output Type.
--   * output_types.counts_deliverable (Site Settings toggle). Only
--     "No Deliverable/Activity Only" is NOT counted -> Output Count is
--     always 0 (forced).
--   * Every other output type needs a whole number >= 1 when the task is
--     marked Done (status -> Done or Reported Completion set). Sessions
--     are always 1 (unchanged). Parents and cancelled tasks are skipped.
--   * Existing Done tasks with a blank count are grandfathered here; the
--     closure gate (app) asks for them before a project can close.

alter table public.output_types add column if not exists counts_deliverable boolean not null default true;
update public.output_types set counts_deliverable = false where name = 'No Deliverable/Activity Only';

create or replace function public.enforce_output_count_rules() returns trigger
language plpgsql as $$
declare
  v_counts boolean;
  v_name text;
  v_becoming_done boolean;
begin
  if NEW.output_type_id is null then return NEW; end if;
  select counts_deliverable, name into v_counts, v_name from public.output_types where id = NEW.output_type_id;
  if v_counts is null then return NEW; end if;
  if not v_counts then
    NEW.output_count := 0;
    return NEW;
  end if;
  if tg_op = 'UPDATE' then
    v_becoming_done := (NEW.status = 'Done' and coalesce(OLD.status, '') <> 'Done')
                    or (NEW.actual_completion_date is not null and OLD.actual_completion_date is null);
  else
    v_becoming_done := NEW.status = 'Done';
  end if;
  if v_becoming_done
     and coalesce(NEW.output_count, 0) < 1
     and not exists (select 1 from public.tasks c where c.parent_task_id = NEW.id and not c.is_archived) then
    raise exception 'Output Count is required: enter how many % this task produced (1 or more) before marking it complete.', v_name;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_enforce_output_count_rules on public.tasks;
create trigger trg_enforce_output_count_rules
  before insert or update of output_type_id, output_count, status, actual_completion_date on public.tasks
  for each row execute function public.enforce_output_count_rules();

-- Existing non-counted tasks -> 0 (bypass done/closed locks; count isn't a locked field but be safe)
do $$ begin
  perform set_config('app.bypass_done_task_lock', 'on', true);
  perform set_config('app.bypass_closed_project_lock', 'on', true);
  update public.tasks t set output_count = 0
  from public.output_types o
  where o.id = t.output_type_id and not o.counts_deliverable and coalesce(t.output_count, -1) <> 0;
end $$;

select 'phase163' t,
  (select string_agg(name, ', ') from public.output_types where not counts_deliverable) not_counted,
  (select count(*) from public.tasks t join public.output_types o on o.id = t.output_type_id where o.counts_deliverable and t.status = 'Done' and coalesce(t.output_count, 0) < 1 and not t.is_archived
     and not exists (select 1 from public.tasks c where c.parent_task_id = t.id and not c.is_archived)) done_missing_count;
