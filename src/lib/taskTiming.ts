// Task "Timing" computation -- shared between Projects.tsx's Tasks list
// (Timing/Days +/- columns) and HoursOverview.tsx's Productivity > Per
// Task view (2026-09-23, Sandra: "can we add task due date and timing in
// the per tasks view in productivity too"). Extracted out of Projects.tsx
// so both pages read off exactly the same computation rather than each
// growing its own copy that could quietly drift apart -- same anti-drift
// reasoning as timeTracking.ts's TIME_LOG_STATUS_LABEL/TONE (see
// [[project_capaciq_time_log_status_2026_09_23]]).

export type TaskTimingRow = {
  status: string | null;
  current_due_date: string;
  submitted_on: string | null;
  validated_completion_date: string | null;
  actual_completion_date: string | null;
};

// Supabase date columns come back as plain "YYYY-MM-DD" strings. Passing
// that straight to `new Date(...)` parses it as UTC midnight, which in any
// timezone behind UTC silently rolls it back a calendar day (a task due
// "today" would parse as "yesterday" and read as overdue). Parsing the
// pieces directly as LOCAL date components avoids that shift entirely.
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

// Whole-calendar-day difference (ignores time-of-day) so "due today" never
// reads as overdue -- a day only counts as passed once the clock actually
// rolls into the next calendar date.
export function calendarDaysBetween(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
}

// The actual completion moment for Timing purposes: prefer the owner/
// manager-validated date once it exists (the authoritative record), but
// fall back to the assignee's own submitted_on stamp (set automatically
// the moment status flips to Done) rather than assuming On time by
// default.
export function actualCompletionDateOf(t: TaskTimingRow): string | null {
  return t.validated_completion_date ?? t.actual_completion_date ?? t.submitted_on;
}

// Severity order for sorting by Timing: worst first (Overdue).
export function timingRank(label: string): number {
  if (label === "Overdue") return 0;
  if (label === "Late") return 1;
  if (label === "Due soon") return 2;
  if (label === "On track") return 3;
  if (label === "Pending") return 4;
  if (label === "On time") return 5;
  if (label === "Early") return 6;
  return 7;
}

// `group` is the caller's own statusGroupOf(TASK_STATUS_GROUPED, t.status)
// result -- passed in rather than recomputed here so this module doesn't
// need to import notionOptions' status-group config itself.
export function timingOf(t: TaskTimingRow, group: "to_do" | "in_progress" | "complete" | "cancelled" | null): { label: string; tone: "success" | "warning" | "danger" | "neutral" } {
  // A cancelled task was never actually finished (on time or otherwise) --
  // Timing is meaningless for it.
  if (group === "cancelled") return { label: "N/A", tone: "neutral" };
  const due = parseLocalDate(t.current_due_date);
  if (group === "complete") {
    const actualDateStr = actualCompletionDateOf(t);
    if (!actualDateStr) return { label: "Pending", tone: "neutral" };
    const days = calendarDaysBetween(parseLocalDate(actualDateStr.slice(0, 10)), due);
    if (days > 0) return { label: "Late", tone: "danger" };
    if (days < 0) return { label: "Early", tone: "success" };
    return { label: "On time", tone: "success" };
  }
  const daysLeft = calendarDaysBetween(due, new Date());
  if (daysLeft < 0) return { label: "Overdue", tone: "danger" };
  if (daysLeft <= 3) return { label: "Due soon", tone: "warning" };
  return { label: "On track", tone: "success" };
}

// Signed +/- days variance vs the due date -- positive means completed
// that many days late, negative means that many days early. null when
// there's no actual completion date to compare yet.
export function timingVarianceDays(t: TaskTimingRow, group: "to_do" | "in_progress" | "complete" | "cancelled" | null): number | null {
  if (group !== "complete") return null; // includes "cancelled"
  const actualDateStr = actualCompletionDateOf(t);
  if (!actualDateStr) return null;
  const due = parseLocalDate(t.current_due_date);
  return calendarDaysBetween(parseLocalDate(actualDateStr.slice(0, 10)), due);
}
