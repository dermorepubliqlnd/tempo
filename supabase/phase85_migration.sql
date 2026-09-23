-- ============================================================
-- Phase 85 (2026-09-23): Team Time supervisor view -- server-side team
-- visibility for the brand-new "Working Now" + dynamic team-capacity
-- features.
--
-- Research this session found time_entries' RLS effectively open to any
-- authenticated user (can_see_project() is currently a hardcoded `select
-- true` stub -- a deliberate 2026-09-03 decision for PROJECT browsing,
-- "everyone should see all projects" -- but it also happens to make
-- individual time entries readable by anyone via that same clause), and
-- person_availability has no RLS at all. Sandra confirmed she wants this
-- closed for the Team Time feature specifically.
--
-- SCOPE DECISION: tightening the shared time_entries/person_availability
-- table-level RLS outright would also affect Utilization.tsx,
-- HoursOverview.tsx and WbsPlanning.tsx, which currently show every
-- active person's hours/capacity to every logged-in user with NO UI
-- gating at all -- a live, apparently intentional "org-wide capacity
-- planning" behavior, not an oversight. Rewriting that is a bigger,
-- separate product decision outside "Team Time enhancement." So this
-- migration does NOT touch the existing time_entries/person_availability
-- table policies -- instead it adds NEW, narrowly-scoped SECURITY
-- DEFINER RPCs for the two brand-new pieces of this phase (Working Now,
-- team-required-hours), which are new attack surface with no prior
-- behavior to preserve, and are genuinely enforced server-side --
-- independent of whatever the calling page's client-side filtering does.
-- The pre-existing Team Entries table (already shipped in earlier
-- phases) still reads through the existing broad table RLS; tightening
-- that without breaking the other three pages is flagged as a separate
-- follow-up, not silently done here.
-- ============================================================

-- Recursive reports_to subtree membership check -- mirrors
-- TimeTracking.tsx's client-side myTeamIds BFS (walk every descendant at
-- any depth), now available server-side. Includes the root person too.
create or replace function is_in_reports_to_subtree(p_manager uuid, p_person uuid) returns boolean
language sql stable security definer as $$
  with recursive subtree as (
    select id from people where id = p_manager
    union all
    select p.id from people p join subtree s on p.reports_to = s.id
  )
  select exists (select 1 from subtree where id = p_person);
$$;
grant execute on function is_in_reports_to_subtree(uuid, uuid) to authenticated;

-- Working Now: currently-running timers for the caller's real team
-- (excluding the caller's own -- that's already shown via
-- TimeTrackingContext's own-timer bar; Team Time's Working Now is about
-- everyone ELSE). Full Access sees every running timer org-wide, same
-- convention as time_entries_select's my_access_level()='full' clause.
create or replace function get_team_running_timers() returns table (
  entry_id uuid,
  person_id uuid,
  person_name text,
  task_id uuid,
  task_name text,
  project_id uuid,
  project_name text,
  started_at timestamptz
)
language sql stable security definer as $$
  select te.id, te.person_id, p.name, te.task_id, t.name, t.project_id, pr.name, te.started_at
  from time_entries te
  join people p on p.id = te.person_id
  left join tasks t on t.id = te.task_id
  left join projects pr on pr.id = t.project_id
  where te.status = 'running'
    and te.person_id <> my_person_id()
    and (my_access_level() = 'full' or is_in_reports_to_subtree(my_person_id(), te.person_id))
  order by te.started_at asc;
$$;
grant execute on function get_team_running_timers() to authenticated;

-- Team required hours: per-person, per-day expected hours for the
-- caller's real team across a date range -- same off/half_day/full-rate
-- rule as expectedHoursForDay()/dailyCapacityHours() in
-- src/lib/dailyAllocation.ts (half-day = 50% of daily_capacity_hours,
-- kept consistent with Utilization/WBS's existing convention rather than
-- a separate hardcoded number), so the client can sum however it needs
-- to (a single day for "Today", every day in the selected week for
-- "This Week") without re-deriving the rule twice. Weekends are left to
-- the client to exclude (matches how TimeTracking.tsx's own
-- myExpectedHoursFor/weeklyTargetMinutes already only iterates Mon-Fri)
-- -- this returns every calendar day in range with an is_holiday flag so
-- the caller decides.
create or replace function get_team_required_hours(p_start date, p_end date) returns table (
  person_id uuid,
  person_name text,
  date date,
  is_holiday boolean,
  expected_hours numeric
)
language sql stable security definer as $$
  select
    p.id,
    p.name,
    d.date,
    exists (select 1 from holidays h where h.date = d.date) as is_holiday,
    case
      when exists (select 1 from person_availability pa where pa.person_id = p.id and pa.date = d.date and pa.status = 'off') then 0
      when exists (select 1 from holidays h where h.date = d.date) then 0
      when exists (select 1 from person_availability pa where pa.person_id = p.id and pa.date = d.date and pa.status = 'half_day') then p.daily_capacity_hours * 0.5
      else p.daily_capacity_hours
    end as expected_hours
  from people p
  cross join generate_series(p_start, p_end, interval '1 day') as d(date)
  where p.is_active
    and (my_access_level() = 'full' or is_in_reports_to_subtree(my_person_id(), p.id))
$$;
grant execute on function get_team_required_hours(date, date) to authenticated;

-- Fix: get_team_required_hours originally included the caller's own
-- person row (is_in_reports_to_subtree's recursive CTE includes the
-- root/manager itself), which would double-count the supervisor's own
-- required hours inside "Team Required Hours" -- that figure is meant
-- to represent the team (mirrors get_team_running_timers, which already
-- excludes the caller via `te.person_id <> my_person_id()`). My Time
-- already shows the supervisor's own target separately.
create or replace function get_team_required_hours(p_start date, p_end date) returns table (
  person_id uuid, person_name text, date date, is_holiday boolean, expected_hours numeric
)
language sql stable security definer as $$
  select
    p.id, p.name, d.date,
    exists (select 1 from holidays h where h.date = d.date) as is_holiday,
    case
      when exists (select 1 from person_availability pa where pa.person_id = p.id and pa.date = d.date and pa.status = 'off') then 0
      when exists (select 1 from holidays h where h.date = d.date) then 0
      when exists (select 1 from person_availability pa where pa.person_id = p.id and pa.date = d.date and pa.status = 'half_day') then p.daily_capacity_hours * 0.5
      else p.daily_capacity_hours
    end as expected_hours
  from people p
  cross join generate_series(p_start, p_end, interval '1 day') as d(date)
  where p.is_active
    and p.id <> my_person_id()
    and (my_access_level() = 'full' or is_in_reports_to_subtree(my_person_id(), p.id))
$$;
grant execute on function get_team_required_hours(date, date) to authenticated;
