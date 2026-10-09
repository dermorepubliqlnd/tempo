// phase169 (2026-10-07, Sandra): approve-by-exception rules.
//   Manual time  -> auto-approved when 2 hrs or less, logged within 2 working
//                   days of the work, no overlap, max 5 auto hrs/person/week.
//                   Approver can reverse within 7 days (back to their queue).
//   Validation   -> Early (reported before due): approver validates.
//                   On the due date: auto-validates after 2 working days
//                   unless the approver puts it on Hold for review.
//                   Late (after due): auto-validated straight away.
//                   Auto-validations can be reversed within 7 days.
//   Extensions   -> auto-approved when 2 working days or less, first
//                   extension on the task, requested on/before the current
//                   due date, and no task ends up past the project end date
//                   (dependents included). No undo.
// The DB decides (auto_approvals_enabled(): app_settings.auto_approvals_live
// OR the preview header); this file only mirrors the rules for display.
import { useEffect, useState } from "react";
import { supabase, IS_PREVIEW } from "./supabaseClient";
import { addDays, isWorkingDay, parseLocalDate, toISO, type HolidaySet } from "./workingDays";
import { nearestActiveManagerOf, type ChainPerson } from "./approvalRouting";

let cached: boolean | null = null;
export function useAutoApprovalsOn(): boolean {
  const [on, setOn] = useState<boolean>(IS_PREVIEW || cached === true);
  useEffect(() => {
    if (IS_PREVIEW) return;
    if (cached !== null) { setOn(cached); return; }
    supabase.from("app_settings").select("auto_approvals_live").limit(1).maybeSingle().then(({ data }) => {
      cached = !!(data as { auto_approvals_live?: boolean } | null)?.auto_approvals_live;
      setOn(cached);
    });
  }, []);
  return on;
}

export type CompletionTiming = "early" | "on_due" | "late";

export function completionTiming(due: string | null | undefined, reported: string | null | undefined): CompletionTiming | null {
  if (!due || !reported) return null;
  const d = due.slice(0, 10);
  const r = reported.slice(0, 10);
  if (r < d) return "early";
  if (r > d) return "late";
  return "on_due";
}

export const COMPLETION_TIMING_LABEL: Record<CompletionTiming, string> = {
  early: "Early completion",
  on_due: "On the due date",
  late: "Late",
};

/** The working day on which an on-the-due-date completion auto-validates:
 * 2 working days after it was reported (weekends + holidays skipped). */
export function autoValidateOn(reportedOn: string | null | undefined, holidays: HolidaySet): string | null {
  if (!reportedOn) return null;
  let d = parseLocalDate(toISO(new Date(reportedOn)));
  let n = 0;
  while (n < 2) {
    d = addDays(d, 1);
    if (isWorkingDay(d, holidays)) n++;
  }
  return toISO(d);
}

export async function setValidationHold(taskId: string, hold: boolean): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("set_validation_hold", { p_task_id: taskId, p_hold: hold });
  return error ? { error: error.message } : {};
}

export async function reverseAutoTime(entryId: string, note: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("reverse_auto_approved_time", { p_entry_id: entryId, p_note: note });
  return error ? { error: error.message } : {};
}

export async function reverseAutoValidation(taskId: string, note: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc("reverse_auto_validation", { p_task_id: taskId, p_note: note });
  return error ? { error: error.message } : {};
}

/** Preview-only test hook: run the on-the-due-date sweep for ONE project. */
export async function runAutoValidations(projectId: string, ignoreWait: boolean): Promise<{ count?: number; error?: string }> {
  const { data, error } = await supabase.rpc("run_auto_validations", { p_project_id: projectId, p_ignore_wait: ignoreWait });
  return error ? { error: error.message } : { count: Number(data ?? 0) };
}

/** After an extension request is inserted, read back what the DB decided
 * (the auto-approval runs in an AFTER INSERT trigger). */
export async function extensionOutcomeMessage(requestId: string | null | undefined): Promise<{ title: string; message: string; items?: string[] }> {
  const fallback = { title: "Extension request sent", message: "Your supervisor reviews it in Approval Center. The due date changes once it's approved." };
  if (!requestId) return fallback;
  const { data } = await supabase.from("extension_requests").select("status, auto_approved, auto_check_note, requested_new_due_date").eq("id", requestId).maybeSingle();
  const r = data as { status: string; auto_approved?: boolean; auto_check_note?: string | null; requested_new_due_date: string } | null;
  if (!r) return fallback;
  if (r.auto_approved && r.status === "Approved") {
    return { title: "Extension approved automatically", message: `The new due date is ${r.requested_new_due_date}. A first extension of 2 working days or less that doesn't move the project end date is approved automatically.`, items: ["Your supervisor still sees it in their Auto-approved list."] };
  }
  if (r.status === "Approved") {
    return { title: "Extension approved", message: `The new due date is ${r.requested_new_due_date}. There's no one above you in the reporting line, so it's approved automatically.` };
  }
  return { ...fallback, items: r.auto_check_note ? [`**Why it needs approval:** ${r.auto_check_note}.`] : undefined };
}

// ---------------------------------------------------------------- manual time
// Mirrors auto_approve_manual_time() (phase169) so the pop-up and the Log time
// form can say WHY an entry needs approval. The DB still decides.
export const AUTO_TIME_MAX_MIN = 120;
export const AUTO_TIME_WEEK_CAP_MIN = 300;
export const AUTO_TIME_MAX_WORKING_DAYS = 2;

export function formatMins(mins: number): string {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/** Monday of the week the date falls in (same as the DB's date_trunc('week')). */
export function mondayOf(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  return toISO(addDays(d, -dow));
}

/** Working days after `from` up to and including `to` (DB working_days_after). */
export function workingDaysAfter(from: string, to: string, holidays: HolidaySet): number {
  if (to <= from) return 0;
  let n = 0;
  let d = addDays(parseLocalDate(from), 1);
  const end = parseLocalDate(to);
  while (d <= end) {
    if (isWorkingDay(d, holidays)) n++;
    d = addDays(d, 1);
  }
  return n;
}

export async function loadHolidaySet(): Promise<HolidaySet> {
  const { data } = await supabase.from("holidays").select("date");
  return new Set(((data as { date: string }[] | null) ?? []).map((h) => h.date.slice(0, 10)));
}

export async function autoApprovalsLive(): Promise<boolean> {
  if (IS_PREVIEW) return true;
  if (cached !== null) return cached;
  const { data } = await supabase.from("app_settings").select("auto_approvals_live").limit(1).maybeSingle();
  cached = !!(data as { auto_approvals_live?: boolean } | null)?.auto_approvals_live;
  return cached;
}

/** True when the person has no active manager above them (phase121:
 * their time is approved on save). */
export async function isTopOfChain(personId: string): Promise<boolean> {
  const { data } = await supabase.from("people").select("id, reports_to, is_active");
  const chain = (data as ChainPerson[] | null) ?? [];
  if (chain.length === 0) return false;
  return nearestActiveManagerOf(chain, personId) === null;
}

/** Auto-approved minutes in the week (Mon-Sun) of `workDate`. */
export async function autoMinutesUsedInWeek(personId: string, workDate: string, excludeId?: string | null): Promise<number> {
  const mon = mondayOf(workDate);
  const from = parseLocalDate(mon);
  const to = addDays(from, 7);
  const { data } = await supabase
    .from("time_entries")
    .select("id, started_at, ended_at")
    .eq("person_id", personId)
    .eq("auto_approved", true)
    .eq("is_archived", false)
    .gte("started_at", from.toISOString())
    .lt("started_at", to.toISOString());
  return ((data as { id: string; started_at: string; ended_at: string | null }[] | null) ?? [])
    .filter((e) => e.id !== excludeId && e.ended_at)
    .reduce((sum, e) => sum + (new Date(e.ended_at as string).getTime() - new Date(e.started_at).getTime()) / 60000, 0);
}

/** Why a manual entry would need (or needed) approval; null = it qualifies. */
export function manualTimeReason(args: { minutes: number; workDate: string; today: string; usedThisWeek: number; holidays: HolidaySet }): string | null {
  const { minutes, workDate, today, usedThisWeek, holidays } = args;
  if (minutes > AUTO_TIME_MAX_MIN) return `Entries over 2 hours need approval (this one is ${formatMins(minutes)}).`;
  if (workingDaysAfter(workDate, today, holidays) > AUTO_TIME_MAX_WORKING_DAYS) return "Work done more than 2 working days ago needs approval.";
  if (usedThisWeek + minutes > AUTO_TIME_WEEK_CAP_MIN) {
    const left = Math.max(0, AUTO_TIME_WEEK_CAP_MIN - usedThisWeek);
    return `You've used ${formatMins(usedThisWeek)} of your 5h weekly auto-approval allowance${left > 0 ? ` (${formatMins(left)} left)` : ""}, so this ${formatMins(minutes)} entry needs approval.`;
  }
  return null;
}

/** After a manual time entry is submitted, read back what the DB decided
 * and say why. Follow-up entries never auto-approve (handled by the caller). */
export async function timeEntryOutcomeMessage(entryId: string | null | undefined, clampedNote: string): Promise<{ title: string; message: string; items?: string[] }> {
  const extra = clampedNote ? [clampedNote] : [];
  const pending = { title: "Time entry sent for approval", message: "Your supervisor reviews it in Approval Center." };
  if (!entryId) return { ...pending, items: extra.length ? extra : undefined };
  const { data } = await supabase
    .from("time_entries")
    .select("person_id, started_at, ended_at, status, auto_approved")
    .eq("id", entryId)
    .maybeSingle();
  const r = data as { person_id: string; started_at: string; ended_at: string | null; status: string; auto_approved?: boolean } | null;
  if (!r) return { ...pending, items: extra.length ? extra : undefined };

  const workDate = toISO(new Date(r.started_at));
  const minutes = r.ended_at ? (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 60000 : 0;

  if (r.auto_approved && r.status === "approved") {
    const used = await autoMinutesUsedInWeek(r.person_id, workDate);
    const left = Math.max(0, AUTO_TIME_WEEK_CAP_MIN - used);
    return {
      title: "Time logged — approved automatically",
      message: "Your supervisor still sees it in their Auto-approved list.",
      items: [...extra, `Auto-approval left this week: ${formatMins(left)}.`],
    };
  }
  // Top of the reporting line (phase121): approved on save, no one above.
  if (r.status === "approved" || r.status === "confirmed") {
    return { title: "Time logged", message: "Approved automatically. There's no one above you in the reporting line to review it.", items: extra.length ? extra : undefined };
  }
  if (!(await autoApprovalsLive())) return { ...pending, items: extra.length ? extra : undefined };
  const [holidays, used] = await Promise.all([loadHolidaySet(), autoMinutesUsedInWeek(r.person_id, workDate, entryId)]);
  const why = manualTimeReason({ minutes, workDate, today: toISO(new Date()), usedThisWeek: used, holidays });
  const items = [...extra, ...(why ? [`**Why it needs approval:** ${why}`] : [])];
  return { ...pending, items: items.length ? items : undefined };
}

/** Log time form hint: what's left of this week's allowance, and whether
 * the entry being typed would auto-approve. Hidden (null) when auto-approvals
 * are off or the person is at the top of the reporting line. */
export function useAutoTimeHint(personId: string, workDate: string, minutes: number, enabled: boolean): { left: number; reason: string | null } | null {
  const [base, setBase] = useState<{ on: boolean; top: boolean; holidays: HolidaySet } | null>(null);
  const [used, setUsed] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([autoApprovalsLive(), isTopOfChain(personId), loadHolidaySet()]).then(([on, top, holidays]) => {
      if (!cancelled) setBase({ on, top, holidays });
    });
    return () => { cancelled = true; };
  }, [personId]);
  const week = workDate ? mondayOf(workDate) : "";
  useEffect(() => {
    if (!week || !base?.on || base.top) return;
    let cancelled = false;
    setUsed(null);
    autoMinutesUsedInWeek(personId, workDate).then((u) => { if (!cancelled) setUsed(u); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, week, base?.on, base?.top]);
  if (!enabled || !base?.on || base.top || used === null || !workDate) return null;
  const reason = minutes > 0 ? manualTimeReason({ minutes, workDate, today: toISO(new Date()), usedThisWeek: used, holidays: base.holidays }) : null;
  return { left: Math.max(0, AUTO_TIME_WEEK_CAP_MIN - used), reason };
}
