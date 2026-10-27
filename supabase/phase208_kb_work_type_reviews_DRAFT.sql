-- phase208 KB (2026-10-22): KB-0033 (still a DRAFT) -- Work Type decides review steps.
do $$
declare v text;
begin
  select content into v from kb_entries where article_number = 33;
  if position('### Add review steps' in v) = 0 then raise exception 'KB-0033 anchor missing (### Add review steps)'; end if;
  if position('### Review steps are set by Work Type' in v) > 0 then return; end if;
  insert into kb_entry_versions (entry_id, title, content, edited_by)
    select id, title, content, updated_by from kb_entries where article_number = 33;
  v := replace(v, '### Add review steps',
'### Review steps are set by Work Type
The Work Type tells Tempo what a task is: **Quality Assurance** is a review (the reviewer gets **Pass QA** / **For Revision**), **Sign-Off** is the final approval (**Approve** / **For Revision**), and any other work type is ordinary work. When you set a task to Quality Assurance or Sign-Off, Tempo asks **which task it checks** and links them; the task saves only once you pick one. Sign-Off fills in its Output Type (No Deliverable/Activity Only) for you. Deleting a review or sign-off step re-links the chain, so the next step and the milestone wait on the step before it.

### Add review steps');
  update kb_entries set content = v, is_active = false,
         updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now()
   where article_number = 33;
end $$;
select article_number, is_active, position('### Review steps are set by Work Type' in content) > 0 as added from kb_entries where article_number = 33;
