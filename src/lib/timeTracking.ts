import { supabase } from "./supabaseClient";

// Shared types + helpers for the Task Timer / Time Tracking feature.
// Mirrors the extension_requests governance model (see
// [[project_capaciq_extension_requests]]): owner decides a manual entry
// unless the owner is the one who logged it, in which case it escalates
// to the owner's manager. Full Access can always decide, and can also
// correct an already-finalized entry (never silently -- corrections leave
// original_duration_minutes + corrected_by/at behind).

export type TimeEntrySource = "timer" | "manual" | "legacy";
export type TimeEntryStatus = "running" | "pending_confirm" | "confirmed" | "pending_approval" | "approved" | "rejected";

export interface TimeEntryRow {
  id: string;
  // 2026-09-22: nullable now that non-project time entries exist --
  // exactly one of task_id/activity_type_id is set, never both, never
  // neither (enforced by a DB check constraint). See
  // submitNonProjectTimeEntry above.
  task_id: string | null;
  activity_type_id?: string | null;
  person_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  source: TimeEntrySource;
  status: TimeEntryStatus;
  requested_by: string | null;
  reason_notes: string | null;
  auto_stopped: boolean;
  confirmed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  corrected_by: string | null;
  corrected_at: string | null;
  original_duration_minutes: number | null;
  correction_notes: string | null;
  created_at: string;
  // 2026-09-23 (phase63): admin soft-delete for a confirmed/approved
  // entry -- reversible, excluded from every hour rollup (isCountedEntry
  // below). See archiveTimeEntry/unarchiveTimeEntry.
  is_archived?: boolean;
  archived_at?: string | null;
  archived_by?: string | null;
  archive_reason?: string | null;
}

// Only these statuses represent finalized, real time -- Spent Hrs (and any
// rollup of it) should only ever sum these three.
const COUNTED_STATUSES: TimeEntryStatus[] = ["confirmed", "approved", "legacy"] as unknown as TimeEntryStatus[];
// (legacy entries are inserted with status 'confirmed' + source 'legacy',
// so in practice this is just ['confirmed', 'approved'] -- kept as a
// named constant so the intent reads clearly at call sites.)

export function isCountedEntry(e: Pick<TimeEntryRow, "status" | "is_archived">): boolean {
  return (e.status === "confirmed" || e.status === "approved") && !e.is_archived;
}

export function minutesFor(entries: TimeEntryRow[], taskId: string): number {
  return entries.filter((e) => e.task_id === taskId && isCountedEntry(e)).reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
}

// Own hours only (rounded to 2dp hours) -- used by leaf tasks and as the
// "own" component of a parent's rollup total.
export function ownHoursFor(entries: TimeEntryRow[], taskId: string): number {
  return Math.round((minutesFor(entries, taskId) / 60) * 100) / 100;
}

// Parent rollup: own entries + every descendant's total, mirroring the
// existing date rollup pattern (taskDatesFromSubtasks) but summed instead
// of min/maxed. childrenOf should return direct sub-task ids for a given
// parent id (callers already have this via `tasks.filter(...)`).
export function rollupHoursFor(taskId: string, entries: TimeEntryRow[], childrenOf: (id: string) => string[]): number {
  const own = minutesFor(entries, taskId);
  const childMinutes = childrenOf(taskId).reduce((sum, childId) => sum + minutesFor(entries, childId), 0);
  return Math.round(((own + childMinutes) / 60) * 100) / 100;
}

export interface PersonHoursEntry {
  personId: string;
  hours: number;
}

// Per-person breakdown behind a task's own Spent Hrs total (2026-08-14,
// Sandra: "I want to see total hours spent on the task, but also see how
// much each person spent on it"). Mirrors rollupHoursFor's own+descendant
// scope exactly (so the breakdown's own numbers always sum to the same
// total already shown in the Spent Hrs cell) but grouped by person_id
// instead of collapsed into one number. Hours logged are keyed to
// whoever actually logged them (time_entries.person_id), never derived
// from the task's current assignee -- so a later assignee transfer never
// resets or reattributes historical hours, it just keeps accumulating.
export function personHoursBreakdownFor(taskId: string, entries: TimeEntryRow[], childrenOf: (id: string) => string[]): PersonHoursEntry[] {
  const relevantTaskIds = new Set([taskId, ...childrenOf(taskId)]);
  const minutesByPerson = new Map<string, number>();
  entries
    .filter((e) => e.task_id != null && relevantTaskIds.has(e.task_id) && isCountedEntry(e))
    .forEach((e) => {
      minutesByPerson.set(e.person_id, (minutesByPerson.get(e.person_id) ?? 0) + (e.duration_minutes ?? 0));
    });
  return Array.from(minutesByPerson.entries())
    .map(([personId, minutes]) => ({ personId, hours: Math.round((minutes / 60) * 100) / 100 }))
    .sort((a, b) => b.hours - a.hours);
}

// Time Log Status (2026-09-23, Sandra: "add if time tracking has been
// finalized or approved" -- then, self-caught: "time tracking for a task
// is multiple entries, how do I get the data to see if the log has been
// validated already?"). A task can have any number of time_entries in
// any mix of states, so this collapses them into ONE of three values by
// taking the weakest link, not an average or a most-common-value:
//   - "none": no non-rejected entry exists for the task at all yet.
//   - "pending": at least one entry still needs action -- running,
//     awaiting the logger's own confirmation (pending_confirm), or
//     awaiting a decision (pending_approval). A single still-open entry
//     means the task's logged time is NOT fully finalized, even if every
//     other entry against it is long since confirmed/approved.
//   - "finalized": every non-rejected entry is confirmed or approved --
//     the same two terminal states isCountedEntry() already treats as
//     "real, finalized time" for Spent Hrs. "Confirmed" (timer entries,
//     self-service, no manager review needed) and "Approved" (manual
//     entries, went through a decision) are both terminal, so both read
//     as Finalized here -- matches Sandra's own phrasing, "finalized OR
//     approved", as two names for the same end state rather than two
//     different things to distinguish in the UI.
// Rejected entries are excluded entirely (voided, same as they're
// excluded from every hour rollup) -- a task with only rejected entries
// reads as "none", same as if nothing had ever been logged.
export type TimeLogStatus = "none" | "pending" | "finalized";

// Shared display strings/tones -- centralized here (not redefined per
// page) so Time Log Status reads identically everywhere it's shown (the
// same drift class flagged in [[project_capaciq_logged_hours_6tier_bands_2026_09_23]]).
export const TIME_LOG_STATUS_LABEL: Record<TimeLogStatus, string> = { none: "—", pending: "Pending", finalized: "Finalized" };
export const TIME_LOG_STATUS_TONE: Record<TimeLogStatus, string> = { none: "neutral", pending: "warning", finalized: "success" };

type TimeLogStatusEntry = Pick<TimeEntryRow, "task_id" | "status" | "is_archived">;

function timeLogStatusOf(relevant: TimeLogStatusEntry[]): TimeLogStatus {
  if (relevant.length === 0) return "none";
  const hasPending = relevant.some((e) => e.status === "running" || e.status === "pending_confirm" || e.status === "pending_approval");
  return hasPending ? "pending" : "finalized";
}

// Own entries only -- same scope as ownHoursFor/minutesFor. Use this for
// a leaf task, or anywhere that already shows a task's OWN logged hours
// (not a parent's rollup). Takes a minimal Pick (same convention as
// isCountedEntry above) so pages with their own narrower local
// TimeEntryRow interface (e.g. HoursOverview.tsx, which doesn't fetch
// every column this lib's full TimeEntryRow has) can still call this
// without needing to fetch/carry columns they don't otherwise use.
export function ownTimeLogStatusFor(entries: TimeLogStatusEntry[], taskId: string): TimeLogStatus {
  return timeLogStatusOf(entries.filter((e) => e.task_id === taskId && !e.is_archived && e.status !== "rejected"));
}

// Own + every descendant's entries -- same own+descendant scope as
// rollupHoursFor/personHoursBreakdownFor. Use this anywhere a parent
// task's Spent Hrs already rolls up its children's hours (e.g. the main
// Tasks list), so the two columns stay conceptually in sync: if Spent
// Hrs includes a child's hours, Time Log Status should reflect whether
// those same hours are finalized.
export function rollupTimeLogStatusFor(taskId: string, entries: TimeLogStatusEntry[], childrenOf: (id: string) => string[]): TimeLogStatus {
  const relevantTaskIds = new Set([taskId, ...childrenOf(taskId)]);
  return timeLogStatusOf(entries.filter((e) => e.task_id != null && relevantTaskIds.has(e.task_id) && !e.is_archived && e.status !== "rejected"));
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatHours(hours: number): string {
  return hours.toFixed(2);
}

export async function startTimer(taskId: string): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("start_timer", { p_task_id: taskId });
  if (error) return { error: error.message };
  return { id: data as unknown as string };
}

export async function stopTimer(entryId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("stop_timer", { p_entry_id: entryId });
  if (error) return { error: error.message };
  return {};
}

// "Continue work" -- undoes a stop (or an idle auto-stop), keeping the
// original start time and going back to running. This is the alternative
// to Confirm on the confirm-time-entry modal; there's no third "decide
// later" option, so every stop forces one of these two choices.
export async function resumeTimer(entryId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("resume_timer", { p_entry_id: entryId });
  if (error) return { error: error.message };
  return {};
}

export async function confirmTimeEntry(
  entryId: string,
  overrides: { startedAt?: string; endedAt?: string; notes?: string } = {}
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("confirm_time_entry", {
    p_entry_id: entryId,
    p_started_at: overrides.startedAt ?? null,
    p_ended_at: overrides.endedAt ?? null,
    p_notes: overrides.notes ?? null,
  });
  if (error) return { error: error.message };
  return {};
}

// SUPERSEDED 2026-09-03 (Phase 37) -- reasons are now admin-configurable
// via the time_entry_reasons table (Site Settings > Time Logging
// Reasons), fetched live in TimeTracking.tsx instead of this fixed list.
// Left here only because nothing forces removing an unused export;
// nothing imports this anymore. "Other" still allows a free-text note
// via the notes param.
export const TIME_ENTRY_REASON_OPTIONS = [
  "Forgot to Start Timer",
  "Worked Offline / No Internet",
  "Continued Work After Hours",
  "System/Technical Issue",
  "Other",
];

export async function submitManualTimeEntry(
  taskId: string,
  startedAt: string,
  endedAt: string,
  reasonCategory: string,
  notes: string
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("submit_manual_time_entry", {
    p_task_id: taskId,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_reason_category: reasonCategory,
    p_notes: notes,
  });
  if (error) return { error: error.message };
  return { id: data as unknown as string };
}

export async function decideTimeEntry(entryId: string, status: "approved" | "rejected", notes: string | null): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("decide_time_entry", { p_entry_id: entryId, p_status: status, p_decision_notes: notes });
  if (error) return { error: error.message };
  return {};
}

// 2026-09-22 (Sandra: "the team work on non-project tasks sometimes --
// example meetings, the team weekly huddles -- how do we make the
// system capture that without plotting it in the project tasks?") --
// same time_entries table and pending_approval/approved lifecycle as
// submitManualTimeEntry, just logged against an activity type instead
// of a task (task_id stays null on these rows -- see
// [[project_capaciq_non_project_time_2026_09_22]]). Always requires
// approval, same as any other manual entry -- no auto-confirm path.
export async function submitNonProjectTimeEntry(
  personId: string,
  activityTypeId: string,
  startedAt: string,
  endedAt: string,
  notes: string
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("submit_non_project_time_entry", {
    p_person_id: personId,
    p_activity_type_id: activityTypeId,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_notes: notes,
  });
  if (error) return { error: error.message };
  return { id: data as unknown as string };
}

// 2026-09-23 (phase102, Sandra: "should correction update start and end
// time instead of adding/subtracting duration?") -- corrections now set
// a new START/END; duration is always derived server-side, so the
// overlap check (timestamps) and every rollup (duration) can't disagree.
// trimEntryIds: other finalized entries of the same person the
// corrector chose to shorten so the corrected interval fits (see
// apply_time_entry_correction in phase102_migration.sql).
export async function correctTimeEntry(
  entryId: string,
  startedAt: string,
  endedAt: string,
  notes: string,
  opts: { reasonCategory?: string; activityTypeId?: string; trimEntryIds?: string[] } = {}
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("correct_time_entry", {
    p_entry_id: entryId,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_notes: notes,
    p_reason_category: opts.reasonCategory ?? null,
    p_activity_type_id: opts.activityTypeId ?? null,
    p_trim_entry_ids: opts.trimEntryIds ?? [],
  });
  if (error) return { error: error.message };
  return {};
}

// Phase 2 (phase102): employee-initiated correction requests on their
// own confirmed/approved entry, decided in the Approval Center.
export async function requestTimeEntryCorrection(
  entryId: string,
  startedAt: string,
  endedAt: string,
  reason: string,
  activityTypeId?: string
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("request_time_entry_correction", {
    p_entry_id: entryId,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_reason: reason,
    p_activity_type_id: activityTypeId ?? null,
  });
  if (error) return { error: error.message };
  return { id: data as unknown as string };
}

export async function cancelTimeEntryCorrection(requestId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("cancel_time_entry_correction", { p_request_id: requestId });
  if (error) return { error: error.message };
  return {};
}

export async function decideTimeEntryCorrection(requestId: string, decision: "approved" | "rejected", notes: string | null): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("decide_time_entry_correction", {
    p_request_id: requestId,
    p_decision: decision,
    p_notes: notes,
  });
  if (error) return { error: error.message };
  return {};
}

// 2026-09-22 (Sandra: "if there are manual time entries that are in
// pending status, let's allow the assignee or requestor to delete or
// make changes with the manual time entry log only ... anything after
// approved status will be admin corrections only") -- self-service
// edit/delete for a still-pending manual entry (project or non-project).
// Timer entries aren't in scope -- confirm_time_entry already lets the
// person adjust times before a stopped timer becomes final.
export async function editPendingManualTimeEntry(
  entryId: string,
  startedAt: string,
  endedAt: string,
  opts: { reasonCategory?: string; notes?: string; activityTypeId?: string } = {}
): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("edit_pending_manual_time_entry", {
    p_entry_id: entryId,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_reason_category: opts.reasonCategory ?? null,
    p_notes: opts.notes ?? null,
    p_activity_type_id: opts.activityTypeId ?? null,
  });
  if (error) return { error: error.message };
  return {};
}

export async function deletePendingManualTimeEntry(entryId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("delete_pending_manual_time_entry", { p_entry_id: entryId });
  if (error) return { error: error.message };
  return {};
}

// 2026-09-23 (phase63, Sandra: "can admin delete timelogs that have been
// approved -- can be soft first and archived") -- reversible soft-delete
// for a confirmed/approved entry, Full Access only. Archived entries
// stay on record (trail visible in the table) but drop out of every
// Spent Hrs / Scoped-vs-Logged / dashboard rollup via isCountedEntry
// above + each rollup query's `.eq("is_archived", false)`.
export async function archiveTimeEntry(entryId: string, reason?: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("archive_time_entry", { p_entry_id: entryId, p_reason: reason ?? null });
  if (error) return { error: error.message };
  return {};
}

export async function unarchiveTimeEntry(entryId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("unarchive_time_entry", { p_entry_id: entryId });
  if (error) return { error: error.message };
  return {};
}

// 2026-09-24 (phase110, Sandra: "do follow up log") -- extra time on a task
// that's already Done/validated (late feedback, validated too early, scope
// change). Always pending approval; the task stays Done.
export type FollowUpReason = "late_feedback" | "validated_too_early" | "scope_change";
export const FOLLOW_UP_REASON_LABEL: Record<FollowUpReason, string> = {
  late_feedback: "Late feedback",
  validated_too_early: "Validated too early",
  scope_change: "Scope change",
};
export async function submitFollowUpTimeEntry(
  taskId: string,
  startedAt: string,
  endedAt: string,
  reason: FollowUpReason,
  notes: string
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("submit_follow_up_time_entry", {
    p_task_id: taskId,
    p_started_at: startedAt,
    p_ended_at: endedAt,
    p_reason: reason,
    p_notes: notes || null,
  });
  if (error) return { error: error.message };
  return { id: data as unknown as string };
}
