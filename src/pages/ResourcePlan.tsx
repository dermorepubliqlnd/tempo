import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, GripVertical, RotateCcw, Save } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { type ProjectRow, type TaskRow } from "./Projects";
import { formatDate } from "../lib/formatDate";
import { TASK_STATUS_GROUPED, statusGroupOf } from "../lib/notionOptions";
import {
  createAllocationEngine,
  dailyCapacityHours,
  type UtilProjectRow,
  type UtilTaskRow,
} from "../lib/dailyAllocation";
import { addDays, buildHolidaySet, isWorkingDay, parseLocalDate, toISO } from "../lib/workingDays";

interface PersonRow {
  id: string;
  name: string;
  daily_capacity_hours: number;
  is_active: boolean;
}

interface AvailabilityRow {
  person_id: string;
  date: string;
  status: "off" | "half_day";
}

type PeriodKey = "this_week" | "next_week" | "next_2_weeks" | "this_month";

interface PendingChange {
  start_date?: string | null;
  current_due_date?: string | null;
  assignee_id?: string | null;
}

interface DragState {
  taskId: string;
  mode: "move" | "resize-start" | "resize-end";
  startX: number;
  width: number;
  originalStart: string;
  originalDue: string;
  visibleStart: string;
  visibleEnd: string;
}

function cardStyle(): React.CSSProperties {
  return {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    minWidth: 0,
  };
}

function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = (day + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function periodDates(key: PeriodKey): Date[] {
  const today = new Date();
  const monday = startOfWeek(today);
  if (key === "this_week") return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  if (key === "next_week") {
    const start = addDays(monday, 7);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  if (key === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    return Array.from({ length: days }, (_, i) => addDays(start, i));
  }
  return Array.from({ length: 14 }, (_, i) => addDays(today, i));
}

function pctTone(pct: number | null) {
  if (pct == null) return { bg: "var(--hover-bg)", fg: "var(--muted)" };
  if (pct > 100) return { bg: "#fff1f1", fg: "var(--danger-text)" };
  if (pct >= 80) return { bg: "#fff7e8", fg: "var(--warning-text)" };
  return { bg: "#ecfdf3", fg: "var(--success-text)" };
}

function bandwidthTone(pct: number | null) {
  if (pct == null) return { bg: "var(--hover-bg)", fg: "var(--muted)" };
  if (pct < 0) return { bg: "#fff1f1", fg: "var(--danger-text)" };
  if (pct <= 20) return { bg: "#fff7e8", fg: "var(--warning-text)" };
  return { bg: "#ecfdf3", fg: "var(--success-text)" };
}

const PLANNER_META_W = 460;
const TASK_W = 240;
const ASSIGNEE_W = 145;
const SCOPED_W = 75;
const DAY_W = 64;
const AVG_W = 70;

export default function ResourcePlan() {
  const { projectId } = useParams<{ projectId: string }>();
  const { person: me } = useSession();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [holidayDates, setHolidayDates] = useState<string[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("next_2_weeks");
  const [changes, setChanges] = useState<Record<string, PendingChange>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [projectRes, tasksRes, allTasksRes, projectsRes, peopleRes, availabilityRes, holidaysRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).single(),
        supabase.from("tasks").select("*").eq("project_id", projectId).eq("is_archived", false),
        supabase.from("tasks").select("*").eq("is_archived", false),
        supabase.from("projects").select("*").eq("is_archived", false).eq("is_unsaved", false),
        supabase.from("people").select("id,name,daily_capacity_hours,is_active"),
        supabase.from("person_availability").select("person_id,date,status"),
        supabase.from("holidays").select("date"),
      ]);
      if (cancelled) return;
      setProject((projectRes.data as ProjectRow | null) ?? null);
      setTasks((tasksRes.data as TaskRow[] | null) ?? []);
      setAllTasks((allTasksRes.data as TaskRow[] | null) ?? []);
      setAllProjects((projectsRes.data as ProjectRow[] | null) ?? []);
      setPeople((peopleRes.data as PersonRow[] | null) ?? []);
      setAvailability((availabilityRes.data as AvailabilityRow[] | null) ?? []);
      setHolidayDates(((holidaysRes.data as { date: string }[] | null) ?? []).map((h) => h.date));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const days = useMemo(() => periodDates(period), [period]);
  const holidaySet = useMemo(() => buildHolidaySet(holidayDates), [holidayDates]);

  function effectiveTask(task: TaskRow): TaskRow {
    const ch = changes[task.id];
    if (!ch) return task;
    return {
      ...task,
      start_date: ch.start_date !== undefined ? ch.start_date : task.start_date,
      current_due_date: ch.current_due_date !== undefined && ch.current_due_date !== null ? ch.current_due_date : task.current_due_date,
      assignee_id: ch.assignee_id !== undefined ? ch.assignee_id : task.assignee_id,
    };
  }

  function setTaskChange(taskId: string, patch: PendingChange) {
    setChanges((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] ?? {}), ...patch } }));
    setApplyMessage(null);
  }

  function clampDate(iso: string, minIso: string | null, maxIso: string | null) {
    if (minIso && iso < minIso) return minIso;
    if (maxIso && iso > maxIso) return maxIso;
    return iso;
  }

  function beginDrag(e: React.PointerEvent<HTMLElement>, task: TaskRow, mode: DragState["mode"]) {
    e.preventDefault();
    e.stopPropagation();

    const effective = effectiveTask(task);
    const start = effective.start_date?.slice(0, 10) ?? effective.current_due_date?.slice(0, 10);
    const due = effective.current_due_date?.slice(0, 10);
    if (!start || !due) return;

    const handle = e.currentTarget as HTMLElement;
    const timeline = handle.closest("[data-task-timeline]") as HTMLElement | null;
    if (!timeline) return;

    const rect = timeline.getBoundingClientRect();
    const drag: DragState = {
      taskId: task.id,
      mode,
      startX: e.clientX,
      width: rect.width,
      originalStart: start,
      originalDue: due,
      visibleStart: start < timelineStart ? timelineStart : start,
      visibleEnd: due > timelineEnd ? timelineEnd : due,
    };

    setDragState(drag);

    // Attach listeners immediately on pointer-down rather than waiting for a
    // React effect/render cycle. This keeps drag/resize responsive even when
    // the scenario recalculation re-renders the planner on every movement.
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is an enhancement; window listeners below are enough.
    }

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const pxPerDay = drag.width / Math.max(days.length, 1);
      const delta = Math.round((ev.clientX - drag.startX) / Math.max(pxPerDay, 1));
      const originalStart = parseLocalDate(drag.originalStart);
      const originalDue = parseLocalDate(drag.originalDue);
      let nextStart = drag.originalStart;
      let nextDue = drag.originalDue;

      if (drag.mode === "move") {
        const durationDays = Math.max(
          0,
          Math.round((originalDue.getTime() - originalStart.getTime()) / 86400000)
        );
        const visibleAnchor = parseLocalDate(drag.visibleStart);
        nextStart = toISO(addDays(visibleAnchor, delta));
        nextDue = toISO(addDays(parseLocalDate(nextStart), durationDays));

        const projectMin = project?.start_date?.slice(0, 10) ?? null;
        const projectMax = project?.end_date?.slice(0, 10) ?? null;
        if (projectMin && nextStart < projectMin) {
          nextStart = projectMin;
          nextDue = toISO(addDays(parseLocalDate(nextStart), durationDays));
        }
        if (projectMax && nextDue > projectMax) {
          nextDue = projectMax;
          nextStart = toISO(addDays(parseLocalDate(nextDue), -durationDays));
        }
      } else if (drag.mode === "resize-start") {
        const anchor = parseLocalDate(drag.visibleStart);
        nextStart = clampDate(
          toISO(addDays(anchor, delta)),
          project?.start_date?.slice(0, 10) ?? null,
          drag.originalDue
        );
      } else {
        const anchor = parseLocalDate(drag.visibleEnd);
        nextDue = clampDate(
          toISO(addDays(anchor, delta)),
          drag.originalStart,
          project?.end_date?.slice(0, 10) ?? null
        );
      }

      setTaskChange(drag.taskId, { start_date: nextStart, current_due_date: nextDue });
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        // no-op
      }
      setDragState(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  const pendingCount = Object.keys(changes).length;

  async function applyChanges() {
    if (!project || !me || pendingCount === 0) return;
    setApplying(true);
    setApplyMessage(null);
    try {
      const dueLockedConflicts: string[] = [];
      for (const task of tasks) {
        const ch = changes[task.id];
        if (!ch) continue;
        const dueLocked = Boolean((task as TaskRow & { due_locked?: boolean }).due_locked);
        const nextDue = ch.current_due_date ?? task.current_due_date;
        if (dueLocked && nextDue !== task.current_due_date) dueLockedConflicts.push(task.name);
      }
      if (dueLockedConflicts.length) {
        throw new Error(
          `${dueLockedConflicts.length} task${dueLockedConflicts.length === 1 ? "" : "s"} have locked due dates. Their proposed move/resize changes the Due Date and must go through the existing extension approval workflow first.`
        );
      }

      for (const task of tasks) {
        const ch = changes[task.id];
        if (!ch) continue;
        const nextStart = ch.start_date !== undefined ? ch.start_date : task.start_date;
        const nextDue = ch.current_due_date !== undefined && ch.current_due_date !== null ? ch.current_due_date : task.current_due_date;
        const scheduleChanged = nextStart !== task.start_date || nextDue !== task.current_due_date;
        const assigneeChanged = ch.assignee_id !== undefined && ch.assignee_id !== task.assignee_id;

        if (scheduleChanged) {
          const { error } = await supabase.rpc("wbs_save_task_schedule", {
            p_task_id: task.id,
            p_start: nextStart,
            p_due: nextDue,
          });
          if (error) throw error;
        }
        if (assigneeChanged) {
          const { error } = await supabase.from("tasks").update({ assignee_id: ch.assignee_id ?? null }).eq("id", task.id);
          if (error) throw error;
        }
      }

      if (project.wbs_status === "baseline_locked" || project.wbs_status === "changed_after_baseline") {
        const { error } = await supabase.rpc("record_wbs_edit", { p_project_id: project.id });
        if (error) throw error;
      }

      const nextTasks = tasks.map(effectiveTask);
      setTasks(nextTasks);
      setAllTasks((prev) => prev.map((t) => {
        const local = nextTasks.find((x) => x.id === t.id);
        return local ?? t;
      }));
      setProject((prev) => prev && prev.wbs_status === "baseline_locked" ? { ...prev, wbs_status: "changed_after_baseline" } : prev);
      setChanges({});
      setApplyMessage("Resource plan changes applied.");
    } catch (err) {
      setApplyMessage(err instanceof Error ? err.message : "Unable to apply resource plan changes.");
    } finally {
      setApplying(false);
    }
  }

  const scenarioTasks = useMemo(() => tasks.map(effectiveTask), [tasks, changes]);
  const scenarioAllTasks = useMemo(() => allTasks.map((t) => changes[t.id] ? effectiveTask(t) : t), [allTasks, changes]);

  const parentIds = useMemo(
    () => new Set(scenarioTasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string)),
    [scenarioTasks]
  );
  const leafTasks = useMemo(() => scenarioTasks.filter((t) => !parentIds.has(t.id)), [scenarioTasks, parentIds]);
  const activeTasks = useMemo(
    () =>
      leafTasks.filter((t) => {
        const group = statusGroupOf(TASK_STATUS_GROUPED, t.status);
        return group !== "complete" && group !== "cancelled";
      }),
    [leafTasks]
  );

  const contributorIds = useMemo(() => {
    const ids = new Set<string>();
    leafTasks.forEach((t) => t.assignee_id && ids.add(t.assignee_id));
    if (project?.owner_id) ids.add(project.owner_id);
    return Array.from(ids);
  }, [leafTasks, project?.owner_id]);

  const contributors = useMemo(
    () =>
      contributorIds
        .map((id) => people.find((p) => p.id === id))
        .filter((p): p is PersonRow => !!p)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [contributorIds, people]
  );

  const committedProjects = useMemo(
    () => allProjects.filter((p) => p.id === project?.id || (p.wbs_status && p.wbs_status !== "draft")),
    [allProjects, project?.id]
  );

  const orgEngine = useMemo(
    () =>
      createAllocationEngine({
        tasks: scenarioAllTasks as UtilTaskRow[],
        projects: committedProjects as UtilProjectRow[],
        holidays: holidaySet,
        availability,
        todayStr: toISO(new Date()),
      }),
    [scenarioAllTasks, committedProjects, holidaySet, availability]
  );

  const baselineOrgEngine = useMemo(
    () =>
      createAllocationEngine({
        tasks: allTasks as UtilTaskRow[],
        projects: committedProjects as UtilProjectRow[],
        holidays: holidaySet,
        availability,
        todayStr: toISO(new Date()),
      }),
    [allTasks, committedProjects, holidaySet, availability]
  );

  const projectEngine = useMemo(
    () =>
      createAllocationEngine({
        tasks: scenarioTasks as UtilTaskRow[],
        projects: project ? ([project] as UtilProjectRow[]) : [],
        holidays: holidaySet,
        availability,
        todayStr: toISO(new Date()),
      }),
    [scenarioTasks, project, holidaySet, availability]
  );

  const scopedHours = leafTasks.reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);
  const unassignedHours = leafTasks.filter((t) => !t.assignee_id).reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);

  const resourceRows = contributors.map((person) => {
    let periodHours = 0;
    let capacity = 0;
    let projectHours = 0;
    let peak = 0;
    const cells = days.map((d) => {
      const date = toISO(d);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      const holiday = !weekend && !isWorkingDay(d, holidaySet);
      const av = availability.find((a) => a.person_id === person.id && a.date === date);
      if (weekend || holiday || av?.status === "off") {
        return { date, pct: null as number | null, baselinePct: null as number | null, deltaPct: 0, bandwidthPct: null as number | null, baselineBandwidthPct: null as number | null, deltaBandwidthPct: 0, availableHours: 0, totalHours: 0, baselineTotalHours: 0, projectHours: 0, capacity: 0, label: weekend ? "Weekend" : holiday ? "Holiday" : "Off" };
      }
      const cap = dailyCapacityHours(person, av?.status === "half_day");
      const total = orgEngine.totalFor(person.id, date);
      const baselineTotal = baselineOrgEngine.totalFor(person.id, date);
      const own = projectEngine.totalFor(person.id, date);
      const loadPct = cap > 0 ? (total / cap) * 100 : 0;
      const baselineLoadPct = cap > 0 ? (baselineTotal / cap) * 100 : 0;
      const bandwidthPct = 100 - loadPct;
      const baselineBandwidthPct = 100 - baselineLoadPct;
      const deltaBandwidthPct = bandwidthPct - baselineBandwidthPct;
      const availableHours = cap - total;
      periodHours += total;
      projectHours += own;
      capacity += cap;
      peak = Math.max(peak, loadPct);
      return {
        date,
        pct: loadPct,
        baselinePct: baselineLoadPct,
        deltaPct: loadPct - baselineLoadPct,
        bandwidthPct,
        baselineBandwidthPct,
        deltaBandwidthPct,
        availableHours,
        totalHours: total,
        baselineTotalHours: baselineTotal,
        projectHours: own,
        capacity: cap,
        label: av?.status === "half_day" ? "Half day" : "Working day",
      };
    });
    const projectScoped = leafTasks
      .filter((t) => t.assignee_id === person.id)
      .reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);
    return {
      person,
      cells,
      periodHours,
      projectHours,
      capacity,
      peak,
      avg: capacity > 0 ? (periodHours / capacity) * 100 : 0,
      avgBandwidth: capacity > 0 ? 100 - (periodHours / capacity) * 100 : 0,
      projectScoped,
    };
  });

  const overloaded = resourceRows.filter((r) => r.peak > 100).length;
  const projectPlannedInPeriod = resourceRows.reduce((sum, r) => sum + r.projectHours, 0);

  const timelineStart = days.length ? toISO(days[0]) : "";
  const timelineEnd = days.length ? toISO(days[days.length - 1]) : "";
  const dayCount = Math.max(days.length, 1);

  // Keep task row sequence stable while planning. Dragging/resizing changes
  // schedule dates, so sorting by effective dates makes rows jump around
  // during interaction. Resource Plan should preserve the WBS/task sequence
  // and only move the bar horizontally.
  const taskRows = [...activeTasks].sort((a, b) => {
    const aOrder = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aCreated = a.created_at ?? "";
    const bCreated = b.created_at ?? "";
    if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);
    return a.name.localeCompare(b.name);
  });

  function taskBar(task: TaskRow) {
    const start = task.start_date?.slice(0, 10) ?? task.current_due_date?.slice(0, 10) ?? null;
    const end = task.current_due_date?.slice(0, 10) ?? start;
    if (!start || !end || !timelineStart || !timelineEnd || end < timelineStart || start > timelineEnd) return null;
    const clippedStart = start < timelineStart ? timelineStart : start;
    const clippedEnd = end > timelineEnd ? timelineEnd : end;
    const leftDays = Math.round((parseLocalDate(clippedStart).getTime() - parseLocalDate(timelineStart).getTime()) / 86400000);
    const widthDays = Math.round((parseLocalDate(clippedEnd).getTime() - parseLocalDate(clippedStart).getTime()) / 86400000) + 1;
    return {
      left: (leftDays / dayCount) * 100,
      width: Math.max((widthDays / dayCount) * 100, 1.6),
      startsBefore: start < timelineStart,
      endsAfter: end > timelineEnd,
    };
  }

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>Loading resource plan…</div>;
  if (!project) return <div style={{ padding: 24 }}>Project not found.</div>;

  const projectCode = `P-${String(project.project_number ?? "").padStart(4, "0")}`;

  return (
    <div style={{ paddingBottom: 24 }}>
      <Link to="/projects" className="back-link" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12.5 }}>
        <ArrowLeft size={13} /> Projects & Tasks
      </Link>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <h1 style={{ marginBottom: 3 }}>{project.name}</h1>
          <span className="status-pill" data-tone={project.status === "In Progress" ? "accent" : project.status === "Completed" ? "success" : project.status === "Paused" ? "purple" : "neutral"}>
            {project.status ?? "Not Started"}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{projectCode} · Project resource planning</div>
      </div>

      <div style={{ display: "flex", gap: 22, borderBottom: "1px solid var(--border)", marginTop: 16, marginBottom: 14 }}>
        <Link to={`/projects/${project.id}`} style={{ padding: "9px 2px", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>
          Overview
        </Link>
        <Link to={`/projects/${project.id}/wbs`} style={{ padding: "9px 2px", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>
          WBS
        </Link>
        <Link to={`/projects/${project.id}/resource-plan`} style={{ padding: "9px 2px", borderBottom: "2px solid var(--accent)", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}>
          Resource Plan
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
          Drag a task bar to move it · drag either edge to resize · change the assignee from the task row. Changes remain proposed until Apply.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {pendingCount > 0 && <span style={{ fontSize: 10.5, color: "var(--text-secondary)", fontWeight: 600 }}>{pendingCount} pending change{pendingCount === 1 ? "" : "s"}</span>}
          <button type="button" onClick={() => { setChanges({}); setApplyMessage(null); }} disabled={pendingCount === 0 || applying} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 7, padding: "6px 9px", fontSize: 10.5, fontWeight: 600, cursor: pendingCount ? "pointer" : "default", opacity: pendingCount ? 1 : .55 }}>
            <RotateCcw size={12} /> Discard
          </button>
          <button type="button" onClick={applyChanges} disabled={pendingCount === 0 || applying} style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid var(--accent)", background: "var(--accent)", color: "#fff", borderRadius: 7, padding: "6px 10px", fontSize: 10.5, fontWeight: 700, cursor: pendingCount && !applying ? "pointer" : "default", opacity: pendingCount && !applying ? 1 : .55 }}>
            <Save size={12} /> {applying ? "Applying…" : "Apply Changes"}
          </button>
        </div>
      </div>
      {applyMessage && (
        <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 7, fontSize: 10.5, background: applyMessage.includes("applied") ? "#ecfdf3" : "#fff7e8", color: applyMessage.includes("applied") ? "#067647" : "#b54708", border: "1px solid var(--border)" }}>
          {applyMessage}
        </div>
      )}

      <section style={{ ...cardStyle(), padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Planning Period</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Project load is shown against each contributor's total cross-project capacity.</div>
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {([
              ["this_week", "This week"],
              ["next_week", "Next week"],
              ["next_2_weeks", "Next 2 weeks"],
              ["this_month", "This month"],
            ] as [PeriodKey, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                style={{
                  border: "1px solid " + (period === key ? "var(--accent)" : "var(--border)"),
                  background: period === key ? "var(--accent-soft, #eef4ff)" : "var(--surface)",
                  color: period === key ? "var(--accent)" : "var(--text-secondary)",
                  borderRadius: 7,
                  padding: "6px 9px",
                  fontSize: 11,
                  fontWeight: period === key ? 700 : 600,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
          <div style={{ background: "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{contributors.length}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Contributors</div>
          </div>
          <div style={{ background: overloaded > 0 ? "#fff1f1" : "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: overloaded > 0 ? "var(--danger-text)" : "var(--navy)" }}>{overloaded}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Overallocated</div>
          </div>
          <div style={{ background: "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{Math.round(scopedHours * 10) / 10}h</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Project Scoped Hours</div>
            {unassignedHours > 0 && <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2 }}>{Math.round(unassignedHours * 10) / 10}h unassigned</div>}
          </div>
          <div style={{ background: "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{Math.round(projectPlannedInPeriod * 10) / 10}h</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Project Load in Period</div>
          </div>
        </div>
      </section>

      <section style={{ ...cardStyle(), marginBottom: 12, overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Available Bandwidth</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
              Remaining capacity after all committed workload. Values update live as you move, resize, or reassign tasks; negative bandwidth means the person is overloaded.
            </div>
          </div>
          <Link to="/utilization" style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Full Utilization <ExternalLink size={11} />
          </Link>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `${PLANNER_META_W}px repeat(${days.length}, ${DAY_W}px) ${AVG_W}px`, minWidth: PLANNER_META_W + days.length * DAY_W + AVG_W, fontSize: 10.5 }}>
            <div style={{ padding: "7px 10px", color: "var(--muted)", fontWeight: 700, background: "var(--hover-bg)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span>Contributor</span>
              <span style={{ fontSize: 9, fontWeight: 500, opacity: .8 }}>Date columns aligned to task plan</span>
            </div>
            {days.map((d) => {
              const date = toISO(d);
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              const holiday = !weekend && !isWorkingDay(d, holidaySet);
              return (
                <div key={date} style={{ padding: "5px 3px", textAlign: "center", borderLeft: "1px solid var(--border)", background: weekend || holiday ? "var(--hover-bg)" : "var(--surface)", color: "var(--muted)", lineHeight: 1.2 }}>
                  <div style={{ fontSize: 9.5 }}>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                  <div style={{ color: "var(--text-secondary)", fontWeight: 700, marginTop: 1 }}>{d.getDate()}</div>
                </div>
              );
            })}
            <div style={{ padding: "7px 5px", textAlign: "center", color: "var(--muted)", fontWeight: 700, background: "var(--hover-bg)", borderLeft: "1px solid var(--border)" }}>Avg Free</div>

            {resourceRows.map((r) => (
              <Fragment key={r.person.id}>
                <div style={{ padding: "8px 9px", borderTop: "1px solid var(--border)", background: "var(--surface)", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.person.name}</div>
                  <div style={{ marginTop: 2, fontSize: 9.5, color: "var(--muted)" }}>
                    {Math.round(r.projectScoped * 10) / 10}h scoped · {Math.round(r.projectHours * 10) / 10}h in period
                  </div>
                </div>
                {r.cells.map((cell) => {
                  const bandwidth = cell.bandwidthPct == null ? null : Math.round(cell.bandwidthPct * 10) / 10;
                  const tone = bandwidthTone(bandwidth);
                  const changed = bandwidth != null && Math.abs(cell.deltaBandwidthPct) >= 0.05;
                  const deltaRounded = Math.round(cell.deltaBandwidthPct * 10) / 10;
                  const availableHours = Math.round(cell.availableHours * 10) / 10;
                  return (
                    <div
                      key={cell.date}
                      title={bandwidth == null ? cell.label : `${bandwidth}% available bandwidth · ${availableHours}h remaining · ${Math.round(cell.totalHours * 10) / 10}h planned / ${Math.round(cell.capacity * 10) / 10}h capacity · ${Math.round(cell.projectHours * 10) / 10}h from this project${changed ? ` · was ${Math.round((cell.baselineBandwidthPct ?? 0) * 10) / 10}% free` : ""}`}
                      style={{
                        padding: "5px 3px",
                        borderTop: "1px solid var(--border)",
                        borderLeft: "1px solid var(--border)",
                        textAlign: "center",
                        background: tone.bg,
                        color: tone.fg,
                        minHeight: 48,
                        boxShadow: changed ? "inset 0 0 0 1px rgba(59,130,246,.35)" : "none",
                      }}
                    >
                      <div style={{ fontWeight: 800 }}>{bandwidth == null ? "—" : `${bandwidth}%`}</div>
                      {bandwidth != null && (
                        <div style={{ fontSize: 8.5, marginTop: 1, opacity: .88 }}>
                          {availableHours < 0 ? `${Math.abs(availableHours)}h over` : `${availableHours}h free`}
                        </div>
                      )}
                      {changed && (
                        <div style={{ fontSize: 8.5, marginTop: 1, fontWeight: 700, color: deltaRounded >= 0 ? "var(--success-text)" : "var(--danger-text)" }}>
                          {deltaRounded > 0 ? "+" : ""}{deltaRounded} pts
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ padding: "8px 3px", borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)", textAlign: "center", fontWeight: 800, color: bandwidthTone(Math.round(r.avgBandwidth * 10) / 10).fg }}>
                  {Math.round(r.avgBandwidth * 10) / 10}%
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </section>

      <section style={{ ...cardStyle(), overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Project Task Plan</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
              Current WBS schedule across the selected planning period. Task dates remain governed by WBS.
            </div>
          </div>
          <Link to={`/projects/${project.id}/wbs`} style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Open WBS →
          </Link>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: PLANNER_META_W + days.length * DAY_W }}>
            <div style={{ display: "grid", gridTemplateColumns: `${TASK_W}px ${ASSIGNEE_W}px ${SCOPED_W}px ${days.length * DAY_W}px`, background: "var(--hover-bg)", color: "var(--muted)", fontSize: 10, fontWeight: 700 }}>
              <div style={{ padding: "7px 9px" }}>Task</div>
              <div style={{ padding: "7px 8px", borderLeft: "1px solid var(--border)" }}>Assignee</div>
              <div style={{ padding: "7px 8px", borderLeft: "1px solid var(--border)", textAlign: "right" }}>Scoped</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, ${DAY_W}px)`, borderLeft: "1px solid var(--border)" }}>
                {days.map((d) => (
                  <div key={toISO(d)} style={{ padding: "5px 1px", textAlign: "center", borderLeft: "1px solid var(--border)", fontWeight: 600 }}>
                    <div>{d.toLocaleDateString(undefined, { weekday: "narrow" })}</div>
                    <div>{d.getDate()}</div>
                  </div>
                ))}
              </div>
            </div>

            {taskRows.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 11.5 }}>No active project tasks in the current WBS.</div>
            ) : (
              taskRows.map((task) => {
                const person = people.find((p) => p.id === task.assignee_id);
                const bar = taskBar(task);
                return (
                  <div key={task.id} style={{ display: "grid", gridTemplateColumns: `${TASK_W}px ${ASSIGNEE_W}px ${SCOPED_W}px ${days.length * DAY_W}px`, borderTop: "1px solid var(--border)", minHeight: 42, fontSize: 10.5 }}>
                    <div style={{ padding: "8px 9px", minWidth: 0 }}>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.name}</div>
                      <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2 }}>
                        {task.start_date ? formatDate(task.start_date) : "No start"} → {task.current_due_date ? formatDate(task.current_due_date) : "No due date"}
                      </div>
                    </div>
                    <div style={{ padding: "6px", borderLeft: "1px solid var(--border)" }}>
                      <select
                        value={task.assignee_id ?? ""}
                        onChange={(e) => setTaskChange(task.id, { assignee_id: e.target.value || null })}
                        style={{ width: "100%", border: changes[task.id]?.assignee_id !== undefined ? "1px solid var(--accent)" : "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", color: "var(--text-secondary)", padding: "5px 6px", fontSize: 10 }}
                      >
                        <option value="">Unassigned</option>
                        {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div style={{ padding: "8px", borderLeft: "1px solid var(--border)", textAlign: "right", fontWeight: 700 }}>
                      {task.estimated_hours != null ? `${Math.round(Number(task.estimated_hours) * 10) / 10}h` : "—"}
                    </div>
                    <div data-task-timeline style={{ position: "relative", borderLeft: "1px solid var(--border)", background: "repeating-linear-gradient(to right, transparent 0 calc((100% / " + days.length + ") - 1px), var(--border) calc((100% / " + days.length + ") - 1px) calc(100% / " + days.length + "))", userSelect: "none" }}>
                      {bar ? (
                        <div
                          title={`${task.start_date ? formatDate(task.start_date) : "No start"} → ${task.current_due_date ? formatDate(task.current_due_date) : "No due date"} · drag to move`}
                          onPointerDown={(e) => beginDrag(e, task, "move")}
                          style={{
                            position: "absolute",
                            left: `${bar.left}%`,
                            width: `${bar.width}%`,
                            top: 10,
                            height: 22,
                            borderRadius: 6,
                            background: "var(--accent)",
                            opacity: 0.88,
                            boxShadow: changes[task.id] ? "0 0 0 2px rgba(59,130,246,.18)" : bar.startsBefore || bar.endsAfter ? "inset 0 0 0 1px rgba(255,255,255,.55)" : "none",
                            cursor: dragState?.taskId === task.id ? "grabbing" : "grab",
                            touchAction: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 14,
                          }}
                        >
                          <span onPointerDown={(e) => beginDrag(e, task, "resize-start")} title="Resize start" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 7, borderRadius: "6px 0 0 6px", cursor: "ew-resize", touchAction: "none", background: "rgba(255,255,255,.22)" }} />
                          <GripVertical size={12} color="#fff" style={{ pointerEvents: "none", opacity: .9 }} />
                          <span onPointerDown={(e) => beginDrag(e, task, "resize-end")} title="Resize end" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 7, borderRadius: "0 6px 6px 0", cursor: "ew-resize", background: "rgba(255,255,255,.22)" }} />
                        </div>
                      ) : (
                        <div style={{ padding: "13px 8px", fontSize: 9.5, color: "var(--muted)", textAlign: "center" }}>Outside period</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
