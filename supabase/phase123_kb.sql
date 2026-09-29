-- Phase 123 KB: Non-Project Time rewritten for the non-project timer.
-- Old wording kept in History (kb_entry_versions).
insert into kb_entry_versions (entry_id, title, content, edited_by)
select id, title, content, updated_by from kb_entries
 where id in ('da3e192a-c6d0-4698-96b3-e980d02e3bd1', 'bbe38414-4aca-4f1c-9792-b9bca8bbbc41');

update kb_entries set updated_at = now(), content = $kb$Lets the team log time against non-project work (meetings, admin, coaching, training) without faking a task under a real project. Keeping it separate protects Scoped/Spent Hours, Actual Progress, and Materials Output for actual projects from getting diluted by time that was never scoped work.

## Two ways to log it

Click **Add Time > Non-project**, then choose:

| Option | When to use | Notes | Approval |
|---|---|---|---|
| **Start timer** | The activity is starting now (a meeting, a coaching session) | Required when you stop the timer | {success:Not needed} -- confirmed by you |
| **Log manual time** | The activity already happened and you're logging it after the fact | Optional, except **Others** (required) | {accent:Pending Approval} -- goes to your manager |

Use the timer whenever you can. Timer entries count toward your **Timer Compliance**; manual entries don't.

**Shortcut:** on My Dashboard, click **Start non-project timer** and pick the Activity Type. One click and it's running.

## How the non-project timer works

1. **Start** -- pick an Activity Type only. No notes needed yet. The timer shows in the bar at the bottom of every page ("Timing Meeting · Non-project").
2. **Stop** -- the **Confirm time entry** window opens. Adjust the times if needed and add **notes (required)** describing what it was for, e.g. "Weekly team huddle -- Q4 training calendar". Then **Confirm**.
3. **Done** -- the entry is **Confirmed**, final, and counts toward your logged hours. No approval step.

**One timer at a time.** You can't start a non-project timer while a project task timer is running, or the other way around. Stop the current one first.

**Started it by accident?** If the timer ran for under 2 minutes, the Confirm window shows **Discard (started by accident)**. It removes the entry without needing notes (it goes to the Archive, not deleted).

**Forgot to stop it?** An idle timer is auto-stopped. Because nobody added notes, it stays an **unconfirmed (Pending) log** and shows in **Needs My Attention** on My Dashboard ("Unconfirmed timer entry (notes needed)"). Click it, check the times, add your notes, and confirm. Until then it isn't counted as finalized time.

Weekend and holiday starts show the usual "are you sure?" check. It never blocks.

## Activity types (seeded, admin-configurable)

| Name | When to use | Notes (manual log) |
|---|---|---|
| Admin | General admin work not tied to a specific project -- paperwork, email, reporting | Optional |
| Coaching | 1:1 coaching or mentoring conversations | Optional |
| Meeting | Team huddles, syncs, standups, and other meetings | Optional |
| Training | Attending training yourself (not delivering it as project work) | Optional |
| Others | Anything that doesn't fit the categories above | Required |

Timer entries always need notes, whatever the type.

The list is alphabetical except **Others**, which is always pinned last (**Meeting** was originally seeded as "Team Huddle" -- renamed 2026-09-22). Full Access users can add, rename, reorder or deactivate activity types from **Site Settings > Non-Project Activity Types**.

## Approval routing (manual entries only)

Manual non-project entries follow the logger's own reporting line:

- The logger's nearest active manager (Immediate Supervisor) or anyone above can approve or reject it.
- If nobody active sits above the logger, the entry is auto-approved.

They show in the Approval Center as **Non-project Time**. Timer entries never appear there, because they don't need approval.

## Where you'll see it

- **Time Tracking:** non-project entries show an **NP-####** ID, the Activity Type in place of a task, "Non-project" in the project line, and Source **Timer** or **Manual**.
- **Working Now (Team/All Time):** a running non-project timer shows its Activity Type and NP ID.$kb$
 where id = 'da3e192a-c6d0-4698-96b3-e980d02e3bd1';

update kb_entries set updated_at = now(),
  content = replace(content, '| **Non-project time entry** |', '| **Non-project time entry (manual only -- timer entries need no approval)** |')
 where id = 'bbe38414-4aca-4f1c-9792-b9bca8bbbc41';

select title, length(content) from kb_entries where id in ('da3e192a-c6d0-4698-96b3-e980d02e3bd1', 'bbe38414-4aca-4f1c-9792-b9bca8bbbc41');
