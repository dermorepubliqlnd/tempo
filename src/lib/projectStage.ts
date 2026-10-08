// phase178 (2026-10-09, Sandra item G): ONE project lifecycle -- "Stage".
// Worked out in the DB (projects.stage, trigger a_project_lifecycle) from
// Status + WBS Status + pending Start/Close requests. Status, WBS Status and
// Phase stay underneath. "Plan changed" is deliberately not a Stage.
export const PROJECT_STAGES = ["Draft", "Awaiting Start", "Active", "Closing", "Paused", "Closed", "Cancelled"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_TONES: Record<string, string> = {
  Draft: "neutral",
  "Awaiting Start": "gold",
  Active: "accent",
  Closing: "orange",
  Paused: "purple",
  Closed: "success",
  Cancelled: "danger",
};

export const PROJECT_STAGE_HINTS: Record<string, string> = {
  Draft: "Being planned. Tasks stay private to the owner and their leaders until Start Project.",
  "Awaiting Start": "A Start Project request is waiting for approval.",
  Active: "Started -- the team is working on it.",
  Closing: "A Close Project request is waiting for approval.",
  Paused: "On hold. Resume it to carry on.",
  Closed: "Close Project approved. Final numbers are locked.",
  Cancelled: "Stopped before it was finished.",
};

type StageInput = { stage?: string | null; status?: string | null; wbs_status?: string | null };

/** Stage from the DB column, with a client fallback for rows loaded before it existed. */
export function projectStageOf(p: StageInput): ProjectStage {
  if (p.stage && (PROJECT_STAGES as readonly string[]).includes(p.stage)) return p.stage as ProjectStage;
  if (p.status === "Cancelled") return "Cancelled";
  if (p.wbs_status === "closed") return "Closed";
  if (p.status === "Paused") return "Paused";
  if (!p.wbs_status || p.wbs_status === "draft") return "Draft";
  return "Active";
}

/** Old Status filter values on saved views -> Stage values. */
const LEGACY_STATUS_TO_STAGES: Record<string, ProjectStage[]> = {
  "Not Started": ["Draft", "Awaiting Start"],
  "In Progress": ["Active", "Closing"],
  Completed: ["Closed"],
};
export function normalizeStageFilter(values: string[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    for (const s of LEGACY_STATUS_TO_STAGES[v] ?? [v]) if (!out.includes(s)) out.push(s);
  }
  return out;
}
