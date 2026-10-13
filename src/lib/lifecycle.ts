// R2.1 L&D lifecycle (2026-10-13, Sandra): phases + milestones for NEW
// projects (projects.lifecycle_version = 2). See supabase/phase183_r2_lifecycle.sql.
//
// - Five standard phases. Each project chooses which apply while it is
//   Draft ("not every project needs scoping or design"); the choice locks
//   at Start Project.
// - One milestone closes each phase. Start Project reaches "Scope
//   Confirmed"; Close Project reaches "Project Closed"; the others are
//   reached when every task linked to them is Done or Cancelled.
// - The database moves the project's Phase forward (r2_recompute), skipping
//   phases the project doesn't use.

export interface LifecyclePhase {
  key: string;
  label: string;
  sort_order: number;
  project_phase: string;
  milestone_name: string;
  milestone_kind: "start" | "deliverables" | "close";
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  phase_key: string;
  name: string;
  kind: "start" | "deliverables" | "close";
  sort_order: number;
  is_included: boolean;
  reached_at: string | null;
}

export interface MilestoneDependency {
  milestone_id: string;
  task_id: string;
}

// Same values as the seed in phase183 -- used if the lookup table can't be
// read (e.g. the SQL hasn't been run yet), so the page never breaks.
export const FALLBACK_LIFECYCLE_PHASES: LifecyclePhase[] = [
  { key: "analysis", label: "Analysis & Scoping", sort_order: 1, project_phase: "Scoping", milestone_name: "Scope Confirmed", milestone_kind: "start" },
  { key: "design", label: "Learning Design", sort_order: 2, project_phase: "Design", milestone_name: "Design Approved", milestone_kind: "deliverables" },
  { key: "development", label: "Learning Development", sort_order: 3, project_phase: "Development", milestone_name: "Materials Approved", milestone_kind: "deliverables" },
  { key: "delivery", label: "Implementation / Delivery", sort_order: 4, project_phase: "Delivery", milestone_name: "Program Delivered", milestone_kind: "deliverables" },
  { key: "evaluation", label: "Evaluation & Closure", sort_order: 5, project_phase: "Evaluation", milestone_name: "Project Closed", milestone_kind: "close" },
];

export const PHASE_COLORS: Record<string, { fg: string; bg: string; border: string }> = {
  analysis: { fg: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
  design: { fg: "#16A34A", bg: "#F0FDF4", border: "#BBF7D0" },
  development: { fg: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" },
  delivery: { fg: "#EA580C", bg: "#FFF7ED", border: "#FED7AA" },
  evaluation: { fg: "#DB2777", bg: "#FDF2F8", border: "#FBCFE8" },
};

export function isLifecycleProject(p: { lifecycle_version?: number | null } | null | undefined): boolean {
  return p?.lifecycle_version === 2;
}

/** Label for a stored projects.phase value on a v2 project ("Design" -> "Learning Design"). */
export function lifecycleLabelForProjectPhase(phase: string | null | undefined, phases: LifecyclePhase[] = FALLBACK_LIFECYCLE_PHASES): string | null {
  if (!phase) return null;
  return phases.find((p) => p.project_phase === phase)?.label ?? phase;
}

/** Start Project checks for a v2 project. Returns checklist item strings per group. */
export function lifecycleStartIssues(
  milestones: ProjectMilestone[],
  deps: MilestoneDependency[],
  rootTasks: { id: string; name: string | null; wbs_phase?: string | null; status: string | null; is_scoping?: boolean | null }[],
  phases: LifecyclePhase[]
): { noPhases: boolean; milestonesWithoutTasks: string[]; tasksWithoutPhase: string[] } {
  const included = milestones.filter((m) => m.is_included);
  const includedKeys = new Set(included.map((m) => m.phase_key));
  const label = (k: string) => phases.find((p) => p.key === k)?.label ?? k;
  return {
    noPhases: included.filter((m) => m.kind !== "start").length === 0,
    milestonesWithoutTasks: included
      .filter((m) => m.kind === "deliverables" && !deps.some((d) => d.milestone_id === m.id))
      .map((m) => `${m.name} (${label(m.phase_key)})`),
    tasksWithoutPhase: rootTasks
      .filter((t) => !t.is_scoping && t.status !== "Cancelled" && (!t.wbs_phase || !includedKeys.has(t.wbs_phase)))
      .map((t) => (t.name && t.name.trim() ? t.name : "Untitled task")),
  };
}
