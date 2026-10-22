-- phase210 (2026-10-22, UAT requests): Implementation template
-- * Upload to LMS comes first; Train-the-Trainer / Facilitator Walkthrough waits on it.
-- * "Litmos" is called "DermoU" in templates (and the KB-0033 draft).
-- New projects only; existing tasks keep their names and links.
update public.task_templates set sort_order = 5, depends_on_refs = '{}'
 where template_key = 'delivery' and ref = 'D5';
update public.task_templates set depends_on_refs = '{D5}'
 where template_key = 'delivery' and ref = 'D1';
update public.task_templates set depends_on_refs = '{D4}'
 where template_key = 'delivery' and ref = 'D6';
update public.task_templates
   set name = replace(name, 'Litmos', 'DermoU'),
       description = replace(description, 'Litmos', 'DermoU')
 where name ilike '%litmos%' or description ilike '%litmos%';
-- KB-0033 (still a draft): same wording, plus the Planning -> Standard view name.
update public.kb_entries
   set content = replace(replace(replace(content, 'Litmos', 'DermoU'), '**Planning** (adds', '**Standard** (adds'), '**Planning**', '**Standard**'),
       updated_at = now()
 where article_number = 33;
select ref, sort_order, name, depends_on_refs from task_templates where template_key = 'delivery' order by sort_order;
