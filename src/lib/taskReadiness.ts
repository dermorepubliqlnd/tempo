// R1 Actionable To-Do (2026-10-13, Sandra: "task for review is showing in my
// to do list when the materials is not even sent to me yet").
//
// Assigned is not the same as actionable. A task is only "Action needed"
// for its assignee once every task it depends on (task_dependencies) is
// finished. Until then it is "Waiting" and shows under Coming Up with who
// it is waiting on.
//
// Read-only: this only changes how existing tasks are grouped and shown.
// It writes nothing to the database, so it is safe on the preview channel
// even though preview shares the live database.

export type ReadinessState = "action" | "waiting";

// 2026-10-13 (Sandra): apply to NEW projects only -- existing projects keep
// working exactly as before, with no clean-up asked of anyone. A project
// counts as new when it was created on or after this date (Manila time).
export const R1_START_DATE = "2026-10-13";

export function isR1Project(p: { created_at?: string | null } | null | undefined): boolean {
  if (!p || !p.created_at) return false;
  const manila = new Date(new Date(p.created_at).getTime() + 8 * 3600000).toISOString().slice(0, 10);
  return manila >= R1_START_DATE;
}

export interface ReadinessDep {
  task_id: string;
  depends_on_task_id: string;
}

export interface ReadinessTask {
  id: string;
  name: string;
  status: string | null;
  assignee_id: string | null;
  current_due_date?: string | null;
  is_archived?: boolean | null;
}

export interface WaitingOn {
  id: string;
  name: string;
  status: string | null;
  assigneeId: string | null;
  dueDate: string | null;
}

export interface Readiness {
  state: ReadinessState;
  waitingOn: WaitingOn[];
}

const FINISHED = new Set(["Done", "Cancelled"]);

export function isFinishedStatus(status: string | null | undefined): boolean {
  return !!status && FINISHED.has(status);
}

/**
 * Readiness for every task in `tasks`.
 *
 * Rules:
 * - A task already In Progress stays "action": its owner has started, so it
 *   belongs on their list even if a predecessor was later reopened.
 * - Otherwise the task is "waiting" while any predecessor is not Done or
 *   Cancelled. Archived or missing predecessors are ignored (they can no
 *   longer block anything).
 * - A task with no predecessors is "action".
 */
export function computeReadiness(tasks: ReadinessTask[], deps: ReadinessDep[], appliesTo: (t: ReadinessTask) => boolean = () => true): Map<string, Readiness> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const predsOf = new Map<string, string[]>();
  for (const d of deps) {
    const list = predsOf.get(d.task_id);
    if (list) list.push(d.depends_on_task_id);
    else predsOf.set(d.task_id, [d.depends_on_task_id]);
  }
  const out = new Map<string, Readiness>();
  for (const t of tasks) {
    const preds = predsOf.get(t.id) ?? [];
    const open: WaitingOn[] = [];
    for (const pid of preds) {
      const p = byId.get(pid);
      if (!p || p.is_archived || isFinishedStatus(p.status)) continue;
      open.push({ id: p.id, name: p.name, status: p.status, assigneeId: p.assignee_id, dueDate: p.current_due_date ?? null });
    }
    if (!appliesTo(t)) {
      out.set(t.id, { state: "action", waitingOn: [] });
      continue;
    }
    const started = t.status === "In Progress";
    out.set(t.id, { state: open.length > 0 && !started ? "waiting" : "action", waitingOn: open });
  }
  return out;
}

/** "Waiting on Mae · Build e-learning" (+ "and 1 more" when several). */
export function waitingOnLabel(r: Readiness | undefined, nameOfPerson: (id: string | null) => string | null): string {
  if (!r || r.waitingOn.length === 0) return "";
  const first = r.waitingOn[0];
  const who = nameOfPerson(first.assigneeId);
  const base = who ? `${who} · ${first.name}` : first.name;
  return r.waitingOn.length > 1 ? `${base} (+${r.waitingOn.length - 1} more)` : base;
}

/** Latest due date among the open predecessors: the earliest this task can realistically unlock. */
export function expectedUnlockDate(r: Readiness | undefined): string | null {
  if (!r) return null;
  let best: string | null = null;
  for (const w of r.waitingOn) {
    const d = w.dueDate ? w.dueDate.slice(0, 10) : null;
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

// ---- Dependency clean-up check -------------------------------------
// Review / QA / sign-off tasks with no Depends-on link can't be held back
// by the readiness rule, so they would still show up too early. This flags
// them so project owners can link them before R1 goes live.

const REVIEW_NAME_RE = /\b(review|qa|q\.a\.|quality check|check|sign[- ]?off|approv\w*|validat\w*|feedback)\b/i;

export function looksLikeReviewTask(name: string | null | undefined): boolean {
  return !!name && REVIEW_NAME_RE.test(name);
}

/** Names of open review-type leaf tasks with no Depends-on link (Start Project check). */
export function reviewTasksMissingDependency(tasks: (ReadinessTask & { parent_task_id?: string | null })[], deps: ReadinessDep[]): string[] {
  const parents = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  return tasks.filter((t) => needsDependencyLink(t, deps, parents.has(t.id))).map((t) => (t.name && t.name.trim() ? t.name : "Untitled task"));
}

export function needsDependencyLink(t: ReadinessTask & { parent_task_id?: string | null }, deps: ReadinessDep[], hasChildren: boolean): boolean {
  if (isFinishedStatus(t.status) || t.is_archived) return false;
  if (hasChildren) return false; // parent rows roll up from their subtasks
  if (!looksLikeReviewTask(t.name)) return false;
  return !deps.some((d) => d.task_id === t.id);
}
