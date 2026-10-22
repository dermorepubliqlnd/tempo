-- phase216 KB (2026-10-22): KB-0033 rewritten as a one-screen What's new (still a draft).
insert into kb_entry_versions (entry_id, title, content, edited_by)
  select id, title, content, updated_by from kb_entries where article_number = 33;
update kb_entries set content = $kb$**New projects now follow one simple flow:** scope it, plan it, start it, then pass work along with one button. Projects created before 13 Oct work as before.

{{guide:project-lifecycle}}

## What changed, and what you do

**1. Five phases, scope first.** New projects run Analysis & Scoping → Design → Development → Implementation → Evaluation & Closure. The scoping tasks appear as soon as you save the project.
*What you do:* remove any phase the project doesn't need (phase ⋯ menu).

**2. One module per deliverable.** Each e-learning, job aid or assessment is its own module, with its own storyboard, build, review and sign-off, so each one moves on its own.
*What you do:* click **Add module** on the Design row. The module header shows where it is: In Design, In Development or Complete.

**3. Reviews follow the Work Type.** A task set to **Quality Assurance** is a review; **Sign-Off** is the final approval. Templates and modules already set these.
*What you do:* when you add your own review, set its Work Type and pick the task it checks, or use **⋯ › Add review steps**.

**4. Next action tells you what to do.** **Ready** means you can start. **Waiting on…** means someone else goes first. **With…** means your work is with a reviewer.
*What you do:* log time on a Ready task to start it; your button appears.

**5. Finishing is one click.** Click the button in Next action: **Ready for Review**, **Mark Done**, **Pass QA** or **Approve**. Tempo records today as the completion date, and there's nothing to validate. A message confirms who has it next.
*What you do:* finish tasks on the day you finish them.

**6. Sending work back.** Reviewers and approvers click **For Revision** and add a comment. The work goes back to the person who did it. They fix it and click **Resubmit**, and it goes straight back to whoever sent it.
*What you do:* read the comment on the For Revision tag before you resubmit.

**7. A cleaner WBS.** A short summary on top, phase cards you can click to filter, one **Add task** menu and three column views: **Essential**, **Standard** and **Full**. Changing a Work Type asks for a matching Output Type.

**8. Smaller things.** Ctrl+click or Shift+click to select several rows. In Progress is amber everywhere. The Archive can restore many items at once, and Full Access can delete permanently. In templates, Litmos is now **DermoU**, and Upload to DermoU comes first in Implementation.

## Want the detail?
- Planning a project: [[WBS: Building & Editing Tasks]]
- Who can do what: [[Approval Rights & Permissions Matrix]]
$kb$, is_active = false, updated_by = 'e7e52a30-4c13-449b-889d-280dc0ca16c6', updated_at = now()
 where article_number = 33;
select article_number, is_active, length(content) from kb_entries where article_number = 33;
