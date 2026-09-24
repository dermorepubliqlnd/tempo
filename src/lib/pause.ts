import { supabase } from "./supabaseClient";
import { toISO } from "./workingDays";
import { formatDate } from "./formatDate";
import { timingOf, parseLocalDate, calendarDaysBetween, type TaskTimingRow } from "./taskTiming";

// phase118 (2026-09-24, Sandra): Paused projects, Resume and Schedule Review.
//   Pause  = temporary suspension of schedule monitoring (reason required).
//   Resume = back to an active status -> Schedule Review Required flag.
//   Review = owner confirms the dates, or updates them via extension
//            requests (Re-baseline was retired 2026-08-27).
// Pause never changes the baseline or any dates; history is in Notes.

export const PAUSE_CATEGORIES = ["Priority shift", "Stakeholder dependency", "Resource constraint", "Awaiting decision", "Other"];

export type PauseProjectInfo = {
  status: string | null;
  paused_at?: string | null;
  resumed_at?: string | null;
  schedule_review_required?: boolean | null;
};

export type TimingResult = { label: string; tone: "success" | "warning" | "danger" | "neutral" | "purple" | "gold"; hint?: string };

type Group = "to_do" | "in_progress" | "complete" | "cancelled" | null;

function pausedDay(p: PauseProjectInfo): string | null {
  return p.paused_at ? toISO(new Date(p.paused_at)) : null;
}

/** Pause-aware Timing for an OPEN task. null = use the normal timingOf(). */
export function pauseTimingOverride(t: Pick<TaskTimingRow, "current_due_date">, group: Group, p: PauseProjectInfo | null | undefined): TimingResult | null {
  if (!p || group === "complete" || group === "cancelled" || !t.current_due_date) return null;
  const due = t.current_due_date.slice(0, 10);
  const pDay = pausedDay(p);
  if (p.status === "Paused") {
    if (pDay && due < pDay) {
      const days = calendarDaysBetween(parseLocalDate(pDay), parseLocalDate(due));
      return {
        label: "Paused · Overdue",
        tone: "purple",
        hint: `${days} day${days === 1 ? "" : "s"} overdue when the project was paused on ${formatDate(pDay)}. Overdue days stop counting while the project is paused.`,
      };
    }
    return { label: "Paused", tone: "purple", hint: `Project paused${pDay ? ` on ${formatDate(pDay)}` : ""}. Overdue monitoring is suspended until it resumes.` };
  }
  if (p.schedule_review_required) {
    const today = toISO(new Date());
    if (due < today && !(pDay && due < pDay)) {
      return {
        label: "Review pending",
        tone: "gold",
        hint: "This due date passed while the project was paused. It shows as overdue only after the project owner confirms the schedule review.",
      };
    }
  }
  return null;
}

export function timingWithPause(t: TaskTimingRow, group: Group, p: PauseProjectInfo | null | undefined): TimingResult {
  return pauseTimingOverride(t, group, p) ?? timingOf(t, group);
}

/** True when a task's lateness shouldn't count right now (paused, or passed during the pause and still under review). */
export function isOverdueSuppressed(t: Pick<TaskTimingRow, "current_due_date">, p: PauseProjectInfo | null | undefined): boolean {
  return pauseTimingOverride(t, "in_progress", p) !== null;
}

export function pausedDays(p: PauseProjectInfo): number {
  if (!p.paused_at) return 0;
  const end = p.resumed_at ? new Date(p.resumed_at) : new Date();
  return Math.max(0, calendarDaysBetween(end, new Date(p.paused_at)));
}

export async function pauseProject(projectId: string, reason: string, category: string | null, expectedResume: string | null, note: string | null) {
  const { error } = await supabase.rpc("pause_project", {
    p_project_id: projectId,
    p_reason: reason,
    p_category: category,
    p_expected_resume: expectedResume,
    p_note: note,
  });
  return { error: error ? { message: error.message } : null };
}

export async function resolveScheduleReview(projectId: string, outcome: "no_change" | "schedule_updated", note: string | null) {
  const { error } = await supabase.rpc("resolve_schedule_review", { p_project_id: projectId, p_outcome: outcome, p_note: note });
  return { error: error ? { message: error.message } : null };
}
