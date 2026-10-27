# CLAUDE.md — Tempo

Read this first in every Tempo session. It explains how Tempo is built, the rules currently live, how releases work, and what's parked. **Keep it current** (see "Maintaining this file" at the bottom).

Last updated: 27 Oct 2026 (task completion rules released, phase228)

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

- Changes are **hand-run SQL files**: `sql/phaseNN_short_name.sql`. Supabase tracks no migrations, so these files are the only record. **Latest: phase230. Next: phase231.**
- Each file starts with a comment header: `-- phaseNN (YYYY-MM-DD, Sandra): what and why`.
- Suffixes:
  - `_DRAFT`: Knowledge Base article kept hidden (`is_active = false`) until release
  - `_AT_RELEASE` / `_RELEASE_<date>`: run only on release day, together with the matching `main` code
  - `_dryrun_tests`: runs in one transaction and rolls back; nothing saved
- Additive and safe-while-live by default. New behaviour is usually limited to **new-flow projects** (see below).
- **Preview-only gating:** a rule can check the `x-tempo-channel: preview` header so it only applies on preview. Remove the check at release and note "RELEASED <date>" in the file.
- Because preview shares the live database, test with UAT/test projects only. No uncontrolled writes to real records.
- Knowledge Base articles live in `kb_entries`. Each release has a "What's new" article (Oct 23 release = KB-0033; Oct 28 release, task completion rules = KB-0034, phase229).

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

### Time and approvals

- Auto-approval: entry under 2h, within 2 working days, within the 5h weekly allowance. Top of the reporting line is auto-approved.
- Timers stop automatically at 10pm and after idle time.
- Non-project time can be moved to a project task via correction (phase202).

## 6. App pages

My Dashboard `/` · Team (Executive) Dashboard · Projects & Tasks · Project Overview · WBS Planning `/projects/:id/wbs` · Audit Trail · Time Tracking · Approval Center · Utilization · Productivity `/hours-overview` · Time Off & Holidays · Knowledge Base · Archive · Feedback · User Management `/admin` · Reports (L&D Weekly Report pptx) · Site Settings.

**My Dashboard (as of 27 Oct):** KPI cards (Active Projects, **Due Next 7 Business Days** "Today – [date]", Overdue Tasks, My pending requests, Utilization This Week, Hours Logged This Week) · Awaiting My Approval · Needs My Attention chips · My Work Today · **Overdue & Next 7 Business Days** (groups: Overdue · Due today · Next 7 business days). The window is today plus business days until 7 are covered (today counts; weekends and holidays skipped) via `nextBusinessDaysWindow` / `isDueBetween` in `lib/metrics.ts`, sorted by due date; Done tasks (incl. awaiting validation) are excluded. Utilization / Hours Logged / Missing hours stay weekly.

**Project end dates (27 Oct):** every screen shows the **Target End** = `forecastEndOf()` in `Projects.tsx` (the later of `end_date` and the latest live task due date, i.e. the plan after approved extensions and shifts). The commitment stays in `committed_end_date` (fallback `original_due_date`, then `end_date`). My Dashboard "My Projects" columns: ID · Project · Health · Progress · Committed End · Target End · +/- (working days, `workingDayDelta`, same as the weekly report). Team Dashboard date range also uses the Target End.

## 7. Parked for next release (Friday 30 Oct 2026)

Details: `briefs/Tempo_Release_Oct30_Backlog.md` and `briefs/Tempo_Task_Completion_Rules_Brief.md` (with UI mockups 1–4).

1. ~~Task completion rules~~ **released 27 Oct 2026 (phase228)**, see section 5. Announced as the **October 28 Release** (KB-0034, phase229), which also covers that tasks after a late one may shift.
2. ~~My Dashboard "Next 7 business days"~~ **released 27 Oct** (see section 6).
3. ~~Bug: Utilization This Week 1438%~~ **fixed 27 Oct (phase230)**, see section 5.
4. **On preview, waiting for Sandra's go:** Tasks system views: "Coming Up (Waiting on Others)" removed and merged into **My Open Tasks**, which shows all my open tasks again (Next action column shows Ready / Waiting on…). The R1 `action_needed` filter is retired on My Open Tasks, My Tasks by Project and My Task Calendar (`TASK_SYSTEM_RETIRED_DEFAULTS`).

## 8. Folder layout

| Folder / file | Contents |
|---|---|
| `CLAUDE.md`, `TEMPO_SYSTEM_MAP.md` | This file and the full system map |
| `sql/` | All phase SQL files (phase183 onward) + `uat_setup_oct15.sql`. **Save new phase files here** and also commit each one to the repo's `supabase/` folder (synced up to phase229 on 27 Oct 2026) |
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
