-- phase126c (2026-09-30): time tracking go-live date; expected hours count from here.
alter table app_settings add column if not exists time_tracking_start_date date not null default '2026-08-03';

-- KB: Team Dashboard entry -- Missing Hours = completed days only; expected-hours start date.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
update kb_entries set updated_at = now(), content = replace(replace(replace(content,
  '| **Current state** | Overdue Tasks (as of today), Missing Hours (this week, Mon → today) |',
  '| **Current state** | Overdue Tasks (as of today), Missing Hours (completed working days this week) |'),
  '| **Missing Hours** | Expected hours minus finalized logged hours, per person per working day this week. Expected hours already adjust for half-days, full-day time off, holidays and weekends. Hover for who. |',
  '| **Missing Hours** | Expected hours minus finalized logged hours, per person per **completed** working day this week (Monday to yesterday — today is not counted yet). On a Monday it shows last week. Expected hours already adjust for half-days, full-day time off, holidays and weekends. Hover for who. My Dashboard still counts today as a personal reminder. |'),
  '"% of expected" uses expected hours for elapsed working days. |',
  '"% of expected" compares logged hours with **expected hours** (each person''s daily capacity, usually 7.5h, adjusted for half-days, time off, holidays and weekends) from the **Time tracking start date** (Site settings) to today. It is not compared with Scoped Hours. |')
 where title = 'Team Dashboard (L&D Executive Dashboard)';
select (select time_tracking_start_date from app_settings limit 1) start_date, title, (content like '%completed** working day%') a, (content like '%Time tracking start date%') b from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)';
