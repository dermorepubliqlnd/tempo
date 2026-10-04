-- phase141 KB (2026-10-04): Feedback & Requests page.
insert into kb_categories (name, sort_order) values ('Feedback', 8) on conflict (name) do nothing;

insert into kb_entries (category_id, title, content, sort_order)
select id, 'Feedback & Requests', $md$## Feedback & Requests

Have an idea to make Tempo better, or something that's confusing? Share it on the **Feedback** page (sidebar). Everyone can see every request, its status, and the admin's response, so you can check whether an idea is already being considered before adding it.

### Submit a request
1. Click **Feedback** in the sidebar, then **Submit a request**.
2. Your **name** and the **submitted date** are added automatically.
3. Write a short **Subject** (up to 150 characters), e.g. "Add a due-date filter to My Tasks".
4. Add the **Details**: what you'd like to change, why it would help, and the page or an example if you can.
5. Click **Submit**. Your request gets an ID like **FB-0007**.

### Follow a request
- Click any row to read the full details and the **admin response**. Rows with a reply show a **Responded** tag.
- Use **All requests** / **My requests**, the search box, or click a status card to filter.

| Status | Meaning |
|---|---|
| **New** | Just submitted, not reviewed yet |
| **Under review** | Being looked at |
| **Planned** | Accepted and scheduled |
| **Done** | Shipped (check the Release Notes) |
| **Declined** | Not going ahead; the response explains why |

### For admins (Full Access)
Change the **Status** from the dropdown on each row, and open a row to **post or update a response**. Your name and the date are shown with the response.
$md$, 0 from kb_categories where name = 'Feedback'
and not exists (select 1 from kb_entries where title = 'Feedback & Requests');

insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries where title = 'October 3–4, 2026';
update kb_entries set updated_at = now(), content = replace(content,
'### Automatic sign-out at 10:00 PM',
$md$### Share your ideas on the new Feedback page
A **Feedback** page in the sidebar lets anyone submit an enhancement request (subject and details; your name and date are added for you), see everyone's requests and their status, and read the admin's response.
→ *Feedback & Requests*

### Automatic sign-out at 10:00 PM$md$)
where title = 'October 3–4, 2026' and content not like '%new Feedback page%';
