-- Phase 105 (2026-09-24): Time Off & Holidays -- supervisors can plot
-- time off for their DIRECT reports, Full Access for anyone; everyone still
-- plots their own (Sandra). Holidays unchanged: read for all, write for
-- Full Access only.
drop policy if exists person_availability_insert on person_availability;
drop policy if exists person_availability_update on person_availability;
drop policy if exists person_availability_delete on person_availability;

create policy person_availability_insert on person_availability for insert
  with check (
    person_id = my_person_id()
    or my_access_level() = 'full'
    or exists (select 1 from people where id = person_availability.person_id and reports_to = my_person_id())
  );
create policy person_availability_update on person_availability for update
  using (
    person_id = my_person_id()
    or my_access_level() = 'full'
    or exists (select 1 from people where id = person_availability.person_id and reports_to = my_person_id())
  )
  with check (
    person_id = my_person_id()
    or my_access_level() = 'full'
    or exists (select 1 from people where id = person_availability.person_id and reports_to = my_person_id())
  );
create policy person_availability_delete on person_availability for delete
  using (
    person_id = my_person_id()
    or my_access_level() = 'full'
    or exists (select 1 from people where id = person_availability.person_id and reports_to = my_person_id())
  );
