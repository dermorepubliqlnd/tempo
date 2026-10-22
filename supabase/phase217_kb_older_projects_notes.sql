-- phase217 KB (2026-10-22): 'older projects only' notes where validation is described.
insert into kb_entry_versions (entry_id, title, content, edited_by) select id, title, content, updated_by from kb_entries where article_number in (7,6,10,32,15);
update kb_entries set content = regexp_replace(content, $re$## Validating Task Completion[^\n]*\n$re$, $rep$\&
{warning:Older projects only} Validation applies to projects created before 13 Oct 2026. On new L&D projects, finishing a task (Mark Done, Ready for Review, Pass QA or Approve) records today as the completion date and there's nothing to validate. See [[October 23 Release]].

$rep$), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6' where article_number = 7 and position($p${warning:Older projects only} Validation$p$ in content) = 0;
update kb_entries set content = regexp_replace(content, $re$### Closing the project \(WBS\)[^\n]*\n$re$, $rep$\&
{accent:New projects} Tasks are validated automatically when they're finished, so the validation check below only applies to older projects.

$rep$), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6' where article_number = 6 and position($p${accent:New projects} Tasks are validate$p$ in content) = 0;
update kb_entries set content = regexp_replace(content, $re$## Tasks: Terms & Columns[^\n]*\n$re$, $rep$\&
{accent:New projects} Reported Completion, Validated date, Validated By and the Validation grouping apply to older projects. On new projects a task's completion date is recorded automatically when it's finished, with no separate validation.

$rep$), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6' where article_number = 10 and position($p${accent:New projects} Reported Completio$p$ in content) = 0;
update kb_entries set content = regexp_replace(content, $re$### Task validation[^\n]*\n$re$, $rep$\&
{warning:Older projects only} New projects skip validation: finishing a task records the date and validates it automatically.

$rep$), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6' where article_number = 32 and position($p${warning:Older projects only} New projec$p$ in content) = 0;
update kb_entries set content = regexp_replace(content, $re$### Needs Attention \(current state\)[^\n]*\n$re$, $rep$\&
{accent:Note} Validation counts come from older projects only; tasks on new projects are validated automatically when they're finished.

$rep$), updated_at = now(), updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6' where article_number = 15 and position($p${accent:Note} Validation counts come fro$p$ in content) = 0;
select article_number, position('Older projects only' in content) > 0 or position('{accent:New projects}' in content) > 0 or position('{accent:Note} Validation' in content) > 0 as noted from kb_entries where article_number in (7,6,10,32,15) order by 1;
