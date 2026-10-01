-- Phase 128 KB (2026-10-01): Admin > Reports -- L&D Weekly Report deck.
insert into kb_categories (name, sort_order) values ('Dashboards', 1) on conflict (name) do nothing;

insert into kb_entries (category_id, title, content, sort_order)
select id, 'Reports — L&D Weekly Report (deck)', $md$## Reports — L&D Weekly Report

**Admin → Reports** builds the weekly L&D report for Brad as a PowerPoint deck on the official Dermorepubliq template (logo, footer, Poppins fonts and brand colors come from the template itself). Full Access only.

### How to use it
1. Pick the **Report week** — always **Monday to Friday**. The default is last week (the report is usually prepared on Monday or Tuesday).
2. Review the numbers strip, then edit the **Week at a Glance** cards, the **Asks for Brad** (one per line, “Label: text”), and any **slide title**. Everything is auto-drafted from Tempo data.
3. Untick **Delivery drivers** or **Appendix** if you don't need them.
4. Click **Generate deck (.pptx)**. Charts and tables are native PowerPoint objects — you can still edit them.

Edits on the page are not saved; generate the deck once it reads right. **Reset text** re-drafts everything from the data.

### Time windows
| Term | Meaning |
|---|---|
| **Last week** | The selected report week, Mon–Fri. |
| **This week** | The Mon–Fri right after the report week. |
| **Next week** | The Mon–Fri after that. |
| **Current state** | Health, overdue and paused lists use today's status (same as the Team Dashboard). |

### Slides
| # | Slide | What it shows |
|---|---|---|
| 1 | Cover | Report week and who it's prepared for. |
| 2 | **Week at a Glance** | Three cards about **last week**: **Delivery** (green — projects closed, tasks done, % on time), **Utilization** (logged ÷ expected hours, colored by band; unlogged hours, non-project share, hours used vs. estimate on completed tasks), **Pipeline** (blue — projects starting this week, new intake, projects paused). Plus **Asks for Brad**. |
| 3 | Portfolio Overview | Total, Completed, Active, Not started, Paused (for the report week, same rules as the Team Dashboard) and Overdue (today), plus weekly Started vs. Completed for the last 8 weeks. |
| 4 | Active Project Health | Health donut of In Progress projects, overdue projects with days late, and projects due this week. |
| 5 | Delivery Drivers | For up to 5 overdue projects: tasks added after Start Project, date changes and removed tasks since baseline, tasks still past due, extension requests and project notes — read from Tempo's change history. |
| 6 | Portfolio Mix | One 100% stacked chart: Project Type rows, split by **Development** (owned by anyone who isn't a Trainer) vs **Trainer**, and Planned vs Ad Hoc. Labels show % (count). |
| 7 | Project Pipeline | Completed last week · New intake last week (projects created that week, any status) · Starting this week · Paused (days paused and expected resume; red = not set or past). |
| 8 | Team Utilization | By role: last week **actual** (finalized logged ÷ expected), this and next week **planned** (task allocations ÷ capacity). Red = over 100%. Roles with one person are individual figures. |
| 9 | Appendix | Project Type × Planning Type across all projects (excl. Cancelled). |

### Utilization colors
| Band | Color |
|---|---|
| Under 60% | Clarify (tan) — has room |
| 60–80% | Green — healthy |
| 81–100% | Amber — high |
| Over 100% | Red — over capacity |

### Notes
- Only people tagged **Expected to log time** count toward expected hours and utilization.
- Logged hours are **Confirmed/Approved** time only and start from the Site settings **Time tracking start date**.
- The “why” on Delivery Drivers is only as good as the history: filing an **extension request with a reason** (instead of editing dates directly) makes it explicit.$md$, 2
from kb_categories where name = 'Dashboards'
and not exists (select 1 from kb_entries where title = 'Reports — L&D Weekly Report (deck)');
