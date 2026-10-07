// 2026-10-08 (Sandra, item J): data for deciding a Start Project / Close
// Project request straight from Approval Center.
//
// decide_baseline_request / decide_wbs_closure (the SAME RPCs WbsPlanning.tsx
// calls) need a per-task snapshot of the plan. The WBS page builds it from its
// live on-screen schedule; that schedule engine lives inside the page, so here
// the snapshot is built from the LAST SAVED plan instead:
//   - Forecasted / Manual dates ("standard" slot): what Save wrote onto the
//     task (start_date / current_due_date). Done and Cancelled tasks use the
//     same historical rule as the WBS page (start_date_standard ?? due, due).
//     Falls back to the last saved Manual planning snapshot.
//   - Theoretical dates ("full" slot): the last saved full_capacity planning
//     snapshot (task_planning_snapshots, written by every WBS Save); falls
//     back to start_date_full + Estimated hours at the full-capacity rate.
//   - Parent tasks: earliest Start / latest End of their sub-tasks.
// A Start Project request can only be sent after Save, so for a Draft this
// matches what the requester sent.
import { supabase } from "./supabaseClient";
import { fetchAllRows } from "./fetchAllRows";
import { fullCapacityScenario } from "./taskScheduling";
import { toISO, type HolidaySet } from "./workingDays";
import type { ChecklistTask } from "./startProjectChecklist";

export interface DecisionProject {
  id: string;
  name: string;
  wbs_status: string | null;
  planning_type_id: string | null;
  project_type_id: string | null;
  priority: string | null;
  category: string | null;
  source_id: string | null;
  effort_level: string | null;
  description: string | null;
  status: string | null;
  phase: string | null;
  actual_close_date: string | null;
  lessons_learned_worked: string | null;
  lessons_learned_not_worked: string | null;
}

export interface DecisionTask extends ChecklistTask {
  name: string;
  start_date: string | null;
  start_date_full: string | null;
  start_date_standard: string | null;
  manual_end_date: string | null;
  current_due_date: string | null;
  effort: string | null;
  output_count: number | null;
  sort_order: number | null;
}

export interface ProjectPlanForDecision {
  project: DecisionProject;
  tasks: DecisionTask[];
  payload: Record<string, unknown>[];
  dependencyConflicts: string[];
  pastDated: string[];
  outputTypes: { id: string; counts_deliverable: boolean | null }[];
}

type Entry = { start: string; end: string } | null;
const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);
const isLocked = (status: string | null) => status === "Done" || status === "Cancelled";

export async function loadProjectPlanForDecision(projectId: string, holidays: HolidaySet): Promise<{ plan?: ProjectPlanForDecision; error?: unknown }> {
  const [{ data: proj, error: projErr }, { data: taskData, error: taskErr }, { data: peopleData }, { data: otData }] = await Promise.all([
    supabase
      .from("projects")
      .select("id,name,wbs_status,planning_type_id,project_type_id,priority,category,source_id,effort_level,description,status,phase,actual_close_date,lessons_learned_worked,lessons_learned_not_worked")
      .eq("id", projectId)
      .single(),
    supabase
      .from("tasks")
      .select("id,parent_task_id,name,assignee_id,status,start_date,start_date_full,start_date_standard,manual_end_date,current_due_date,estimated_hours,effort,output_type_id,output_count,sort_order")
      .eq("project_id", projectId)
      .eq("is_archived", false),
    supabase.from("people").select("id,name"),
    supabase.from("output_types").select("id,counts_deliverable"),
  ]);
  if (projErr || !proj) return { error: projErr ?? new Error("Project not found") };
  if (taskErr) return { error: taskErr };
  const raw = (taskData as DecisionTask[]) ?? [];

  // Same order as WbsPlanning's computeOrderedTasks: roots by sort_order, each followed by its sub-tasks.
  const bySort = (a: DecisionTask, b: DecisionTask) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  const tasks: DecisionTask[] = [];
  for (const r of raw.filter((t) => !t.parent_task_id).sort(bySort)) {
    tasks.push(r);
    for (const c of raw.filter((t) => t.parent_task_id === r.id).sort(bySort)) tasks.push(c);
  }
  const ids = tasks.map((t) => t.id);
  const parentIds = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));

  let deps: { task_id: string; depends_on_task_id: string }[] = [];
  let snaps: { task_id: string; mode: string; target_start_date: string; computed_due_date: string }[] = [];
  if (ids.length) {
    const [{ data: depData }, snapRes] = await Promise.all([
      supabase.from("task_dependencies").select("task_id,depends_on_task_id").in("task_id", ids),
      fetchAllRows<{ task_id: string; mode: string; target_start_date: string; computed_due_date: string }>((f, t) =>
        supabase
          .from("task_planning_snapshots")
          .select("task_id,mode,target_start_date,computed_due_date,computed_at,id")
          .in("task_id", ids)
          .in("mode", ["full_capacity", "manual"])
          .order("computed_at", { ascending: false })
          .order("id")
          .range(f, t)
      ),
    ]);
    deps = (depData as typeof deps) ?? [];
    snaps = snapRes.data;
  }
  // Newest snapshot per task per mode (rows arrive newest first).
  const latest = new Map<string, { start: string; end: string }>();
  for (const s of snaps) {
    const k = `${s.task_id}:${s.mode}`;
    if (!latest.has(k)) latest.set(k, { start: d10(s.target_start_date)!, end: d10(s.computed_due_date)! });
  }

  function leafFull(t: DecisionTask): Entry {
    const snap = latest.get(`${t.id}:full_capacity`);
    if (snap) return snap;
    const start = d10(t.start_date_full);
    if (!start || t.estimated_hours == null) return null;
    return { start, end: fullCapacityScenario(t.estimated_hours, start, holidays).dueDate };
  }
  function leafStandard(t: DecisionTask): Entry {
    const due = d10(t.current_due_date);
    if (isLocked(t.status) && due) return { start: d10(t.start_date_standard) ?? due, end: due };
    const start = d10(t.start_date);
    if (start && due) return { start, end: due };
    return latest.get(`${t.id}:manual`) ?? null;
  }
  function buildChain(leaf: (t: DecisionTask) => Entry): Map<string, Entry> {
    const out = new Map<string, Entry>();
    for (const t of tasks) if (!(!t.parent_task_id && parentIds.has(t.id))) out.set(t.id, leaf(t));
    for (const t of tasks) {
      if (t.parent_task_id || !parentIds.has(t.id)) continue;
      const kids = tasks.filter((c) => c.parent_task_id === t.id).map((c) => out.get(c.id) ?? null);
      const ok = kids.filter((e): e is { start: string; end: string } => !!e);
      out.set(
        t.id,
        ok.length && ok.length === kids.length
          ? { start: ok.reduce((m, e) => (e.start < m ? e.start : m), ok[0].start), end: ok.reduce((m, e) => (e.end > m ? e.end : m), ok[0].end) }
          : null
      );
    }
    return out;
  }
  const full = buildChain(leafFull);
  const standard = buildChain(leafStandard);
  const nameOf = (id: string | null) => (peopleData as { id: string; name: string }[] | null)?.find((p) => p.id === id)?.name ?? null;
  const dependsOn = (id: string) => deps.filter((d) => d.task_id === id).map((d) => d.depends_on_task_id);

  // Same shape as WbsPlanning's buildTaskSnapshotPayload.
  const payload = tasks.map((t) => ({
    task_id: t.id,
    parent_task_id: t.parent_task_id,
    name: t.name,
    estimated_hours: t.estimated_hours,
    assignee_name: nameOf(t.assignee_id),
    effort: t.effort,
    depends_on: dependsOn(t.id),
    start_date_full: full.get(t.id)?.start ?? null,
    end_date_full: full.get(t.id)?.end ?? null,
    start_date_standard: standard.get(t.id)?.start ?? null,
    end_date_standard: standard.get(t.id)?.end ?? null,
    status: t.status,
  }));

  // Same rule as WbsPlanning's dependencyConflict(t, "full_capacity").
  const dependencyConflicts = tasks
    .filter((t) => {
      const own = full.get(t.id);
      if (!own) return false;
      return dependsOn(t.id).some((depId) => {
        const depTask = tasks.find((x) => x.id === depId);
        const depEnd = full.get(depId)?.end ?? d10(depTask?.manual_end_date) ?? d10(depTask?.current_due_date);
        return !!depEnd && own.start <= depEnd;
      });
    })
    .map((t) => t.name || "Untitled task");

  // Same rule as WbsPlanning's pastDatedOpenTasks.
  const today = toISO(new Date());
  const pastDated = tasks
    .filter((t) => {
      if (parentIds.has(t.id) || isLocked(t.status)) return false;
      const end = standard.get(t.id)?.end ?? d10(t.current_due_date);
      return !!end && end < today;
    })
    .map((t) => t.name || "Untitled task");

  return {
    plan: {
      project: proj as DecisionProject,
      tasks,
      payload,
      dependencyConflicts,
      pastDated,
      outputTypes: (otData as { id: string; counts_deliverable: boolean | null }[]) ?? [],
    },
  };
}
