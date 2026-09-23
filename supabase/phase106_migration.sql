-- Phase 106 (2026-09-24): Knowledge Base -- Access & Permissions matrix
-- (Sandra: "add the permission rights in the knowledge base, in matrix
-- form; for direct manager / one up use the term Immediate Supervisor").

insert into kb_categories (name, sort_order) values ('Access & Permissions', 3)
on conflict (name) do nothing;

insert into kb_entries (category_id, title, content, sort_order)
select id, 'Approval Rights & Permissions Matrix', $md$## Approval Rights & Permissions Matrix

Who can approve what, and who can do what, across Tempo. Approval authority comes from four sources that already exist in the app — no separate "approver" flag is needed:

- **Full Access** — set in User Management.
- **Approval Rights** — the **Re-baseline** and **Project Close** checkboxes in User Management.
- **Project Owner** — the person set as a project's owner.
- **Immediate Supervisor** — the person someone reports to in User Management. If that person is inactive, the next active supervisor up the chain takes over.

### Ground rules
- Nobody approves their own request. The only exception is someone with no active Immediate Supervisor above them at all.
- **Approval Center** only appears in the menu for people with approval authority: Full Access, either Approval Right, owner of an active project, or Immediate Supervisor of at least one active person.
- Inside Approval Center, everyone sees only the requests they can decide. **Other pending approvals** (requests someone else must decide) is visible to Full Access only.

### Approvals — who decides each request

| Request | Immediate Supervisor | Project Owner | Full Access | Approval Right needed |
|---|---|---|---|---|
| **Task due-date extension** | Of the project owner, when the owner raised it | {success:Yes} when someone else raised it | {success:Yes} | {neutral:—} |
| **Project timeline extension** | Of the project owner | {neutral:—} | {success:Yes} | {neutral:—} |
| **Project time entry** (manual log) | Of the project owner, when the owner logged it | {success:Yes} when someone else logged it | {success:Yes} | {neutral:—} |
| **Non-project time entry** | Of the person who logged it | {neutral:n/a} | {success:Yes} | {neutral:—} |
| **Time correction request** | Of the person requesting | {success:Yes} unless they are the requester | {success:Yes} | {neutral:—} |
| **Task completion validation** | Of the assignee | {success:Yes} | {success:Yes} | {neutral:—} |
| **Baseline approval** (Start Project / Re-baseline) | {neutral:—} | {neutral:—} | {danger:No} unless they also hold the right | {accent:Re-baseline} |
| **Project close** | {neutral:—} | {neutral:—} | {success:Yes} | {accent:Project Close} (or Full Access) |

### Actions — who can do what

| Action | Everyone (own items) | Immediate Supervisor | Project Owner | Full Access |
|---|---|---|---|---|
| Log time (timer or manual) | {success:Yes} | {neutral:—} | {neutral:—} | {success:Yes} |
| Edit or delete a **pending/rejected** manual time entry | {success:Yes} (logger or requester) | {neutral:—} | {neutral:—} | {success:Yes} |
| Request a correction on a **confirmed/approved** entry | {success:Yes} | {neutral:—} | {neutral:—} | Corrects directly instead |
| Correct a confirmed/approved entry directly | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |
| Plot time off (Off / Half day) | {success:Yes} | {success:Yes} for direct reports | {neutral:—} | {success:Yes} for anyone |
| Holiday Calendar | View only | View only | View only | {success:Add / edit / delete} |
| Delete (archive) a project | {neutral:—} | {neutral:—} | {success:Yes} | {success:Yes} |
| Delete (archive) a task | {neutral:—} | {neutral:—} | {success:Yes} (not on closed projects) | {success:Yes} (not on closed projects) |
| Delete (archive) a time entry | Pending/rejected manual entries only | {neutral:—} | {neutral:—} | {success:Yes} incl. confirmed/approved |
| Delete (archive) Knowledge Base, Settings lists, holidays | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |
| View the Archive | {success:Yes} | {success:Yes} | {success:Yes} | {success:Yes} |
| Restore from the Archive | {success:Yes} if they archived it | {neutral:—} | {neutral:—} | {success:Yes} |
| Edit the Knowledge Base | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |
| User Management and Site Settings | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |

### Notes
- Deleting anything in Tempo moves it to the **Archive**. It can be restored for 90 days, then it is removed automatically. A project takes its tasks and their time entries with it; a parent task takes its sub-tasks and their time entries.
- The one exception is **Delete permanently** in User Management, for mistaken accounts with no history. Everyone else is deactivated instead.
- To change who can approve, update the person's **Reports to**, **Access level**, or **Approval Rights** in User Management, or the project's **Owner**.
$md$, 1
from kb_categories where name = 'Access & Permissions'
  and not exists (select 1 from kb_entries e join kb_categories c on c.id = e.category_id
                   where c.name = 'Access & Permissions' and e.title = 'Approval Rights & Permissions Matrix');
