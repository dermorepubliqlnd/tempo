// 2026-10-08 (Sandra, item F): Start Project shows ONE checklist instead of a
// chain of one-at-a-time pop-ups. Every rule below is the same rule
// WbsPlanning.tsx's handleRequestBaseline used to check in sequence (see the
// dated comments there for why each one exists) -- only the presentation
// changed. Pure: callers pass in what they already have (the WBS page passes
// its live schedule results; Approval Center passes the last saved plan, see
// lib/projectDecisionData.ts).

export interface ChecklistGroup {
  key: string;
  label: string;
  /** One-line explanation shown under the label. */
  hint?: string;
  items: string[];
  /** Blocks the action until fixed. */
  blocking: boolean;
  /** Blocking for most people, but the person may override (Full Access
   * on request; the approver on approval). */
  overridable?: boolean;
  /** Not blocking: a warning the person confirms ("Start anyway"). */
  warning?: boolean;
}

export interface ChecklistProject {
  wbs_status?: string | null;
  planning_type_id: string | null;
  project_type_id: string | null;
  priority: string | null;
  category: string | null;
  source_id: string | null;
  effort_level: string | null;
  description: string | null;
}

export interface ChecklistTask {
  id: string;
  name: string | null;
  parent_task_id: string | null;
  estimated_hours: number | null;
  assignee_id: string | null;
  output_type_id: string | null;
  status: string | null;
}

export interface StartChecklistInput {
  project: ChecklistProject;
  tasks: ChecklistTask[];
  /** Names of tasks that start on or before the End of a task they depend on (Theoretical). */
  dependencyConflicts: string[];
  /** Names of open leaf tasks whose End date is already in the past. */
  pastDated: string[];
  hasUnsavedChanges?: boolean;
  /** The approver's run of the list. Skips Description: Sandra 2026-09-07
   * made Description the requester's job only ("not the approver of
   * baseline"), so it is never re-checked on approval. */
  forApprover?: boolean;
}

const taskLabel = (t: ChecklistTask) => (t.name && t.name.trim() ? t.name : "Untitled task");

export function startProjectChecklist(input: StartChecklistInput): ChecklistGroup[] {
  const { project, tasks, forApprover } = input;
  const groups: ChecklistGroup[] = [];
  const parentIds = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  const isTopParent = (t: ChecklistTask) => !t.parent_task_id && parentIds.has(t.id);

  if (input.hasUnsavedChanges) {
    groups.push({ key: "unsaved", label: "Unsaved changes", hint: "Save your latest changes first.", items: [], blocking: true });
  }
  if (tasks.length === 0) {
    groups.push({ key: "no_tasks", label: "No tasks yet", hint: "Add at least one task.", items: [], blocking: true });
  }

  // Project Details (2026-09-03 / 2026-09-07). No override.
  const missing: string[] = [];
  if (!project.planning_type_id) missing.push("Planning Type");
  if (!project.project_type_id) missing.push("Project Type");
  if (!project.priority) missing.push("Priority");
  if (!project.category) missing.push("Category");
  if (!project.source_id) missing.push("Source");
  if (!project.effort_level) missing.push("Complexity");
  if (!forApprover && !project.description) missing.push("Description");
  if (missing.length) {
    groups.push({ key: "project_fields", label: "Project details missing", hint: "Fill these in under Project Details or on the Projects & Tasks list.", items: missing, blocking: true });
  }

  // softIssues() (2026-08-26): placeholder names, missing hours, dependency
  // conflicts. Full Access may start anyway.
  const noName = tasks.filter((t) => !t.name || !t.name.trim() || t.name === "Untitled task" || t.name === "Untitled sub-task");
  if (noName.length) {
    groups.push({ key: "placeholder_names", label: "Placeholder task names", hint: "Give these tasks a real name.", items: noName.map(taskLabel), blocking: true, overridable: true });
  }
  // Checks estimated_hours, not the trigger-derived `effort` column (Phase 24:
  // effort lags until Save round-trips).
  const noHours = tasks.filter((t) => t.estimated_hours == null && !isTopParent(t));
  if (noHours.length) {
    groups.push({ key: "missing_hours", label: "Estimated hours missing", items: noHours.map(taskLabel), blocking: true, overridable: true });
  }
  if (input.dependencyConflicts.length) {
    groups.push({ key: "dependency_conflicts", label: "Dependency date conflicts", hint: "These start on or before the End of a task they depend on.", items: input.dependencyConflicts, blocking: true, overridable: true });
  }

  // phase126j: every leaf task needs an Assignee (also enforced in the DB).
  const noAssignee = tasks.filter((t) => !t.assignee_id && !parentIds.has(t.id) && t.status !== "Cancelled");
  if (noAssignee.length) {
    groups.push({ key: "assignee", label: "Assignee missing", hint: "Parent tasks don't need one; they use their sub-tasks' assignees.", items: noAssignee.map(taskLabel), blocking: true });
  }
  // Output Type (2026-09-03): top-level parents exempt. Output Count stays optional until Close Project.
  const noOutput = tasks.filter((t) => !t.output_type_id && !isTopParent(t));
  if (noOutput.length) {
    groups.push({ key: "output_type", label: "Output Type missing", hint: "Output Count can stay blank until you close the project.", items: noOutput.map(taskLabel), blocking: true });
  }

  // phase157d: past dates are a warning, not a blocker.
  if (input.pastDated.length) {
    groups.push({ key: "past_dates", label: "Dates in the past", hint: "Once the project starts, these show as Overdue for the people assigned.", items: input.pastDated, blocking: false, warning: true });
  }
  return groups;
}

/** True when something on the list stops the action for this person. */
export function checklistBlocks(groups: ChecklistGroup[], canOverride: boolean): boolean {
  return groups.some((g) => g.blocking && !(g.overridable && canOverride));
}

// 2026-10-08 (item J): the Close Project approver's checks, shared so
// Approval Center's inline Approve applies the same gate as
// WbsPlanning.tsx's handleDecideClosure (task-completion is request-side
// only, per Sandra 2026-09-21).
export interface CloseChecklistProject {
  status: string | null;
  phase: string | null;
  category: string | null;
  priority: string | null;
  source_id: string | null;
  effort_level: string | null;
  description: string | null;
  actual_close_date: string | null;
  lessons_learned_worked: string | null;
  lessons_learned_not_worked: string | null;
}
export interface CloseChecklistTask extends ChecklistTask {
  output_count: number | null;
}
export function closeProjectApproverChecklist(
  project: CloseChecklistProject,
  tasks: CloseChecklistTask[],
  outputTypes: { id: string; counts_deliverable?: boolean | null }[]
): ChecklistGroup[] {
  const groups: ChecklistGroup[] = [];
  const missing: string[] = [];
  if (!project.status) missing.push("Status");
  if (!project.phase) missing.push("Phase");
  if (!project.category) missing.push("Category");
  if (!project.priority) missing.push("Priority");
  if (!project.source_id) missing.push("Source");
  if (!project.effort_level) missing.push("Complexity");
  if (!project.description) missing.push("Description");
  if (!project.actual_close_date) missing.push("Actual Project Close Date");
  if (!project.lessons_learned_worked) missing.push("Lessons Learned (What Worked)");
  if (!project.lessons_learned_not_worked) missing.push("Lessons Learned (What Didn't Work)");
  if (missing.length) groups.push({ key: "project_fields", label: "Project details missing", hint: "Fill these in on the Projects & Tasks list.", items: missing, blocking: true });
  const parentIds = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  const noCount = tasks.filter(
    (t) =>
      t.status !== "Cancelled" &&
      outputTypes.find((o) => o.id === t.output_type_id)?.counts_deliverable !== false &&
      (t.output_count === null || t.output_count === undefined || t.output_count < 1) &&
      !(!t.parent_task_id && parentIds.has(t.id))
  );
  if (noCount.length) groups.push({ key: "output_count", label: "Output Count missing", hint: "Each needs an Output Count of 1 or more.", items: noCount.map(taskLabel), blocking: true });
  return groups;
}
