-- phase205 KB (2026-10-21): KB-0033 (October 23 Release, still a DRAFT) brought
-- in line with the final flow: scoping tasks on first save, modules inside
-- Design and Development, Add / Remove phase (Audit Trail), Next action column.
do $$
declare v text;
begin
  select content into v from kb_entries where article_number = 33;
  if position('### Next step buttons' in v) = 0 then raise exception 'KB-0033 anchor missing (Next step buttons)'; end if;
  insert into kb_entry_versions (entry_id, title, content, edited_by)
    select id, title, content, updated_by from kb_entries where article_number = 33;

  v := replace(v, 'In Draft, the owner picks the phases the project needs; they lock at **Start Project**.',
    'Remove a phase the project doesn''t need from its ⋯ menu (**Remove phase from project**) and add one back with **Add phase to project**. After **Start Project**, the owner, their supervisor or Full Access can still add or remove a phase (a phase that has tasks can''t be removed); the change is recorded in the Audit Trail as **Phase added / removed**.');

  v := regexp_replace(v, '### Task templates for each phase.*?(?=### Modules for design and build)',
'### Task templates for each phase
A new project starts with its **Analysis & Scoping** tasks already in place when it''s first saved: Discovery Call → Needs Analysis → Scope Statement → Review Scope → Scope Sign-Off, linked in order. **Implementation** and **Evaluation & Closure** templates are under **Add task › Use template** and in each phase''s ⋯ menu while the phase has no tasks; delete what the project doesn''t need. Work Types are suggested from the template; Output Types stay free to choose. Sign-offs use **Quality Assurance**, and **System Configuration** always counts as 1 output.

');

  v := regexp_replace(v, '### Modules for design and build.*?(?=## Reviews and completing tasks)',
'### Modules for design and build
Analysis & Scoping covers the whole project; Design and Development are worked module by module. On the Design row, **Add your first module** (later **Add module**, also in the **Add task** menu) asks for the module name and, optionally, the **Instructional Designer** and the **Content Developer**. It adds the module''s storyboard steps to Design (Design / Storyboard → Review · Design → Sign-Off · Design) and its build steps to Development (Build → Review · Build → Sign-Off · Build), linked in order. The storyboard waits for the Scope Sign-Off, and each build waits for its own design sign-off, so modules move independently. Every task name ends with the module name. **Group by Module** shows each module''s whole chain together; the Design Approved and Materials Approved milestones stay on the phases.

');

  v := replace(v, '### Next step buttons
On new projects, the **Next step** column shows what to do:',
'### Next action
On new projects, the **Next action** column shows only what **you** need to do: **Ready** when you can start, a button when it''s yours to finish or hand over, **Waiting on …** naming the task that has to finish first, and **With …** when your work is with a reviewer. Other people''s tasks show —. The buttons:');
  v := replace(v, 'Tasks still waiting on someone else''s task show **Waiting** and can''t be started yet.', '');

  v := replace(v, 'plus **Skip this phase** or **Include this phase** while the project is in Draft.',
                  'plus **Remove phase from project** or **Add phase to project**.');
  v := replace(v, 'Phases switched off for the project stay visible, greyed out.',
                  'Phases not included in the project stay visible, greyed out (**Not included in this project**).');
  v := replace(v, '- The column headers stay visible while you scroll.',
                  '- One scroll for the whole page; the column headers stay visible as you scroll down.');

  update kb_entries set content = v, is_active = false,
         updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now()
   where article_number = 33;
end $$;
select article_number, title, is_active,
       position('### Next action' in content) > 0 as next_action,
       position('Instructional Designer' in content) > 0 as modules,
       position('Phase added / removed' in content) > 0 as phases,
       position('Next step' in content) as leftover_next_step
from kb_entries where article_number = 33;
