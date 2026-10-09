-- phase182 KB: top-of-chain extensions approved on confirm (KB-0032 + KB-0030).
do $$
declare v32 text; v30 text;
begin
  select content into v32 from kb_entries where article_number = 32;
  select content into v30 from kb_entries where article_number = 30;
  if position('### Shifted due dates' in v32) = 0 then raise exception 'KB-0032 anchor missing'; end if;
  if position('Log time tells you why' in v30) = 0 then raise exception 'KB-0030 anchor missing'; end if;
  if position('no one above you in the reporting line, your extension' in v32) > 0 then raise exception 'already applied'; end if;
  insert into kb_entry_versions (entry_id, title, content, edited_by)
    select id, title, content, updated_by from kb_entries where article_number in (30, 32);
  update kb_entries set content = replace(content, '### Shifted due dates', $q$#### If there's no one above you in the reporting line
If there's no one above you in the reporting line, your extension is approved as soon as you confirm it, whatever its size. Before it's sent, a confirmation shows the old and new due date and the number of working days, and flags it when you're asking for more than 2. Dependent tasks move with it, and it's recorded in the Audit Trail.

### Shifted due dates$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now()
  where article_number = 32;
  update kb_entries set content = replace(content, '- **Log time tells you why.**', $q$- **Extensions at the top of the reporting line.** If there's no one above you, your extension is approved as soon as you confirm it. The confirmation shows the new due date and flags requests of more than 2 working days. **Related article:** [[Auto-Approvals: What Tempo Approves Automatically]]
- **Log time tells you why.**$q$), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now()
  where article_number = 30;
end $$;
select article_number, position('no one above you in the reporting line, your extension' in content) > 0 as kb32, position('Extensions at the top of the reporting line' in content) > 0 as kb30 from kb_entries where article_number in (30,32);
