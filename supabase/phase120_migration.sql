-- Phase 120 (2026-09-25): Required hours scoped per tab (the expected-hours
-- side of Today's Logged / This Week on Team Time and All Time).
--   team -> caller's reporting line only, never the caller, EVEN for Full
--           Access (before, Full Access made Team Time's target org-wide).
--   all  -> every active person INCLUDING the caller (All entries includes
--           the caller's own logs, so the target must too). Full Access only.
-- New name because CREATE OR REPLACE can't add parameters; the old
-- get_team_required_hours(date, date) stays as the client's fallback.
create or replace function get_required_hours(p_start date, p_end date, p_scope text default 'team') returns table (
  person_id uuid, person_name text, date date, is_holiday boolean, expected_hours numeric
)
language sql stable security definer as $$
  select
    p.id, p.name, d.date::date,
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
    and (
      (p_scope = 'all' and my_access_level() = 'full')
      or (
        p_scope = 'team'
        and p.id <> my_person_id()
        and is_in_reports_to_subtree(my_person_id(), p.id)
      )
    )
$$;
revoke all on function get_required_hours(date, date, text) from public;
grant execute on function get_required_hours(date, date, text) to authenticated;
