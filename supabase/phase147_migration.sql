-- phase147 (Sandra, 2026-10-04): permanent KB article numbers (KB-0001).
-- Backfilled oldest-first; new articles take the next number; never reused.
alter table kb_entries add column if not exists article_number integer;
create sequence if not exists kb_article_number_seq;
with ordered as (
  select id, row_number() over (order by created_at, id) as rn from kb_entries where article_number is null
)
update kb_entries e set article_number = o.rn + coalesce((select max(article_number) from kb_entries), 0)
from ordered o where e.id = o.id;
select setval('kb_article_number_seq', coalesce((select max(article_number) from kb_entries), 0) + 1, false);
alter table kb_entries alter column article_number set default nextval('kb_article_number_seq');
create unique index if not exists kb_entries_article_number_key on kb_entries(article_number);
