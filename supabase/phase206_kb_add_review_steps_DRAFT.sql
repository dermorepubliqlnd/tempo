-- phase206 KB (2026-10-21): KB-0033 (still a DRAFT) -- Add review steps.
do $$
declare v text;
begin
  select content into v from kb_entries where article_number = 33;
  if position('### Next action' in v) = 0 then raise exception 'KB-0033 anchor missing (### Next action)'; end if;
  if position('### Add review steps' in v) > 0 then return; end if;
  insert into kb_entry_versions (entry_id, title, content, edited_by)
    select id, title, content, updated_by from kb_entries where article_number = 33;
  v := replace(v, '### Next action',
'### Add review steps
Any task you add yourself can get its review from the task''s ⋯ menu: **Add review steps** › **Review** or **Review + Sign-off**. Pick the reviewer (default: the assignee''s supervisor) and who signs off (default: the project owner). Tempo adds "Review · {task}" (and "Sign-Off · {task}") right below it, in the same phase and module, linked in order. Anything that waited on the task now waits on the last new step. The task''s owner then gets **Ready for Review** instead of Mark Done. No need to type "Review" or link anything yourself.

### Next action');
  update kb_entries set content = v, is_active = false,
         updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now()
   where article_number = 33;
end $$;
select article_number, is_active, position('### Add review steps' in content) > 0 as added from kb_entries where article_number = 33;
