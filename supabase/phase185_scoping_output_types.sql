-- phase185 (2026-10-13, Sandra): clearer scoping outputs.
-- New Output Types "Needs Analysis (TNA)" and "Scope Document" (count as
-- deliverables), linked to Work Type "Learning Design & Analysis"; also links
-- "Discovery Call" to "Project Management" (used by the scoping template).
-- Scoping template now produces 3 outputs: Discovery Call -> TNA -> Scope Document.

insert into public.output_types (name, sort_order, is_active, color, counts_deliverable)
select v.name, (select coalesce(max(sort_order), 0) from public.output_types) + v.n, true, 'accent', true
  from (values ('Needs Analysis (TNA)', 1), ('Scope Document', 2)) as v(name, n)
 where not exists (select 1 from public.output_types o where o.name = v.name);

insert into public.work_type_output_types (work_type_id, output_type_id)
select w.id, o.id
  from (values ('Learning Design & Analysis', 'Needs Analysis (TNA)'),
               ('Learning Design & Analysis', 'Scope Document'),
               ('Project Management', 'Discovery Call')) as v(wt, ot)
  join public.work_types w on w.name = v.wt
  join public.output_types o on o.name = v.ot
 where not exists (select 1 from public.work_type_output_types m where m.work_type_id = w.id and m.output_type_id = o.id);

update public.task_templates set output_type_name = 'No Deliverable/Activity Only' where template_key = 'scoping' and ref in ('1.2a', '1.2b');
update public.task_templates set output_type_name = 'Needs Analysis (TNA)'         where template_key = 'scoping' and ref = '1.2c';
update public.task_templates set output_type_name = 'Scope Document'               where template_key = 'scoping' and ref = '1.3';
