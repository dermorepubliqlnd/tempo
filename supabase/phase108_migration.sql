-- Phase 108 (2026-09-24): KB "Maintained by" -> "Updated by". Sandra asked
-- for every existing article to show her as the updater; from now on the
-- app records whoever saves an article (kb_entries.updated_by, already set
-- on every save/create). updated_at is left untouched so "Last updated"
-- and Recently Updated keep their real dates.
update kb_entries
   set updated_by = (select id from people where email = 'sbarlao@dermorepubliq.com' limit 1)
 where not is_archived;
