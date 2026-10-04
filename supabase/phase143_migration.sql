-- phase143 (Sandra, 2026-10-04): submitters can cancel their own request
-- while it's still New (not yet Under review). Test request removed.
delete from feedback_requests where request_number = 1 and subject = 'Test Request';
select setval('feedback_request_number_seq', coalesce((select max(request_number) from feedback_requests), 0) + 1, false);

alter table feedback_requests drop constraint if exists feedback_requests_status_check;
alter table feedback_requests add constraint feedback_requests_status_check
  check (status in ('New', 'Under review', 'Planned', 'Done', 'Declined', 'Cancelled'));

create or replace function cancel_feedback_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_row feedback_requests;
begin
  select * into v_row from feedback_requests where id = p_id;
  if not found then raise exception 'Request not found.'; end if;
  if v_row.person_id is distinct from my_person_id() then
    raise exception 'Only the person who submitted this request can cancel it.';
  end if;
  if v_row.status <> 'New' then
    raise exception 'This request is already %, so it can''t be cancelled. Add a note to the admin instead.', lower(v_row.status);
  end if;
  update feedback_requests set status = 'Cancelled', updated_at = now() where id = p_id;
end $$;
grant execute on function cancel_feedback_request(uuid) to authenticated;
