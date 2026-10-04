-- phase139 KB (2026-10-04): Board card layout + Health board grouping.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries
where title in ('October 3–4, 2026', 'Projects & Tasks: Tabs and Views');

update kb_entries set updated_at = now(), content = replace(content,
'### Notes on projects and tasks',
$md$### Board cards are cleaner and easier to scan
Board cards now show what matters first. Choose up to **4 primary** properties (shown under the title) and **4 secondary** ones (a compact line), drag to reorder, and hide the rest. Empty values are skipped. A **coloured edge** shows Timing (tasks) or Health (projects), and finished columns start collapsed. The Projects board can also be grouped by **Health**.
→ *Projects & Tasks: Tabs and Views*

### Notes on projects and tasks$md$)
where title = 'October 3–4, 2026' and content not like '%Board cards are cleaner%';

update kb_entries set updated_at = now(), content = replace(content,
'### Long lists',
$md$### Board view cards
A board card is a short summary; use a table view when you want every column.

| Part of the card | What it shows | Counts toward the limit? |
|---|---|---|
| **Title** | Task or project name, with the 💬 notes bubble | No (always shown) |
| **Coloured left edge** | Tasks: Timing (red Overdue, amber Due soon, green on track/early). Projects: Health | No |
| **Warning chip** | "Overdue", "Due soon", "At risk"… only when something needs attention | No |
| **The board's column** | The grouped field (e.g. Status) is never repeated on the card | No |
| **Primary properties** | Up to **4**, one per line under the title | Yes |
| **Secondary properties** | Up to **4**, on one compact line | Yes |

**Defaults:** Tasks: primary Task ID, Project, Assignee, Due; secondary Scoped, Spent, Extension. Projects: primary Project ID, Owner, Due, Progress; secondary Scoped, Spent, Days Extended, Priority.

**Change the card:** on a board view, click the **Card layout** icon (top right). Move properties between **Primary**, **Secondary** and **Hidden**, or drag to reorder. When a section is full, Tempo tells you to remove one first. Each view keeps its own card layout, separate from the table's columns. Empty values (no assignee, 0 hours, "No Extension") aren't shown.

**Columns:** **Complete / Cancelled** (tasks) and **Done / Completed / Cancelled / Closed** (projects) start collapsed; click a collapsed column to open it, or **‹** on a column header to collapse it. The Projects board can be grouped by Phase (default), Status, **Health**, WBS Status, Owner, Priority, Planning Type, Project Type, Category, Source or Complexity.

### Long lists$md$)
where title = 'Projects & Tasks: Tabs and Views' and content not like '%### Board view cards%';
