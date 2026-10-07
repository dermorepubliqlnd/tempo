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
export async function extensionOutcomeMessage(requestId: string | null | undefined): Promise<{ title: string; message: string }> {
  const fallback = { title: "Extension request submitted", message: "It goes to your supervisor in Approval Center. The due date moves once it's approved." };
  if (!requestId) return fallback;
  const { data } = await supabase.from("extension_requests").select("status, auto_approved, auto_check_note, requested_new_due_date").eq("id", requestId).maybeSingle();
  const r = data as { status: string; auto_approved?: boolean; auto_check_note?: string | null; requested_new_due_date: string } | null;
  if (!r) return fallback;
  if (r.auto_approved && r.status === "Approved") {
    return { title: "Extension approved automatically", message: `The new due date is now ${r.requested_new_due_date}. Small first extensions (2 working days or less) that don't push the project end date are approved automatically. Your supervisor sees it in their Auto-approved list.` };
  }
  return { ...fallback, message: fallback.message + (r.auto_check_note ? `\n\nWhy it needs approval: ${r.auto_check_note}.` : "") };
}

/** After a manual time entry is submitted, read back whether it was auto-approved. */
export async function timeEntryOutcomeMessage(entryId: string | null | undefined, clampedNote: string): Promise<string> {
  const pending = `Time entry submitted${clampedNote} -- it goes to your supervisor for approval.`;
  if (!entryId) return pending;
  const { data } = await supabase.from("time_entries").select("status, auto_approved").eq("id", entryId).maybeSingle();
  const r = data as { status: string; auto_approved?: boolean } | null;
  if (r?.auto_approved && r.status === "approved") {
    return `Time entry saved and approved automatically${clampedNote}. Entries of 2 hrs or less logged within 2 working days are auto-approved (up to 5 hrs a week).`;
  }
  return pending;
}
