-- Phase 126 KB (2026-09-30): old Team Dashboard renamed Projects Portfolio;
-- new Team Dashboard = L&D Executive Dashboard. Snapshot then update the one
-- entry that referenced the old name, and add a Dashboards category + entry.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where id = 'dd94009e-3bbc-48b2-bd7f-1995cc27b271';
update kb_entries set updated_at = now(),
  content = replace(content, '**Team Dashboard → Needs Attention**', '**Projects Portfolio → Needs Attention**')
 where id = 'dd94009e-3bbc-48b2-bd7f-1995cc27b271';

insert into kb_categories (name, sort_order) values ('Dashboards', 1) on conflict (name) do nothing;

insert into kb_entries (category_id, title, content, sort_order)
select id, 'Team Dashboard (L&D Executive Dashboard)', $md$## Team Dashboard (L&D Executive Dashboard)

One page for L&D leadership: **what we're working on, whether we're delivering as planned, whether we have capacity for upcoming work, and where attention is needed.** It summarizes the detailed pages — click any card to open the page behind it.

**Sidebar order:** My Dashboard → Projects Portfolio (the former Team Dashboard: donuts, Needs Attention, Active Projects table) → Team Dashboard.

### Filters
| Filter | What it does |
|---|---|
| **Reporting Period** | YTD (default), This Quarter, Last Quarter, This Month, Last Month, Custom Range. The resolved dates show under the button. |
| **Population** | All L&D (default), By role, or Selected team members. Drives every people-based number (capacity, hours, missing hours). A project counts if its owner or any task assignee is in the population. |
| **More Filters** | Project Owner, Source, Planning Type, Project Type, Category, Project Status, Role. Applied filters appear as removable chips. |

### Three time contexts (by design)
| Context | Used for |
|---|---|
| **Reporting Period** | Project counts, Completed, Scoped Hours, Logged Hours |
| **Next 2 weeks** (today + 13 days) | Planned Utilization, Available Capacity, Overallocated Members |
| **Current state** | Overdue Tasks (as of today), Missing Hours (this week, Mon → today) |

### 1 · Portfolio Overview
| Card | Definition |
|---|---|
| **Total Projects** | Completed in the period + open projects (In Progress, Not Started, Paused) that started by the period end. Cancelled excluded. |
| **Completed** | Status Completed with Actual Close Date (or completion stamp / End Date) inside the period. |
| **Active** | Status = In Progress (today's status). |
| **Not Started** | Status = Not Started, or WBS still in Draft. |
| **Paused** | Status = Paused. |
| **Overdue** | Active projects whose **Health** is Overdue. Status and Health are separate concepts. |

Open projects always show **today's** status, even for a past period (Tempo doesn't keep status history).

### 2 · Executive Operating Summary
| Card | Definition |
|---|---|
| **Planned Utilization** | Planned workload ÷ available capacity over the next 2 weeks. Same engine as the Utilization page. |
| **Available Capacity** | Unallocated hours summed per person per working day. One person's overload doesn't cancel another's free time. |
| **Scoped Hours** | Leaf-task Scoped Hours spread across each task's working days; only days inside the period count. Parent tasks excluded (no double count). |
| **Logged Hours** | Finalized time only (Confirmed / Approved), incl. non-project time. With a project filter on, only time on those projects. "% of expected" uses expected hours for elapsed working days. |
| **Overallocated Members** | People above 100% planned utilization on at least one working day in the next 2 weeks. Hover the card for names. |
| **Overdue Tasks** | Open leaf tasks with Target Due Date before today. Tasks in paused projects excluded. |
| **Missing Hours** | Expected hours minus finalized logged hours, per person per working day this week. Expected hours already adjust for half-days, full-day time off, holidays and weekends. Hover for who. |

### Comparison lines
YTD compares to the same dates last year. Until a full prior year exists, YTD cards compare **quarter-to-date vs the same point last quarter** ("QTD vs last qtr"). Other periods compare to the immediately preceding period of the same length.
$md$, 1 from kb_categories where name = 'Dashboards'
and not exists (select 1 from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)');

select title, length(content) from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)' or id = 'dd94009e-3bbc-48b2-bd7f-1995cc27b271';
