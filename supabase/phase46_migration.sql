-- Phase 46 (2026-09-08): Start Project decline reasons --
-- Sandra: "can we add a WBS status if the start project request was
-- declined? so the user sees if the request has been rejected or
-- returned for review. Add a note for the baseline approver too to
-- write notes for the reason of rejection. we can add predefined
-- reasons too. can add in the list settings." + "always put notes as
-- optional then require if others is selected."
--
-- The "WBS status" part is display-only (see wbsStatus.ts's
-- wbsStatusMetaFor -- a project stays literally wbs_status='draft' the
-- whole time, same convention as the existing "Awaiting Baseline
-- Approval" overlay), so no schema change needed for that half.
--
-- decision_reason (free text) already existed on project_baseline_requests
-- since phase15 but was never actually used by the client (decide_
-- baseline_request was always called with p_reason: null) -- now used as
-- the OPTIONAL notes field. decline_reason is new: the picked predefined
-- reason's name, required whenever a request is rejected.

create table if not exists baseline_decline_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table baseline_decline_reasons enable row level security;

create policy baseline_decline_reasons_select on baseline_decline_reasons for select using (true);
create policy baseline_decline_reasons_insert on baseline_decline_reasons for insert with check (my_access_level() = 'full');
create policy baseline_decline_reasons_update on baseline_decline_reasons for update using (my_access_level() = 'full') with check (my_access_level() = 'full');
create policy baseline_decline_reasons_delete on baseline_decline_reasons for delete using (my_access_level() = 'full');

insert into baseline_decline_reasons (name, sort_order) values
  ('Scope not fully defined', 1),
  ('Missing or incomplete task details (hours, dates, assignees)', 2),
  ('Hours estimate needs revision', 3),
  ('Timeline unrealistic', 4),
  ('Missing required project fields (Category/Source/Complexity)', 5),
  ('Resourcing/capacity not yet confirmed', 6),
  ('Needs stakeholder alignment first', 7),
  ('Other', 8)
on conflict (name) do nothing;

alter table project_baseline_requests add column if not exists decline_reason text;
