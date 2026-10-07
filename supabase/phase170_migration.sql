-- phase170 (2026-10-07, Sandra): role-based navigation (item E) + 10 PM timer stop (item K).
-- Additive. Nothing changes for live users until the preview code is merged
-- (columns are only read by the new code) and, for the 10 PM stop, until
-- app_settings.timer_10pm_stop_live = true.

-- ---------------------------------------------------------- E. navigation
alter table public.people add column if not exists nav_role text
  check (nav_role is null or nav_role in ('member', 'owner', 'lead', 'full'));
alter table public.people add column if not exists page_access jsonb;    -- {page_key: bool} overrides
alter table public.people add column if not exists system_views jsonb;   -- ["system_..."] override list
alter table public.app_settings add column if not exists role_defaults jsonb;  -- null = Tempo's built-in defaults

-- ----------------------------------------------------- K. 10 PM timer stop
-- At the 10 PM sign-out, running timers stop at 22:00 Manila and wait in
-- "Needs confirming" for the morning (instead of running on until the 4-hour
-- limit cuts them, which inflated hours).
alter table public.app_settings add column if not exists timer_10pm_stop_live boolean not null default false;
alter table public.time_entries add column if not exists auto_stop_reason text
  check (auto_stop_reason is null or auto_stop_reason in ('limit', '10pm'));

create or replace function public.stop_timers_at_10pm() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cut timestamptz := (date_trunc('day', now() at time zone 'Asia/Manila') + interval '22 hours') at time zone 'Asia/Manila';
  v_n int;
begin
  if not coalesce((select timer_10pm_stop_live from app_settings where id = true), false) then return 0; end if;
  if v_cut > now() then v_cut := v_cut - interval '1 day'; end if;
  update time_entries
     set ended_at = greatest(started_at, v_cut),
         status = 'pending_confirm',
         duration_minutes = round(extract(epoch from (greatest(started_at, v_cut) - started_at)) / 60.0),
         auto_stopped = true,
         auto_stop_reason = '10pm'
   where status = 'running' and started_at < v_cut;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 22:00 Manila = 14:00 UTC
select cron.schedule('stop-timers-10pm', '0 14 * * *', $$select public.stop_timers_at_10pm()$$)
 where not exists (select 1 from cron.job where jobname = 'stop-timers-10pm');

-- label the existing 4-hour limit stops
create or replace function public.tag_limit_auto_stop() returns trigger language plpgsql as $$
begin
  if NEW.auto_stopped and NEW.auto_stop_reason is null and coalesce(OLD.auto_stopped, false) = false then
    NEW.auto_stop_reason := 'limit';
  end if;
  return NEW;
end $$;
drop trigger if exists zz_tag_limit_auto_stop on public.time_entries;
create trigger zz_tag_limit_auto_stop before update on public.time_entries
  for each row execute function public.tag_limit_auto_stop();

select 'phase170 ok' as result;
