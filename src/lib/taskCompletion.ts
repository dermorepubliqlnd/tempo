// 2026-11-11 (Sandra: "Complete" on My Work, behaving exactly like Projects & Tasks).
// The rules that decide HOW a task is finished -- which hand-off it is (Mark
// Done / Ready for Review / Pass QA / Approve), what For Revision can send
// back, which completion banner applies -- live here so Projects & Tasks and
// My Dashboard use one copy. Moved unchanged out of Projects.tsx.
// Read-only helpers: nothing here writes to the database.
import { isReviewStep, stepKindOf, type ReadinessDep, type WorkTypeNames } from "./taskReadiness";
import { isWorkingDay, toISO } from "./workingDays";

export interface CompletionTask {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  name: string;
  status: string | null;
  assignee_id: string | null;
  is_archived?: boolean | null;
  work_type_id?: string | null;
  revision_count?: number | null;
  current_due_date?: string | null;
  created_at?: string | null;
}

export interface CompletionProject {
  id: string;
  owner_id: string | null;
  wbs_status?: string | null;
}

export interface CompletionContext<T extends CompletionTask = CompletionTask> {
  tasks: T[];
  deps: ReadinessDep[];
  /** New-flow projects (isR1Project). */
  r1ProjectIds: Set<string>;
  wtNames: WorkTypeNames;
}

export type Handoff = "review" | "qa" | "approve";
export type CompletionActionLabel = "Mark Done" | "Ready for Review" | "Pass QA" | "Approve";
export type CompletionTimingKind = "early" | "on_time" | "grace" | "late" | "logged_late";

export function isLeafTask<T extends CompletionTask>(t: T, c: CompletionContext<T>): boolean {
  return !c.tasks.some((x) => x.parent_task_id === t.id && !x.is_archived);
}

/** Open review tasks that wait on this task. */
export function reviewersOf<T extends CompletionTask>(t: T, c: CompletionContext<T>): T[] {
  return c.deps
    .filter((d) => d.depends_on_task_id === t.id)
    .map((d) => c.tasks.find((x) => x.id === d.task_id))
    .filter((x): x is T => !!x && !x.is_archived && x.status !== "Cancelled" && isReviewStep(x, c.wtNames));
}

/** "qa" | "approve" when this task is itself a review step with a Depends-on link. */
export function reviewStepKind<T extends CompletionTask>(t: T, c: CompletionContext<T>): "qa" | "approve" | null {
  return c.r1ProjectIds.has(t.project_id) && isLeafTask(t, c) && c.deps.some((d) => d.task_id === t.id) ? stepKindOf(t, c.wtNames) : null;
}

/** A work task whose finish hands it to a review / QA / sign-off step (new projects). */
export function isHandoffTask<T extends CompletionTask>(t: T, c: CompletionContext<T>): boolean {
  return c.r1ProjectIds.has(t.project_id) && isLeafTask(t, c) && !reviewStepKind(t, c) && reviewersOf(t, c).length > 0;
}

/** 2026-10-14: any route into Done on a hand-off task becomes that hand-off. */
export function handoffFor<T extends CompletionTask>(t: T, c: CompletionContext<T>): Handoff | null {
  return reviewStepKind(t, c) ?? (isHandoffTask(t, c) ? "review" : null);
}

export function actionLabelFor(handoff: Handoff | null): CompletionActionLabel {
  return handoff === "review" ? "Ready for Review" : handoff === "qa" ? "Pass QA" : handoff === "approve" ? "Approve" : "Mark Done";
}

// phase188: finished tasks this task depends on -- what a reviewer can return.
// 2026-10-22 (Sandra): For Revision goes back to the person who did the work.
// From a sign-off, walk back past review steps to the work itself (the review
// steps in between reopen in the database and check the revised work again).
export function returnableFor<T extends CompletionTask>(t: T, c: CompletionContext<T>): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    for (const d of c.deps.filter((x) => x.task_id === id)) {
      const up = c.tasks.find((x) => x.id === d.depends_on_task_id);
      if (!up || up.is_archived || seen.has(up.id)) continue;
      seen.add(up.id);
      if (isReviewStep(up, c.wtNames) && depth < 5) walk(up.id, depth + 1);
      else if (up.status === "Done") out.push(up);
    }
  };
  walk(t.id, 0);
  return out;
}

/** For Revision is offered to the assignee, the project owner or Full Access, on an open task with finished work behind it. */
export function canReturnFrom<T extends CompletionTask>(
  t: T,
  c: CompletionContext<T>,
  me: { id: string; access_level?: string | null } | null | undefined,
  projects: CompletionProject[],
  isClosedStatus: (status: string | null) => boolean = (s) => s === "Done" || s === "Cancelled",
): boolean {
  return (
    !isClosedStatus(t.status) &&
    (t.assignee_id === me?.id || me?.access_level === "full" || projects.find((p) => p.id === t.project_id)?.owner_id === me?.id) &&
    returnableFor(t, c).length > 0
  );
}

export function nextOpenAfter<T extends CompletionTask>(t: T, c: CompletionContext<T>): T | undefined {
  return c.deps
    .filter((d) => d.depends_on_task_id === t.id)
    .map((d) => c.tasks.find((x) => x.id === d.task_id))
    .find((x): x is T => !!x && !x.is_archived && x.status !== "Done" && x.status !== "Cancelled");
}

/** Plain words for what finishing this task does: [before, after]. */
export function completionWords<T extends CompletionTask>(t: T, actionLabel: string, c: CompletionContext<T>, personName: (id: string | null | undefined) => string | null): [string, string] {
  if (actionLabel === "Ready for Review") {
    // After a sign-off sent it back, the earlier review is already Done --
    // name the first check that is still open (the approver).
    let rv: T | undefined = reviewersOf(t, c)[0];
    for (let i = 0; i < 5 && rv && rv.status === "Done"; i++) rv = reviewersOf(rv, c)[0] ?? rv;
    if (rv && rv.status === "Done") rv = reviewersOf(t, c)[0];
    const who = personName(rv?.assignee_id);
    return [who ? `Sends your work to ${who} for review.` : "Sends your work for review.", who ? `Sent to ${who} for review.` : "Sent for review."];
  }
  const nx = nextOpenAfter(t, c);
  const nxWho = personName(nx?.assignee_id);
  const nextBit = nx ? ` Next: ${nx.name}${nxWho ? ` (${nxWho})` : ""}.` : "";
  if (actionLabel === "Pass QA") return [`Passes QA.${nextBit}`, `QA passed.${nextBit}`];
  if (actionLabel === "Approve") return [`Approves the work.${nextBit}`, `Approved.${nextBit}`];
  return [`Closes the task.${nextBit}`, `Marked done.${nextBit}`];
}

// phase228 (2026-10-27, Sandra): which completion rule applies when a regular
// task is marked Done (the database applies the same rules and has the last word).
export function completionTimingFor<T extends CompletionTask>(
  t: T,
  actionLabel: string,
  project: CompletionProject | undefined,
  hasChildren: boolean,
  holidayDates: Set<string>,
): { kind: CompletionTimingKind; due: string } | undefined {
  if (actionLabel !== "Mark Done") return undefined; // review chain unchanged
  const p = project;
  if (!p || (p.wbs_status ?? "draft") === "draft" || p.wbs_status === "closed") return undefined;
  if (hasChildren) return undefined;
  const due = t.current_due_date ? t.current_due_date.slice(0, 10) : null;
  if (!due) return undefined;
  const today = toISO(new Date());
  const created = t.created_at ? toISO(new Date(t.created_at)) : null;
  if (created && created >= "2026-10-13" && due < created) return { kind: "logged_late", due };
  if (today < due) return { kind: "early", due };
  if (today === due) return { kind: "on_time", due };
  let d = new Date(due + "T00:00:00");
  do { d = new Date(d.getTime() + 86400000); } while (!isWorkingDay(d, holidayDates));
  return { kind: today <= toISO(d) ? "grace" : "late", due };
}

/** Parent Status rule (2026-09-07 / 09-10): cancelled children are left out. */
export function deriveParentStatus(childStatuses: (string | null)[]): "Not Started" | "In Progress" | "Done" {
  const relevant = childStatuses.filter((s) => s !== "Cancelled");
  if (relevant.length === 0) return "Not Started";
  if (relevant.every((s) => s === "Done")) return "Done";
  if (relevant.every((s) => !s || s === "Not Started")) return "Not Started";
  return "In Progress";
}
