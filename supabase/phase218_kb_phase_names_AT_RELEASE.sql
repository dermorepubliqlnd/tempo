-- phase218 KB -- RUN AT RELEASE, together with phase183b (phase rename).
-- Only two articles use the old phase names as phase names (the other
-- "Delivery" hits are "Training Delivery" / "Delivery risk", not phases).
insert into kb_entry_versions (entry_id, title, content, edited_by)
  select id, title, content, updated_by from kb_entries where article_number in (1, 14);
update kb_entries set content = replace(content,
    '{warning:Scoping}, {pink:Design}, {gold:Development}, {warning:Evaluation}, {accent:Delivery}',
    '{warning:Analysis & Scoping}, {pink:Design}, {gold:Development}, {accent:Implementation}, {warning:Evaluation & Closure}'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
 where article_number = 1;
update kb_entries set content = replace(content, 'Draft projects show **Scoping**', 'Draft projects show **Analysis & Scoping**'),
  updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6'
 where article_number = 14;
select article_number, position('Analysis & Scoping' in content) > 0 as renamed from kb_entries where article_number in (1, 14);
