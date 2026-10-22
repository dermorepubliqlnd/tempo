-- phase219 KB (2026-10-22): KB-0004 (permissions) and KB-0022 (WBS) brought up to date.
insert into kb_entry_versions (entry_id, title, content, edited_by)
  select id, title, content, updated_by from kb_entries where article_number in (4, 22);

update kb_entries set content =
  regexp_replace(
    replace(replace(content,
      '| Open the **Recycle bin** (Archive) |', '| Open the **Archive** |'),
      '| Restore from the Archive | {success:Yes} if they archived it | {neutral:—} | {neutral:—} | {success:Yes} |',
      '| Restore from the Archive (one or many at once) | {success:Yes} if they archived it | {neutral:—} | {neutral:—} | {success:Yes} |
| Delete permanently from the Archive (one or many) | {neutral:—} | {neutral:—} | {neutral:—} | {success:Yes} |'),
    $re$(- Deleting anything in Tempo moves it to the \*\*Archive\*\*\.[^\n]*\n)$re$,
    $rep$\1- **Full Access** can also **Delete permanently** from the Archive, one item or many at once, after a warning. It can't be undone.
$rep$),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
 where article_number = 4 and position('Delete permanently from the Archive' in content) = 0;

update kb_entries set content =
  regexp_replace(
    replace(content,
      $a$| **Add sub-task / Add task below** | In a started project you'll be asked for an assignee. |$a$,
      $b$| **Add sub-task / Add task below** | In a started project you'll be asked for an assignee. On new projects, Design and Development tasks and review or sign-off steps can't have sub-tasks: use one module per deliverable. |
| **Add review steps…** | Adds a Review (and a Sign-Off) right below the task, already linked. |$b$),
    $re$(### Draft plans are private until Start Project)$re$,
    $rep$### Reviews, Work Types and Output Types (new projects)
- A task with Work Type **Quality Assurance** is a review; **Sign-Off** is a final approval. Tempo asks which task it checks.
- Removing the last link from a review or sign-off opens **Update dependency**: link it to another task, or change it to a regular task.
- If you change a Work Type and the Output Type doesn't belong to it, Tempo asks you to pick one that does.
- Design and Development are planned as **one module per deliverable** (**Add module**). Each module header shows its status: Not Started, In Design, In Development, Sent back or Complete.

### Order and dates
- Tasks linked with **Depends on** follow their links, wherever the row sits.
- On new projects, unlinked tasks for the same person follow their order in the WBS. Move a row, then click **Refresh Dates** to save the new starts.
- Different people's unlinked tasks run side by side.

\1$rep$),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
 where article_number = 22 and position('### Order and dates' in content) = 0;

select article_number, position('Delete permanently from the Archive' in content) > 0 as perm, position('### Order and dates' in content) > 0 as wbs, position('Add review steps' in content) > 0 as rv, position('Recycle bin' in content) as recycle from kb_entries where article_number in (4, 22) order by 1;
