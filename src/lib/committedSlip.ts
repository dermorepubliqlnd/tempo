// phase175 (Sandra 2026-10-08): "I want the first date ever set to be seen and
// trapped. Any delays or any completion after the original project due date."
//
// Committed date = the due/end date in force when Start Project was approved
// (tasks added later commit the date they were added with). It never moves:
// extensions, cascades and re-plans change the CURRENT date only. This module
// compares the actual or expected finish against that committed date, in
// working days (holidays excluded), so every slip stays visible even after an
// extension made it "on time" against the current date.
import { toISO, workingDayDelta, calendarDayDelta, type HolidaySet } from "./workingDays";

export type SlipTone = "success" | "warning" | "danger" | "neutral" | "gold";
export interface SlipResult {
  label: string;
  tone: SlipTone;
  /** working days after the committed date (0 = on or before it); null = not applicable */
  days: number | null;
  hint: string;
}

const NA = (label: string, hint: string): SlipResult => ({ label, tone: "neutral", days: null, hint });

export function isEstimatedCommitted(source: string | null | undefined): boolean {
  return !!source && source.startsWith("backfill");
}

export const ESTIMATED_COMMITTED_HINT =
  "Estimated: this date was reconstructed from history on Oct 8, 2026 (tracking started then). Dates set at Start Project from now on are exact.";

function d10(s: string | null | undefined): string | null {
  return s ? s.slice(0, 10) : null;
}

function wd(n: number): string {
  return `${n} WD`;
}

/**
 * @param committed  committed due/end date
 * @param finishedOn actual completion date when the item is done, else null
 * @param currentDue current due/end date (after extensions) for open items
 */
export function slipVsCommitted(
  committed: string | null | undefined,
  opts: { finishedOn: string | null | undefined; currentDue: string | null | undefined; cancelled?: boolean; done?: boolean; holidays: HolidaySet; today?: string }
): SlipResult {
  const c = d10(committed);
  if (opts.cancelled) return NA("N/A", "Cancelled -- not measured against the committed date.");
  if (!c) return NA("—", "No committed date yet -- it is set when Start Project is approved.");
  const today = opts.today ?? toISO(new Date());
  const finished = d10(opts.finishedOn);

  if (opts.done || finished) {
    if (!finished) return NA("Pending", "Done, but no completion date recorded yet.");
    const n = workingDayDelta(c, finished, opts.holidays);
    const cal = calendarDayDelta(c, finished);
    if (n > 0) return { label: `Late +${wd(n)}`, tone: "danger", days: n, hint: `Finished ${finished}, ${n} working day${n === 1 ? "" : "s"} (${cal} calendar) after the committed date ${c}.` };
    return { label: "On time", tone: "success", days: 0, hint: `Finished ${finished}, on or before the committed date ${c}.` };
  }

  const cur = d10(opts.currentDue);
  // Open: measured to the later of today and the current due date.
  // Past its current due too -> Overdue, counted to today.
  if (today > c && (!cur || cur < today)) {
    const n = workingDayDelta(c, today, opts.holidays);
    if (n > 0) return { label: `Overdue +${wd(n)}`, tone: "danger", days: n, hint: `Committed ${c}; still open and past due${cur ? ` (current due ${cur})` : ""}.` };
  }
  if (cur && cur > c) {
    const n = workingDayDelta(c, cur, opts.holidays);
    if (n > 0) return { label: `Slipped +${wd(n)}`, tone: "gold", days: n, hint: `Committed ${c}; now due ${cur} after extensions or re-planning.` };
  }
  return { label: "On track", tone: "success", days: 0, hint: `Committed ${c}; still within it.` };
}

/** Sort key: worst first when sorted descending; N/A last. */
export function slipSortValue(r: SlipResult): number | null {
  return r.days;
}
