-- phase144 KB (2026-10-04): cancelling your own feedback request.
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'Feedback & Requests';
update kb_entries set updated_at = now(), content = replace(replace(content,
'| **Declined** | Not going ahead; the response explains why |',
'| **Declined** | Not going ahead; the response explains why |
| **Cancelled** | Withdrawn by the person who submitted it |'),
'### For admins (Full Access)',
$md$### Cancel your request
Changed your mind? Click **Cancel** next to the status of your own request. You can only cancel while it's still **New**; once it's **Under review** or later, ask the admin in a new request instead. Cancelled requests stay visible with the status **Cancelled**.

### For admins (Full Access)$md$)
where title = 'Feedback & Requests' and content not like '%### Cancel your request%';
