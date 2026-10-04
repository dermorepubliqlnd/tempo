-- phase140 (Sandra, 2026-10-04): Feedback / enhancement requests.
create sequence if not exists feedback_request_number_seq;
create table if not exists feedback_requests (
  id uuid primary key default gen_random_uuid(),
  request_number integer not null default nextval('feedback_request_number_seq'),
  person_id uuid not null references people(id),
  subject text not null check (length(trim(subject)) > 0 and length(subject) <= 150),
  details text not null check (length(trim(details)) > 0),
  status text not null default 'New' check (status in ('New', 'Under review', 'Planned', 'Done', 'Declined')),
  admin_response text,
  responded_by uuid references people(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_requests_person_idx on feedback_requests(person_id);
alter table feedback_requests enable row level security;

drop policy if exists feedback_select on feedback_requests;
-- Everyone can see every request and its status (Sandra 2026-10-04).
create policy feedback_select on feedback_requests for select
  using (my_person_id() is not null);
drop policy if exists feedback_insert on feedback_requests;
create policy feedback_insert on feedback_requests for insert
  with check (person_id = my_person_id());
drop policy if exists feedback_update on feedback_requests;
create policy feedback_update on feedback_requests for update
  using (my_access_level() = 'full') with check (my_access_level() = 'full');
