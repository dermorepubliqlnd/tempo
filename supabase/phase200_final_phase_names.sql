-- phase200 (2026-10-14, Sandra): final phase names -- Analysis & Scoping, Design,
-- Development, Implementation, Evaluation & Closure. Labels only (used by the
-- new-lifecycle WBS); project Phase values are renamed at release by phase183b
-- (updated the same day: only Scoping, Delivery and Evaluation are renamed).
-- Applied in Supabase 2026-10-14.
update public.lifecycle_phases set label = case key
  when 'analysis' then 'Analysis & Scoping'
  when 'design' then 'Design'
  when 'development' then 'Development'
  when 'delivery' then 'Implementation'
  when 'evaluation' then 'Evaluation & Closure'
  else label end;
update public.task_templates set template_name = 'Implementation' where template_key = 'delivery';
