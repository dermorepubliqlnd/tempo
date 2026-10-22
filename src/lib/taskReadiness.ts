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
  parent_task_id?: string | null;
  name: string;
  status: string | null;
  assignee_id: string | null;
  current_due_date?: string | null;
  is_archived?: boolean | null;
  work_type_id?: string | null;
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
export function computeReadiness(
  tasks: ReadinessTask[],
  deps: ReadinessDep[],
  appliesTo: (t: ReadinessTask) => boolean = () => true,
  // 2026-10-22 (Sandra): review / sign-off steps. A check waits on the work it
  // checks even through an earlier, finished check (Sign-Off -> Review -> work):
  // when the approver sends work back to the doer, the sign-off waits for the
  // doer, not the reviewer. A check's own "In Progress" never skips the wait.
  isCheck?: (t: ReadinessTask) => boolean,
): Map<string, Readiness> {
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
    const tIsCheck = !!isCheck && isCheck(t);
    const seenUp = new Set<string>();
    const visit = (pid: string, depth: number) => {
      if (seenUp.has(pid)) return;
      seenUp.add(pid);
      const p = byId.get(pid);
      if (!p || p.is_archived) return;
      if (isFinishedStatus(p.status)) {
        // Look past a finished check to the work behind it (checks only).
        if (tIsCheck && depth < 5 && p.status === "Done" && isCheck!(p)) for (const up of predsOf.get(p.id) ?? []) visit(up, depth + 1);
        return;
      }
      open.push({ id: p.id, name: p.name, status: p.status, assigneeId: p.assignee_id, dueDate: p.current_due_date ?? null });
    };
    for (const pid of preds) visit(pid, 0);
    if (!appliesTo(t)) {
      out.set(t.id, { state: "action", waitingOn: [] });
      continue;
    }
    const started = t.status === "In Progress" && !tIsCheck;
    out.set(t.id, { state: open.length > 0 && !started ? "waiting" : "action", waitingOn: open });
  }
  // A parent row only rolls up its sub-tasks (2026-10-13 test: "Needs
  // analysis" showed Action needed while all its sub-tasks were waiting).
  // It is "action" when any open sub-task is actionable, otherwise "waiting"
  // on whatever its sub-tasks wait on.
  const kids = new Map<string, ReadinessTask[]>();
  for (const t of tasks) {
    if (!t.parent_task_id || t.is_archived) continue;
    const list = kids.get(t.parent_task_id);
    if (list) list.push(t);
    else kids.set(t.parent_task_id, [t]);
  }
  for (const [pid, list] of kids) {
    const parent = byId.get(pid);
    if (!parent || !appliesTo(parent)) continue;
    const openKids = list.filter((k) => !isFinishedStatus(k.status));
    if (!openKids.length) continue;
    const anyAction = openKids.some((k) => out.get(k.id)?.state === "action");
    if (anyAction) continue;
    const waitingOn = openKids.flatMap((k) => out.get(k.id)?.waitingOn ?? []);
    const seen = new Set<string>();
    out.set(pid, { state: "waiting", waitingOn: waitingOn.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true))) });
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

// R2.2 #3: which hand-off button a review step gets. Sign-off / approval /
// validation steps get "Approve"; every other review-type name gets "Pass QA".
const APPROVE_NAME_RE = /\b(sign[- ]?off|approv\w*|validat\w*)\b/i;

export function reviewKindOf(name: string | null | undefined): "qa" | "approve" | null {
  if (!looksLikeReviewTask(name)) return null;
  return APPROVE_NAME_RE.test(name as string) ? "approve" : "qa";
}

// 2026-10-21 (Sandra): the Work Type decides the step, not the name.
//   Quality Assurance -> review (Pass QA), Sign-Off -> approval (Approve),
//   any other work type -> ordinary work. Tasks with no work type yet fall
//   back to the name rule above.
export type WorkTypeNames = ReadonlyMap<string, string> | null | undefined;
export const QA_WORK_TYPE = "Quality Assurance";
export const SIGNOFF_WORK_TYPE = "Sign-Off";

export function workTypeNameMap(list: { id: string; name: string }[] | null | undefined): Map<string, string> {
  return new Map((list ?? []).map((w) => [w.id, w.name]));
}

export function stepKindOf(t: { name?: string | null; work_type_id?: string | null }, wt: WorkTypeNames): "qa" | "approve" | null {
  const wtName = t.work_type_id ? wt?.get(t.work_type_id) ?? null : null;
  if (wtName === SIGNOFF_WORK_TYPE) return "approve";
  if (wtName === QA_WORK_TYPE) {
    // Until the Sign-Off work type exists, sign-offs are still tagged QA.
    const hasSignOff = !!wt && [...wt.values()].includes(SIGNOFF_WORK_TYPE);
    return !hasSignOff && t.name && APPROVE_NAME_RE.test(t.name) ? "approve" : "qa";
  }
  if (wtName) return null;
  return reviewKindOf(t.name);
}

export function isReviewStep(t: { name?: string | null; work_type_id?: string | null }, wt: WorkTypeNames): boolean {
  return !!stepKindOf(t, wt);
}

/** Names of open review / sign-off leaf tasks with no Depends-on link (Start Project check). */
export function reviewTasksMissingDependency(tasks: (ReadinessTask & { parent_task_id?: string | null })[], deps: ReadinessDep[], wt?: WorkTypeNames): string[] {
  const parents = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  return tasks.filter((t) => needsDependencyLink(t, deps, parents.has(t.id), wt)).map((t) => (t.name && t.name.trim() ? t.name : "Untitled task"));
}

export function needsDependencyLink(t: ReadinessTask & { parent_task_id?: string | null }, deps: ReadinessDep[], hasChildren: boolean, wt?: WorkTypeNames): boolean {
  if (isFinishedStatus(t.status) || t.is_archived) return false;
  if (hasChildren) return false; // parent rows roll up from their subtasks
  if (!isReviewStep(t, wt)) return false;
  return !deps.some((d) => d.task_id === t.id);
}
