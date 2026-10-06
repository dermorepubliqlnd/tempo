-- phase161 HOTFIX (2026-10-07): touch_project_activity() referenced new.project_id
-- inside a CASE; plpgsql resolves the field even on the untaken branch, so every
-- INSERT/UPDATE on public.projects failed: record "new" has no field "project_id"
-- (blocked project create + extension approvals). Read fields via jsonb instead.
create or replace function public.touch_project_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_pid uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_pid := case when tg_table_name = 'projects' then (v_row->>'id')::uuid
                else (v_row->>'project_id')::uuid end;
  if v_pid is not null then
    insert into public.project_activity (project_id, last_activity_at) values (v_pid, now())
    on conflict (project_id) do update set last_activity_at = excluded.last_activity_at;
  end if;
  return null;
exception when foreign_key_violation then
  return null;
end;
$$;
