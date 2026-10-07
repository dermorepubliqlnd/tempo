// Portfolio building blocks (was the Projects Portfolio page, phase20).
// 2026-10-08 (Sandra, item I): the Projects Portfolio tab is merged into the
// Executive Dashboard (TeamDashboard.tsx). Its unique pieces live on here as
// shared building blocks: the Materials Output bar list + rollup, the
// Training Delivery rollup, and the Health pill tones. The duplicated
// Portfolio KPIs / donuts were removed -- the Executive Dashboard's own
// tiles use the single definitions in lib/metrics.ts.
import { CATEGORY_TONE_ICON_COLOR } from "../lib/categoryIcons";
import type { ProjectRow, TaskRow } from "./Projects";

export interface OutputTypeRow {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

// Health pill tone per healthOf() label (same tones as the Projects table).
export const HEALTH_TONE: Record<string, { fill: string; pill: string }> = {
  "On track": { fill: CATEGORY_TONE_ICON_COLOR.success, pill: "success" },
  "At risk": { fill: CATEGORY_TONE_ICON_COLOR.warning, pill: "warning" },
  "Off track": { fill: CATEGORY_TONE_ICON_COLOR.danger, pill: "danger" },
  Overdue: { fill: CATEGORY_TONE_ICON_COLOR.danger, pill: "danger" },
  "Not started": { fill: CATEGORY_TONE_ICON_COLOR.neutral, pill: "neutral" },
  Completed: { fill: CATEGORY_TONE_ICON_COLOR.success, pill: "success" },
  // phase115 health labels
  "Completed on time": { fill: CATEGORY_TONE_ICON_COLOR.success, pill: "success" },
  "Completed late": { fill: CATEGORY_TONE_ICON_COLOR.gold, pill: "gold" },
  "Completed – open tasks": { fill: CATEGORY_TONE_ICON_COLOR.warning, pill: "warning" },
  "Done on time · close pending": { fill: CATEGORY_TONE_ICON_COLOR.success, pill: "success" },
  "Done late · close pending": { fill: CATEGORY_TONE_ICON_COLOR.gold, pill: "gold" },
  "Schedule review": { fill: CATEGORY_TONE_ICON_COLOR.gold, pill: "gold" },
  Paused: { fill: CATEGORY_TONE_ICON_COLOR.purple, pill: "purple" },
  // Slate, not neutral -- see healthOf() in Projects.tsx.
  "Health unavailable": { fill: CATEGORY_TONE_ICON_COLOR.slate, pill: "slate" },
  Ongoing: { fill: CATEGORY_TONE_ICON_COLOR.slate, pill: "slate" },
};


// Materials Output's own bar list -- a two-color STACKED variant of
// CategoryBarList, per Sandra: "mark those closed green, then if still
// plotted (tentative count) make it blue, so it will be a stacked bar."
// Closed-project output is the "real"/counted number (also what the
// Materials Output stat card's own total reflects); tentative is output
// logged on a project that hasn't reached Closed yet -- shown for
// visibility, but deliberately excluded from the authoritative total per
// Sandra: "only count the output type when the project is tagged closed."
// 2026-09-21 (Sandra: "show top 5 or anything as long as the max height
// will align with the portfolio widget height ... remove the tentative
// and closed gray txt but allow showing of drill down or data count when
// hovering on the bars"): capped to the top N rows by the caller (so the
// card's height lines up with Portfolio Movement's fixed chart height
// instead of growing with however many Output Types have data) and the
// inline "(X closed, Y tentative)" gray breakdown text is gone --  it's
// now a native title tooltip on the bar itself, so the split is still
// available on hover without permanently taking up label-row space.
// Showing the FULL list on its own page is a separate ask Sandra flagged
// as a probable follow-up, not built yet.
export function MaterialsOutputBarList({ rows, total, hiddenCount }: { rows: { label: string; closed: number; tentative: number }[]; total: number; hiddenCount: number }) {
  if (total === 0) return <div style={{ fontSize: 11, color: "var(--muted)" }}>No output logged yet -- set Output Type + Output Count on tasks in WBS Planning.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => {
        const rowTotal = r.closed + r.tentative;
        const closedPct = Math.round((r.closed / total) * 100);
        const tentativePct = Math.round((r.tentative / total) * 100);
        return (
          <div key={r.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3 }}>
              <span style={{ color: "var(--text-secondary)" }}>{r.label}</span>
              <span style={{ fontWeight: 600, color: "var(--navy)" }}>{rowTotal}</span>
            </div>
            <div
              title={`${r.closed} closed, ${r.tentative} tentative`}
              style={{ height: 6, borderRadius: 3, background: "var(--hover-bg)", overflow: "hidden", display: "flex", cursor: "default" }}
            >
              <div style={{ height: "100%", width: `${closedPct}%`, background: "var(--success-text)" }} />
              <div style={{ height: "100%", width: `${tentativePct}%`, background: "var(--accent)" }} />
            </div>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 14, marginTop: 2, fontSize: 11 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--success-text)" }} />
          <span style={{ color: "var(--text-secondary)" }}>Closed (counted)</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }} />
          <span style={{ color: "var(--text-secondary)" }}>Tentative (not yet closed)</span>
        </div>
        {hiddenCount > 0 && (
          <span style={{ color: "var(--muted)", marginLeft: "auto" }}>+{hiddenCount} more type{hiddenCount === 1 ? "" : "s"} not shown</span>
        )}
      </div>
    </div>
  );
}

// Materials Output rollup: sums leaf-task Output Count by Output Type for
// the given projects, split into closed (counted: project WBS Closed) and
// tentative (project not closed yet). Parent and Cancelled tasks never count.
export function materialsOutputRowsFor(tasks: TaskRow[], projects: ProjectRow[], outputTypes: OutputTypeRow[]) {
  const projectIds = new Set(projects.map((p) => p.id));
  const closedById = new Map(projects.map((p) => [p.id, p.wbs_status === "closed"]));
  const closedCounts: Record<string, number> = {};
  const tentativeCounts: Record<string, number> = {};
  let untypedClosed = 0;
  let untypedTentative = 0;
  const parentIds = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  for (const t of tasks) {
    if (!projectIds.has(t.project_id) || parentIds.has(t.id) || t.status === "Cancelled") continue;
    const n = t.output_count ?? 0;
    if (n <= 0) continue;
    const isClosed = closedById.get(t.project_id) ?? false;
    if (!t.output_type_id) {
      if (isClosed) untypedClosed += n;
      else untypedTentative += n;
      continue;
    }
    if (isClosed) closedCounts[t.output_type_id] = (closedCounts[t.output_type_id] ?? 0) + n;
    else tentativeCounts[t.output_type_id] = (tentativeCounts[t.output_type_id] ?? 0) + n;
  }
  const rows = outputTypes
    .filter((o) => closedCounts[o.id] || tentativeCounts[o.id])
    .map((o) => ({ label: o.name, closed: closedCounts[o.id] ?? 0, tentative: tentativeCounts[o.id] ?? 0 }));
  if (untypedClosed || untypedTentative) rows.push({ label: "Untyped", closed: untypedClosed, tentative: untypedTentative });
  rows.sort((a, b) => b.closed + b.tentative - (a.closed + a.tentative));
  return {
    rows,
    closedTotal: rows.reduce((s, r) => s + r.closed, 0),
    grandTotal: rows.reduce((s, r) => s + r.closed + r.tentative, 0),
  };
}

// phase149 (Sandra 2026-10-05): Training Delivery rollup. A session = a
// leaf task with Output Type "Session" in a Training Delivery project.
// Done = delivered, Validated = owner/manager confirmed.
export interface TrainingDeliveryRow {
  id: string;
  name: string;
  delivered: number;
  validated: number;
  upcoming: number;
  notMarked: number;
  cancelled: number;
  scoped: number;
  logged: number;
}
export function trainingDeliveryFor(
  projects: ProjectRow[],
  tasks: TaskRow[],
  people: { id: string; name: string }[],
  outputTypes: { id: string; name: string }[],
  range: { start: string; end: string },
  todayIso: string
) {
  const sessionTypeIds = new Set(outputTypes.filter((o) => o.name.trim().toLowerCase() === "session").map((o) => o.id));
  const projectIds = new Set(projects.map((p) => p.id));
  const parentIds = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  const dateOf = (t: TaskRow) => (t.status === "Done" ? t.actual_completion_date ?? t.current_due_date : t.current_due_date)?.slice(0, 10) ?? null;
  const byPerson = new Map<string, TrainingDeliveryRow>();
  for (const t of tasks) {
    if (!projectIds.has(t.project_id) || t.is_archived || parentIds.has(t.id) || !t.output_type_id || !sessionTypeIds.has(t.output_type_id)) continue;
    const d = dateOf(t);
    if (!d || d < range.start || d > range.end) continue;
    const key = t.assignee_id ?? "unassigned";
    const r = byPerson.get(key) ?? { id: key, name: people.find((p) => p.id === t.assignee_id)?.name ?? "Unassigned", delivered: 0, validated: 0, upcoming: 0, notMarked: 0, cancelled: 0, scoped: 0, logged: 0 };
    if (t.status === "Done") {
      r.delivered++;
      if (t.validated_completion_date) r.validated++;
    } else if (t.status === "Cancelled") r.cancelled++;
    else if (d < todayIso) r.notMarked++;
    else r.upcoming++;
    if (t.status !== "Cancelled") r.scoped += Number(t.estimated_hours ?? 0);
    r.logged += Number(t.time_spent_hours ?? 0);
    byPerson.set(key, r);
  }
  const rows = Array.from(byPerson.values()).sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name));
  const total = rows.reduce(
    (acc, r) => ({
      delivered: acc.delivered + r.delivered,
      validated: acc.validated + r.validated,
      upcoming: acc.upcoming + r.upcoming,
      notMarked: acc.notMarked + r.notMarked,
      cancelled: acc.cancelled + r.cancelled,
      scoped: acc.scoped + r.scoped,
      logged: acc.logged + r.logged,
    }),
    { delivered: 0, validated: 0, upcoming: 0, notMarked: 0, cancelled: 0, scoped: 0, logged: 0 }
  );
  return { rows, total };
}
