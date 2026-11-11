# CLAUDE.md — Tempo

Read this first in every Tempo session. It explains how Tempo is built, the rules currently live, how releases work, and what's parked. **Keep it current** (see "Maintaining this file" at the bottom).

Last updated: 11 Nov 2026 (My Work Complete action LIVE, main = tempo-preview; no SQL; see section 7 item 7). New GitHub key received 11 Nov (not stored anywhere). Previous: 10 Nov (weekly report pptx fix LIVE, commit 5d975ca). Before that: 30 Oct (KB clean-up LIVE: 34 → 19 articles; phase232 + phase232b). Before that: 27 Oct (completion rules, My Dashboard refresh, Tasks views, utilization fix, KB-0034 + KB sweep; phase231).

---

## 1. Working with Sandra

- Sandra Barlao, L&D Director, is the product owner and approves every release. She is not a developer: explain in plain language, lead with the outcome, keep it short.
- **Never deploy to live, push to `main`, or run SQL that changes live data without her explicit "go".**
- Before changing anything, inspect how it works now. Don't assume. Flag conflicts with existing guardrails instead of overriding them.
- Prefer the smallest, safest change. Reuse existing functions, triggers and fields over parallel mechanisms.
- Releases are on **Fridays**.

## 2. Where everything lives

| Layer | Location | Notes |
|---|---|---|
| Live app | https://dermorepubliqlnd.github.io/tempo/ | Built from `main` |
| Preview app | https://dermorepubliqlnd.github.io/tempo/preview/ | Built from `tempo-preview`. **Uses the SAME live database.** Sends header `x-tempo-channel: preview` |
| Source code | github.com/dermorepubliqlnd/tempo | Package name is still `capaciq` |
| Backend | Supabase project `cwbpynyiknmktnvtoggs` (Free plan, ap-southeast-1) | Postgres + Auth + Edge Functions + pg_cron |
| This folder | OneDrive `L&D Apps/Tempo` | SQL phase files, briefs, guides, test steps (see section 8) |

Full detail: `TEMPO_SYSTEM_MAP.md` (written 13 Oct 2026; stack, deploy flow, routes, cron jobs, Edge Functions).

**Stack:** React 18 + React Router (HashRouter) + Vite + TypeScript, static build on GitHub Pages. `@supabase/supabase-js`, `pptxgenjs` + `jszip`, `lucide-react`. **No CDN script tags** (the corporate Edge network blocks them).

**Deploy:** push to `main` runs `deploy.yml`, which builds `/tempo/` and `/tempo/preview/`. Push to `tempo-preview` re-triggers it.

## 3. Database change conventions

- Changes are **hand-run SQL files**: `sql/phaseNN_short_name.sql`. Supabase tracks no migrations, so these files are the only record. **Latest: phase232b (run 30 Oct). Next: phase233.**
- Each file starts with a comment header: `-- phaseNN (YYYY-MM-DD, Sandra): what and why`.
- Suffixes:
  - `_DRAFT`: Knowledge Base article kept hidden (`is_active = false`) until release
  - `_AT_RELEASE` / `_RELEASE_<date>`: run only on release day, together with the matching `main` code
  - `_dryrun_tests`: runs in one transaction and rolls back; nothing saved
- Additive and safe-while-live by default. New behaviour is usually limited to **new-flow projects** (see below).
- **Preview-only gating:** a rule can check the `x-tempo-channel: preview` header so it only applies on preview. Remove the check at release and note "RELEASED <date>" in the file.
- Because preview shares the live database, test with UAT/test projects only. No uncontrolled writes to real records.
- Knowledge Base articles live in `kb_entries`. Each release has a "What's new" article (Oct 23 release = KB-0033; Oct 28 release, task completion rules = KB-0034, phase229). Writing standard: `briefs/Knowledge_Base_Framework.md` (target ≈ 18–19 articles; merge or retire before adding).
- Titles are unique per KB topic (`kb_entries_category_title_key`), so a draft of an existing article needs a different title (" (draft)").
- KB numbers come from a sequence that never rolls back: dry runs that insert articles use up numbers (KB-0035 to 0037 were used up this way on 30 Oct). Draft copies of existing articles use 900 + the article number to avoid this.
- Running SQL from the browser: on the Supabase dashboard tab, Claude reads the file into the page with a file input and posts it to the dashboard's own query endpoint (no SQL editor typing).

## 4. Key concepts (glossary)

| Term | Meaning |
|---|---|
| **New-flow project** | `projects.lifecycle_version = 2`, created on/after 13 Oct 2026. Most new rules apply only to these. Older projects (e.g. P-0117, P-0127) keep the old behaviour |
| **Ongoing container** | `projects.is_operational = true` (e.g. P-0079 Training Delivery H2 2026, P-0095). Looser task-adding rules |
| **Project Stage** | Draft → Awaiting Start → Active → Closing → Closed, plus Paused / Cancelled. Changes only via Start/Pause/Resume/Cancel/Close requests (trigger `a_project_lifecycle`) |
| **Phase** | Analysis & Scoping · Design · Development · Implementation · Evaluation & Closure (`tasks.wbs_phase`). Phases can be skipped/restored; changes logged in Audit Trail |
| **Phase lock** | While Analysis & Scoping is in the project, no task can be added to later phases until every scoping task (incl. Scope Sign-Off) is Done (phase221) |
| **Work Type** | Drives hand-off buttons. **Quality Assurance** = review step (Pass QA / For Revision). **Sign-Off** = final approval (Approve / For Revision) |
| **Check task** | A QA or Sign-Off task, or work that an open QA/Sign-Off task depends on. Function: `public.r2_is_check_task(task_id)` |
| **Module** | Design → Review → Sign-off → Build → Review → Sign-off chain, added via `r2_add_module`. Reviewer = maker's supervisor, else project owner |
| **Templates** | `task_templates`: Analysis & Scoping, delivery (Implementation), evaluation. Applied with `r2_apply_template`. "Litmos" is called **DermoU** |
| **Dates** | `original_due_date` is set at Start Project and never moves. `current_due_date` moves via approved `extension_requests` or a late-finish shift |
| **Roles** | `app_roles`: one role per person; sets sidebar pages, views and approval rights. Access levels include Full Access and Limited |

## 5. Business rules currently live

### Task completion and validation (new-flow projects)

- When a task becomes **Done**, the DB sets `actual_completion_date` = today (Manila), plus `submitted_on` / `submitted_by`. Nobody types a date; the pop-up shows "Set on submission". Trigger: `trg_r2_auto_complete` (phase215).
- **Validation:**
  - Check tasks (QA/Sign-Off steps, and work they check) → **automatic**: `validated_completion_date`, `validated_by`, `auto_validated = true`
  - Tasks with **no review after them** (e.g. Discovery Call, or an L&D task whose dependent is another non-review task) → **manual validation** in the Approval Center (phase222)
- **Completion rules (phase228, live 27 Oct 2026, ALL projects, Done from then on; no backfill).** Trigger `zzzzz_completion_rules` (`trg_completion_rules`) runs last on status → Done, for a person's action only (skips system jobs, parent tasks, closed projects, tasks with no due date, and new-flow review-chain tasks, which keep the rules above). Draft projects: system date only, no classification.
  - Early (before due) → today; **manual validation** (Approval Center)
  - On the due date → today; On Time, auto-validated at once
  - Grace window (after due, up to the next business day, holidays skipped via `next_working_day`): the app asks "Was this task completed by its due date?" and sends `completion_grace_answer`. Yes → `actual_completion_date` = due date (so the phase226 shift doesn't move dependents), `completion_timing = 'grace_on_time'`. No → today, Late
  - Later → today; Late, auto-validated at once
  - Logged late (phase198 `late_log_kind = 'logged_late'`: created after its due date) → due date, On Time, auto-validated; the phase198 >3-working-day confirmation still applies
  - Classification in `tasks.completion_timing` (early / on_time / grace_on_time / late / logged_late); cleared when the task leaves Done. Real click time stays in `submitted_on`; the original completion event stays in `task_review_events`
  - The app never sends a typed date: the Complete task pop-up shows banners (mock-ups 1–4) and the Reported Completion column is display-only
  - Auto-validated tasks lock at once, so reopening goes through `reopen_task` (Full Access / Status column), the same as late completions before
  - `auto-validations-daily` cron is unchanged and only picks up unvalidated tasks (completions from before 27 Oct still flow through it). Early completions never match it
- Before 27 Oct, older projects had the completion date entered by hand, then validated manually. Those records are unchanged.

### For Revision and resubmission

- `r2_return_task` sets the work task back to In Progress, clears completion and validation fields, adds 1 to `revision_count`, logs `returned` in `task_review_events`.
- The returning review/sign-off step **stays In Progress** (phase212).
- From a Sign-Off, work goes back to the **doer**. Review steps in between stay Done; the loop is approver ↔ doer (phase214).
- Resubmission sets a new completion date and logs `completed`. Use the latest `completed` event.

### Time-log guardrails (new-flow projects)

- Doer resubmitting needs time logged after the task came back (phase222).
- Reviewer/approver needs review time logged before Pass QA / Approve / For Revision. After a resubmission, only time logged since then counts (phase225, phase227).

### Reopen guardrails (phase191)

- Once a later step built on a task is Done, nobody can move the task off Done. The only way back is For Revision.
- A finished hand-off can only be reopened by Full Access, the project owner, or someone above the assignee. Not the assignee.

### Scheduling

- **Late-finish shift** (phase226): a task Done after its `current_due_date` moves its dependents to the next working day after the actual finish, keeping their working-day length. Logged in `task_schedule_shifts`; shown as "Shifted". Started projects only.
- **Logged late** (phase198): a task whose due date is before the day it was created. Done within 3 working days of due → no approval; older → owner/manager/Full Access confirms.
- **Note:** the phase198 working-day helper counts **Mon–Fri only, no holidays**. Holidays are managed on the Time Off & Holidays page. Check before reusing for any business-day rule.

### Permissions (phase190/190b/197)

- Normal projects: only the owner, owner's direct supervisor or Full Access can add tasks or change a task's plan. Assignees keep execution updates (status, completion, outputs, notes).
- Ongoing containers: anyone can add a task for themselves (or their manager on their behalf); the assignee can edit their own task's dates until the due date passes.

### Utilization history of deleted work (phase230)

- `deleted_person_day_hours` keeps the planned hours of deleted tasks on past days so utilization history survives (`archive_task_utilization`).
- **Manual permanent delete** from the Archive (`purge_archive_items`) no longer keeps that history: it means "it never happened" (test data, mistakes). The 90-day auto-expiry (`purge_expired_archive`) still keeps it.
- 27 Oct clean-up: removed 7–23 Oct rows for Sandra, Nikki, Joseph and Princess (UAT test projects, ≈645h), which caused "Utilization This Week 1438%". Fritzie, Gemmabelle and Khim rows kept.

### Weekly report (pptx) fix (live 10 Nov 2026, commit 5d975ca)

- Bug: when a role's **Next week** planned utilization was over 100% (red bar on Team Utilization), `patchChartXml` in `src/lib/weeklyReport/deck.ts` also inserted the red `<c:dPt>` before the chart-level `<c:dLbls>` after the last series. PowerPoint rejected the file ("found a problem with content", Repair does nothing). Hit the 26–30 Oct and 2–6 Nov reports.
- Fix: only patch `<c:dLbls>` inside a `<c:ser>`. Patch copy: `briefs/fix_weekly_report_red_bar_2026-11-04.patch`.
- Debug tip: unzip the pptx and validate `ppt/charts/*.xml` against `dml-chart.xsd` (pptx skill schemas). The usual pptxgenjs `axId`/`varyColors` order errors are harmless; any other error is the suspect.

### Time and approvals

- Auto-approval: entry under 2h, within 2 working days, within the 5h weekly allowance. Top of the reporting line is auto-approved.
- Timers stop automatically at 10pm and after idle time.
- Non-project time can be moved to a project task via correction (phase202).

## 6. App pages

My Dashboard `/` · Team (Executive) Dashboard · Projects & Tasks · Project Overview · WBS Planning `/projects/:id/wbs` · Audit Trail · Time Tracking · Approval Center · Utilization · Productivity `/hours-overview` · Time Off & Holidays · Knowledge Base · Archive · Feedback · User Management `/admin` · Reports (L&D Weekly Report pptx) · Site Settings.

**My Dashboard (refresh live 27 Oct, see section 7 item 6 and `briefs/Tempo_Dashboard_Refresh_Brief.md`):** KPI row (My Active Projects · Tasks Needing Action · Overdue Tasks · Pending Requests · Utilization This Week · Logged Hours This Week) · Awaiting My Approval · Needs My Attention · **My Work** (tabs Needs Action [Overdue + Next 7 business days] · Next 2 Weeks · Later · Waiting) | Recent Updates over My Projects · Utilization · Logged Hours · Effort vs Estimate · My Requests · Deliverable Progress. The window is today plus business days until 7 are covered (today counts; weekends and holidays skipped) via `nextBusinessDaysWindow` / `isDueBetween` in `lib/metrics.ts`, sorted by due date; Done tasks (incl. awaiting validation) are excluded. Utilization / Hours Logged / Missing hours stay weekly. **Since 11 Nov:** each My Work row has a green ✓ Complete button that opens the same Complete task pop-up / Request Revision as Projects & Tasks (shared `TaskCompletionFlow` + `lib/taskCompletion.ts`; any change to completion behaviour goes there, not into a page).

**Projects & Tasks, task list (27 Oct):**
- A sub-task that matches the filters while its parent doesn't shows the parent above it as a greyed **PARENT** context row: name and ID only, no actions, not counted, not selectable. Per-view switch **Show parent tasks** (`showParentContext`, default on). List view only.
- Collapse is applied **after** filtering (`allTaskTree` → `collapseAfterFilter`), so a collapsed parent that isn't listed can't hide the user's own sub-tasks.
- Read-only Status pills (review-chain, parent, cancelled, non-editable) use `.inline-select-static` so they line up with editable ones.
- Task statuses are only Not Started / In Progress / Done / Cancelled. "For Revision" and "Resubmitted" are tags, not statuses. So My Open Tasks = Me + Not Started + In Progress covers every open task. Tasks with no assignee (12 on 27 Oct) are in nobody's My Open Tasks; owners see them in "Tasks in My Projects".

**Project end dates (27 Oct):** every screen shows the **Target End** = `forecastEndOf()` in `Projects.tsx` (the later of `end_date` and the latest live task due date, i.e. the plan after approved extensions and shifts). The commitment stays in `committed_end_date` (fallback `original_due_date`, then `end_date`). My Dashboard "My Projects" columns: ID · Project · Health · Progress · Committed End · Target End · +/- (working days, `workingDayDelta`, same as the weekly report). Team Dashboard date range also uses the Target End.

## 7. Parked for next release (Friday 30 Oct 2026)

Details: `briefs/Tempo_Release_Oct30_Backlog.md` and `briefs/Tempo_Task_Completion_Rules_Brief.md` (with UI mockups 1–4).

1. ~~Task completion rules~~ **released 27 Oct 2026 (phase228)**, see section 5. Announced as the **October 28 Release** (KB-0034, phase229), which also covers that tasks after a late one may shift.
2. ~~My Dashboard "Next 7 business days"~~ **released 27 Oct** (see section 6).
3. ~~Bug: Utilization This Week 1438%~~ **fixed 27 Oct (phase230)**, see section 5.
6. **Released 27 Oct (Sandra's go, ahead of Friday): My Dashboard refresh** (`briefs/Tempo_Dashboard_Refresh_Brief.md`, commits fd0362b + b332a24). Fixed-height cards with internal scrolling (`.dash-kpis/.dash-main/.dash-side/.dash-row3/.dash-row2/.dash-fixed/.dash-scroll` in `index.css`); My Work tabs Needs Action · Next 2 Weeks · Later · **Waiting** (can't start yet: grey Waiting pill, no timer, "waiting on" + expected date; plus "With a reviewer"); right column = **Recent Updates** (last 7 days about my work: sent back for revision, due date shifted, assigned to me, requests decided; approved time logs skipped) over My Projects (Target End, +/-). What's Next card removed (merged into the Waiting tab); Effort vs Estimate; My Requests tabs; Deliverable Progress; "Waiting for you" folded into a Needs My Attention pill; "Mine to approve" → "Awaiting My Approval" in Approval Center. Terminology change log is in the brief.
7. **Released 11 Nov 2026 (Sandra's go, ahead of Friday): My Work "Complete" action.** Sandra chose "cover everything" (incl. QA / Sign-Off with For Revision). Built as a code-only change, no SQL. The completion flow moved out of `Projects.tsx` into shared code that both pages use: `src/lib/taskCompletion.ts` (hand-off rules, completion banner, parent status) and `src/components/TaskCompletionFlow.tsx` (Complete task pop-up, Request Revision, Log time inside both, `DoneToast`). My Work rows (mode `work`) get a green ✓ button next to the timer; it is greyed out while the task waits on earlier work; tooltip = Mark Done / Ready for Review / Resubmit / Pass QA / Approve. The flow loads fresh time entries and review events for the task when it opens; it also counts time still waiting for approval, so the pop-up's "waiting for approval" message now actually shows. Known small difference: on My Work, the parent's rolled-up Status is saved directly (Projects & Tasks goes through `updateTask`). **Pushed to `tempo-preview` 11 Nov 2026** (commits 95f7751 code + dfc0e91 CLAUDE.md sync; patch copy `briefs/my_work_complete_action_2026-11-11.patch`). Merged to `main` and LIVE 11 Nov 2026 (Sandra: "Please apply to live now"). Follow-ups: a "What's new" KB article was not written for this (offer one; pin it and unpin KB-0034), and KB-0038 My Dashboard / KB-0007 Completing & Validating Tasks could mention the ✓ button.
5. **Still open (no release date):**
   - Job aid / Project Lifecycle guide (`guides/`, `public/guides/project-lifecycle.html`): add the Include/Skip scoping prompt, "Shifted" dates, completion rules, Review time before For Revision, My Tasks grouping.
   - ~~KB clean-up~~ **LIVE 30 Oct 2026 (Sandra's go; phase232 + phase232b).** KB is now **19 articles**: 2, 3, 4, 5 Logging & Correcting Time, 6 Project Stages: Draft to Closed, 7 Completing & Validating Tasks, 10, 11, 14, 15, 16, 18, 22, 23, 25, 26, 32, 34, **38 My Dashboard** (new). Retired (`is_active = false`, still in History): 1, 8, 9, 12, 13, 17, 19, 20, 21, 24, 27, 28, 29, 30, 31, 33. Pinned: 4, 7, 10, 14, 34, 38. Draft copies KB-0903…0932 are in the Archive (auto-purge in 90 days). Plan: `briefs/Tempo_KB_Cleanup_Plan.md`. Next "What's new" article: pin it and unpin KB-0034. Small follow-up: KB-0010's first line contains a `[[link]]`, which shows as raw text in the card snippet on KB Home; reword that line.
   - Backlog (Sandra, 30 Oct): KB "Was this helpful? Yes / No" + optional comment, and article view counts. Today pins are global (Full Access); users can't star or rate. Needs a new table + app code.
   - UAT checklist (Docs artifact f1e83ef3-…, node 7807d35b-ad28): add everything released after 23 Oct. UAT round-2 results (sections B, D, E) never came back.
   - `TEMPO_SYSTEM_MAP.md` is from 13 Oct; refresh after the Oct 30 release.
   - Repo copy of CLAUDE.md synced 11 Nov 2026 (with the My Work Complete release).
   - **GitHub access key for Claude's pushes expires 20 Nov 2026.** Sandra creates a new fine-grained token (repo `tempo`, Contents read/write) and pastes it in chat. Deploys themselves don't use it. Never write the key into any file: the repo is public.
   - Backlog: "First submitted" report column, revision notes history, 3 older tasks with mismatched Output Types, follow up the 12 unassigned open tasks.
   - Parked by Sandra (decided not to build): review clock pause during For Revision (planned durations already include revision rounds; doers request extensions); automatic "wait for Scope Sign-Off" on Design tasks (link manually when needed).
4. **Released 27 Oct:** Tasks system views: "Coming Up (Waiting on Others)" removed and merged into **My Open Tasks**, which shows all my open tasks again (Next action column shows Ready / Waiting on…). The R1 `action_needed` filter is retired on My Open Tasks, My Tasks by Project and My Task Calendar (`TASK_SYSTEM_RETIRED_DEFAULTS`).

## 8. Folder layout

| Folder / file | Contents |
|---|---|
| `CLAUDE.md`, `TEMPO_SYSTEM_MAP.md` | This file and the full system map |
| `sql/` | All phase SQL files (phase183 onward) + `uat_setup_oct15.sql`. **Save new phase files here** and also commit each one to the repo's `supabase/` folder (synced up to phase230 on 27 Oct 2026; phase231–232 not yet committed: the 30 Oct session had no GitHub key). **Public repo:** in test/dry-run scripts use a placeholder like `<test-user-id>` instead of real user IDs. GitGuardian flagged `request.jwt.claims` + Sandra's user ID on 27 Oct (incident #39151564): a false positive, no secret, but avoid it going forward |
| `briefs/` | Upcoming release briefs, backlog, mockups, governance brief. **Save new briefs here** |
| `guides/` | User-facing guides (Workflow Job Aid, Project Lifecycle Guide) |
| `test-steps/` | Past release test steps |
| `branding/` | App icons and favicon |
| `_archive/patches/` | Code patches from Oct 13–20, likely already in GitHub. Delete once confirmed |

Cleaned up 23 Oct 2026: deleted the old July code snapshot (`capaciq-repo`), the superseded never-applied `phase207_add_module_review_options.sql`, and two report sample PDFs. Current code is on GitHub.

## 9. Maintaining this file

At the end of any session that changes Tempo, update this file:
- Bump "Last updated" and the latest phase number.
- Add new live rules to section 5 (with phase number); move released items out of section 7.
- Add newly parked items to section 7.

Keep a copy in the root of the GitHub repo as well, so coding sessions working from the repo load it too.
