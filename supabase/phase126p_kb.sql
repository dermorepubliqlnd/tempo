-- phase126p KB: "Work complete" health -> "Done on time/late · close pending"; Needs Attention section in Team Dashboard entry.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where content like '%{success:Work complete}%' or title = 'Team Dashboard (L&D Executive Dashboard)';
update kb_entries set updated_at = now(), content = replace(content,
  '→ {success:Work complete} (set Status to Completed)',
  '→ {success:Done on time · close pending} or {gold:Done late · close pending} (last task completion vs End Date, same rule as Completed on time/late). The owner sees a "Projects at 100% — mark Completed" reminder on My Dashboard, with how long ago the last task was done.')
 where content like '%{success:Work complete}%';
update kb_entries set updated_at = now(), content = replace(content, '### Data start date: September 1, 2026', $md$### Needs Attention (current state)
Tinted cards in four tiers; click any card for the list behind it.
| Tier | Card | Definition |
|---|---|---|
| Capacity risk | Overallocated | >100% planned on 1+ working day, next 2 weeks |
| Capacity risk | Underloaded | <50% planned over the next 2 weeks |
| Delivery risk | Overdue projects | Active projects with Health = Overdue |
| Delivery risk | At-risk projects | Health = At risk or Off track |
| Delivery risk | Overdue tasks | Open tasks past Target Due Date (paused projects excluded) |
| Delivery risk | Paused / needs review | Paused past expected resume date, or Schedule Review pending |
| Decisions waiting | Pending approvals | Time logs, extensions, Start Project and close requests; "aging" = 2+ working days |
| Decisions waiting | Validations overdue | Done tasks not validated 2+ working days after Reported Completion |
| Closure and hygiene | Complete, ready to close | All tasks Done (100%) but Status still In Progress — mark Completed, then close |
| Closure and hygiene | Ready to close | Status Completed, WBS not closed yet |
| Closure and hygiene | Missing hours | Members below expected hours on completed working days this week |
| Closure and hygiene | Planning gaps | Open tasks in started projects with no Assignee or Scoped Hours |

### Data start date: September 1, 2026$md$)
 where title = 'Team Dashboard (L&D Executive Dashboard)' and content not like '%### Needs Attention (current state)%';
select 'X' t, (select count(*) from kb_entries where content like '%close pending}%') health_kb, (select content like '%### Needs Attention (current state)%' from kb_entries where title = 'Team Dashboard (L&D Executive Dashboard)') na_kb;
