-- Phase 119 (2026-09-25): Working Now scoped per tab.
--   Team Time -> caller's reporting line only (everyone below them, at any
--                depth), never the caller, EVEN for Full Access. Before,
--                the Full Access override made Team Time's Working Now
--                list org-wide.
--   All Time  -> every running timer org-wide, INCLUDING the caller's
--                own (shown as "(You)" in the UI). Full Access only.
-- New function name because CREATE OR REPLACE can't add parameters;
-- get_team_running_timers() stays in place as the client's fallback.
create or replace function get_running_timers(p_scope text default 'team') returns table (
  entry_id uuid, person_id uuid, person_name text, task_id uuid, task_name text, task_number integer,
  project_id uuid, project_name text, started_at timestamptz
)
language sql stable security definer as $$
  select te.id, te.person_id, p.name, te.task_id, t.name, t.task_number, t.project_id, pr.name, te.started_at
  from time_entries te
  join people p on p.id = te.person_id
  left join tasks t on t.id = te.task_id
  left join projects pr on pr.id = t.project_id
  where te.status = 'running'
    and (
      (p_scope = 'all' and my_access_level() = 'full')
      or (
        p_scope = 'team'
        and te.person_id <> my_person_id()
        and is_in_reports_to_subtree(my_person_id(), te.person_id)
      )
    )
  order by te.started_at asc;
$$;
revoke all on function get_running_timers(text) from public;
grant execute on function get_running_timers(text) to authenticated;
