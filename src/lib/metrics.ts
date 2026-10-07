// 2026-10-08 (Sandra, item I): one definition per metric.
//
// Every dashboard tile, report and KPI card that shows one of these numbers
// calls the function here and shows the matching definition string as its
// tooltip, so the same word always means the same count everywhere:
// My Dashboard, the Executive Dashboard (Team Dashboard), Projects & Tasks
// KPI cards, Hours Overview and the weekly report.
//
// Training Delivery rule (Sandra 2026-10-05, unchanged): ongoing
// (is_operational) projects COUNT in portfolio totals and Active ("incl. N
// Training Delivery"), but are left out of Health and Overdue projects.
import { toISO, addDays } from "./workingDays";
import { isOpenTask } from "./dailyAllocation";
import { isOverdueSuppressed, type PauseProjectInfo } from "./pause";

/** The project fields the metric rules read. ProjectRow satisfies this. */
export interface MetricProject {
  id: string;
  status?: string | null;
  wbs_status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  completed_at?: string | null;
  actual_close_date?: string | null;
  is_operational?: boolean | null;
  paused_at?: string | null;
  resumed_at?: string | null;
  schedule_review_required?: boolean | null;
}
/** The task fields the metric rules read. TaskRow satisfies this. */
export interface MetricTask {
  status: string | null;
  current_due_date?: string | null;
}

// ------------------------------------------------------------ definitions
// Short, plain-language definitions for tooltips and report notes.
export const METRIC_DEFINITIONS = {
  activeProject:
    "Active project: Status is In Progress and Start Project is approved. Includes Training Delivery and other ongoing projects.",
  overdueProject:
    "Overdue project: an Active project whose Health is Overdue (past its End Date, not complete). Training Delivery and other ongoing projects are left out; their health is always Ongoing.",
  overdueTask:
    "Overdue task: an open task (not Done or Cancelled) in a started project, due before today. Tasks in paused projects, and dates that passed during a pause, are left out. Parent tasks aren't counted; their sub-tasks are.",
  totalProjectsInPeriod:
    "Total projects: projects completed in the period, plus open projects (In Progress, Not Started or Paused) that started, or were planned to start, by the end of the period. Cancelled projects are left out.",
  dueThisWeek:
    "Due this week: open tasks in started projects due from today through Sunday. Overdue tasks and tasks in paused projects aren't included.",
  missingHours:
    "Missing hours: expected hours minus Final logged hours, per person, on completed working days this week (Monday to yesterday; today isn't counted). People not expected to log time are left out.",
  plannedUtilization:
    "Planned utilization: Estimated hours from started projects, spread over each task's working days, divided by capacity (leave and holidays removed). Draft projects aren't counted.",
  estimatedHours:
    "Estimated hours: task estimates from started projects only. Draft projects aren't counted.",
  loggedVsExpected:
    "Logged vs expected: Final logged hours (Confirmed or Approved) divided by expected hours (each person's daily capacity on working days, after leave and holidays).",
} as const;
export type MetricKey = keyof typeof METRIC_DEFINITIONS;

/** The one label for logged ÷ expected. Never "Utilization (actual)". */
export const LOGGED_VS_EXPECTED_LABEL = "Logged vs expected";

// ------------------------------------------------------------ projects
/** Display status: a Draft WBS is Not Started; a closed WBS is Completed
 * (unless Cancelled), whatever legacy data left in Status. */
export function projectStatus(p: MetricProject): string {
  if (p.wbs_status === "draft") return "Not Started";
  if (p.wbs_status === "closed" && p.status !== "Cancelled") return "Completed";
  return p.status ?? "Not Started";
}

/** Started = Start Project approved (the WBS has left Draft). Also the
 * "committed" test for planned load: Draft work is pipeline, not load. */
export function isStartedProject(p: MetricProject | null | undefined): boolean {
  return !!p && !!p.wbs_status && p.wbs_status !== "draft";
}

/** Active = In Progress and started. */
export function isActiveProject(p: MetricProject | null | undefined): boolean {
  return !!p && isStartedProject(p) && projectStatus(p) === "In Progress";
}

/** Overdue project = Active, not Training Delivery / ongoing, Health Overdue.
 * healthLabel = healthOf(p, ...).label (kept as an argument so this file
 * doesn't depend on the Projects page). */
export function isOverdueProject(p: MetricProject, healthLabel: string): boolean {
  return isActiveProject(p) && !p.is_operational && healthLabel === "Overdue";
}

export function completionDateOf(p: MetricProject): string {
  return (p.actual_close_date ?? p.completed_at ?? p.end_date ?? "").slice(0, 10);
}

export interface PortfolioInPeriod<P> {
  total: number;
  completed: P[];
  active: P[];
  notStarted: P[];
  paused: P[];
  /** Training Delivery / ongoing projects inside `active`. */
  operationalActive: P[];
}
/** Total projects in a period, split into the buckets the tiles show
 * (they always add up to the total). */
export function portfolioInPeriod<P extends MetricProject>(projects: P[], start: string, end: string): PortfolioInPeriod<P> {
  const completed: P[] = [];
  const active: P[] = [];
  const notStarted: P[] = [];
  const paused: P[] = [];
  for (const p of projects) {
    const s = projectStatus(p);
    if (s === "Cancelled") continue;
    if (s === "Completed") {
      const cd = completionDateOf(p);
      if (cd && cd >= start && cd <= end) completed.push(p);
      continue;
    }
    if (p.start_date && p.start_date.slice(0, 10) > end) continue;
    if (isActiveProject(p)) active.push(p);
    else if (s === "Paused") paused.push(p);
    else notStarted.push(p);
  }
  return {
    total: completed.length + active.length + notStarted.length + paused.length,
    completed,
    active,
    notStarted,
    paused,
    operationalActive: active.filter((p) => !!p.is_operational),
  };
}

/** Committed (started) projects and their tasks -- the only work that
 * counts toward planned utilization and Estimated hours. */
export function committedOnly<TP extends MetricProject, TT extends { project_id: string }>(projects: TP[], tasks: TT[]) {
  const ids = new Set(projects.filter(isStartedProject).map((p) => p.id));
  return { ids, projects: projects.filter((p) => ids.has(p.id)), tasks: tasks.filter((t) => ids.has(t.project_id)) };
}

// ------------------------------------------------------------ tasks
/** Overdue task. Pass isParent=true for a parent task (never counted). */
export function isOverdueTask(t: MetricTask, project: MetricProject | null | undefined, todayIso: string, isParent = false): boolean {
  if (isParent || !isOpenTask(t) || !project || !isStartedProject(project)) return false;
  const s = projectStatus(project);
  if (s === "Completed" || s === "Cancelled") return false;
  const due = t.current_due_date?.slice(0, 10);
  if (!due || due >= todayIso) return false;
  return !isOverdueSuppressed(t as { current_due_date: string }, project as PauseProjectInfo);
}

/** Today .. this Sunday (local). */
export function dueThisWeekRange(today: Date = new Date()): { start: string; end: string } {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  return { start: toISO(d), end: toISO(addDays(d, 6 - dow)) };
}

/** Due this week = open, started project, not paused, due today..Sunday. */
export function isDueThisWeek(t: MetricTask, project: MetricProject | null | undefined, today: Date = new Date(), isParent = false): boolean {
  if (isParent || !isOpenTask(t) || !project || !isStartedProject(project)) return false;
  const s = projectStatus(project);
  if (s === "Completed" || s === "Cancelled" || s === "Paused") return false;
  const due = t.current_due_date?.slice(0, 10);
  if (!due) return false;
  const w = dueThisWeekRange(today);
  return due >= w.start && due <= w.end;
}

// ------------------------------------------------------------ hours
/** Missing hours window: Monday .. yesterday of the current week. Empty
 * (start > end) on a Monday. */
export function missingHoursWindow(today: Date = new Date()): { start: string; end: string } {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  const monday = addDays(d, -((d.getDay() + 6) % 7));
  return { start: toISO(monday), end: toISO(addDays(d, -1)) };
}

/** Logged vs expected, as a fraction (0.85 = 85%). */
export function loggedVsExpected(logged: number, expected: number): number {
  return expected > 0 ? logged / expected : 0;
}
