-- phase203 KB (2026-10-21): release moved to Friday 23 Oct and now includes
-- WBS UI Refresh 2.0. KB-0033 stays a DRAFT (is_active = false).
-- Release day: update kb_entries set is_active = true, updated_at = now() where article_number = 33;
-- Also archives the empty-state test project P-0119 (created for 2.0 screenshots).
do $$
declare v text; r record;
begin
  select content into v from kb_entries where article_number = 33;
  if position('### Phase progress and filters' in v) = 0 then raise exception 'KB-0033 anchor missing'; end if;
  insert into kb_entry_versions (entry_id, title, content, edited_by)
    select id, title, content, updated_by from kb_entries where article_number = 33;

  v := replace(v, 'The WBS is easier to read, with phase progress, filters, column views and a separate Timeline.',
                  'The WBS is cleaner: a short project summary on top, one Add task menu, compact phase rows with progress, filters, column views and a separate Timeline.');
  v := replace(v, 'A phase with no tasks yet shows a template button on its header (for example',
                  'Templates are under **Add task › Use template** and in a phase''s ⋯ menu while the phase has no tasks (for example');
  v := replace(v, '**Add module** creates one module''s chain',
                  '**Add module** (in the **Add task** menu, or the ⋯ menu on Design or Development) creates one module''s chain');

  v := replace(v, '## WBS

### Phase progress and filters
New projects show a card per phase with % done (real tasks only; milestones and cancelled tasks don''t count). Click a card to show only that phase. The toolbar has **Search**, Phase, Module, Status, Assignee and Work Type filters. While a filter is on, reordering and adding tasks are paused; **Clear** brings everything back.',
'## WBS

### A cleaner page
The top of the WBS is now a one-line summary: **Owner**, **Schedule** (start to forecasted end), **Estimated Effort** and **Baseline**. **Show more details** opens Project Information, the effort comparison and the bandwidth snapshot. In Draft, a tag tells you how many details are still needed before Start Project.

### One Add task menu
**Add task** opens one menu: add a task in any phase, **Add module**, or **Use template**. Each phase row also has a quiet ⋯ menu with the same actions for that phase, plus **Skip this phase** or **Include this phase** while the project is in Draft.

### Phase rows
Each phase is one compact row: the arrow on the left opens and closes it, then the phase number and name, task count and hours, % done (real tasks only; milestones and cancelled tasks don''t count) and the milestone on the right. Click a phase name to show only that phase; click it again to show all. Phases switched off for the project stay visible, greyed out. Milestone details (linked tasks, Link tasks) show under an open phase that has tasks.

### Filters
Search, Module, Assignee, Status and Work Type. While a filter is on, reordering and adding tasks are paused; **Clear** brings everything back.');

  v := replace(v, 'Tempo remembers your choice on your computer. Status on the WBS is read-only; change it from Tasks or the Next step buttons.
**Tip:** in Draft, use **Planning** to fill Work Type and Output Type before Start Project.',
'Tempo remembers your choice on your computer. Until you pick one, a Draft project opens on **Full** so Work Type and Output Type are visible before Start Project; other projects open on **Essential**. Status on the WBS is read-only; change it from Tasks or the Next step buttons.');

  update kb_entries set title = 'October 23 Release', content = v, is_active = false,
         updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now()
   where article_number = 33;

  -- Archive the 2.0 empty-state test project, as Sandra.
  perform set_config('request.jwt.claims', json_build_object('sub', 'c4131d85-871b-4d0d-b6eb-d160cef8fae0', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', 'c4131d85-871b-4d0d-b6eb-d160cef8fae0', true);
  set local role authenticated;
  for r in select id from projects where project_number = 119 and name = 'TEST – Empty WBS check (archive me)' and not coalesce(is_archived, false) loop
    perform public.archive_item('project', r.id, 'WBS 2.0 empty-state test project (21 Oct)');
  end loop;
end $$;
select article_number, title, is_active, length(content),
       position('One Add task menu' in content) > 0 as has_2_0,
       (select is_archived from projects where project_number = 119) as p119_archived
from kb_entries where article_number = 33;
