import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Gauge,
  Users,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { actualProgress, healthOf, type ProjectRow, type TaskRow } from "./Projects";
import { formatDate } from "../lib/formatDate";
import { TASK_STATUS_GROUPED, statusGroupOf } from "../lib/notionOptions";
import { createAllocationEngine, dailyCapacityHours, type UtilProjectRow, type UtilTaskRow } from "../lib/dailyAllocation";
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

interface ExtensionRow {
  id: string;
  project_id: string | null;
  task_id: string | null;
  status: string;
  requested_new_due_date: string | null;
  created_at: string;
}

function cardStyle(): React.CSSProperties {
  return {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: 14,
    minWidth: 0,
  };
}

function statusTone(label: string) {
  const l = label.toLowerCase();
  if (l.includes("overdue") || l.includes("off track")) return { bg: "#fff1f1", fg: "#b42318" };
  if (l.includes("risk")) return { bg: "#fff7e8", fg: "#b54708" };
  if (l.includes("track") || l.includes("complete")) return { bg: "#ecfdf3", fg: "#067647" };
  return { bg: "var(--hover-bg)", fg: "var(--text-secondary)" };
}

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [holidayDates, setHolidayDates] = useState<string[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [projectRes, tasksRes, allTasksRes, projectsRes, peopleRes, availabilityRes, holidaysRes, extensionRes] = await Promise.all([
        supabase.from("projects").select("*").eq("id", projectId).single(),
        supabase.from("tasks").select("*").eq("project_id", projectId).eq("is_archived", false),
        supabase.from("tasks").select("*").eq("is_archived", false),
        supabase.from("projects").select("*").eq("is_archived", false).eq("is_unsaved", false),
        supabase.from("people").select("id,name,daily_capacity_hours,is_active"),
        supabase.from("person_availability").select("person_id,date,status"),
        supabase.from("holidays").select("date"),
        supabase.from("extension_requests").select("id,project_id,task_id,status,requested_new_due_date,created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setProject((projectRes.data as ProjectRow | null) ?? null);
      setTasks((tasksRes.data as TaskRow[] | null) ?? []);
      setAllTasks((allTasksRes.data as TaskRow[] | null) ?? []);
      setAllProjects((projectsRes.data as ProjectRow[] | null) ?? []);
      setPeople((peopleRes.data as PersonRow[] | null) ?? []);
      setAvailability((availabilityRes.data as AvailabilityRow[] | null) ?? []);
      setHolidayDates(((holidaysRes.data as { date: string }[] | null) ?? []).map((h) => h.date));
      setExtensions((extensionRes.data as ExtensionRow[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const parentIds = useMemo(() => new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string)), [tasks]);
  const leafTasks = useMemo(() => tasks.filter((t) => !parentIds.has(t.id)), [tasks, parentIds]);
  const openTasks = useMemo(() => leafTasks.filter((t) => {
    const g = statusGroupOf(TASK_STATUS_GROUPED, t.status);
    return g !== "complete" && g !== "cancelled";
  }), [leafTasks]);

  const progress = project ? actualProgress(project.id, tasks) ?? 0 : 0;
  const holidaySet = useMemo(() => buildHolidaySet(holidayDates), [holidayDates]);
  const health = project ? healthOf(project, tasks, new Set(holidayDates)) : null;
  const healthLabel = health?.label ?? "Health unavailable";
  const healthTone = statusTone(healthLabel);

  const owner = project ? people.find((p) => p.id === project.owner_id) : null;
  const assigneeIds = useMemo(() => Array.from(new Set(leafTasks.map((t) => t.assignee_id).filter((x): x is string => !!x))), [leafTasks]);
  const scopedHours = leafTasks.reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);
  const assignedHours = leafTasks.filter((t) => t.assignee_id).reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);
  const completedCount = leafTasks.filter((t) => statusGroupOf(TASK_STATUS_GROUPED, t.status) === "complete").length;
  const cancelledCount = leafTasks.filter((t) => statusGroupOf(TASK_STATUS_GROUPED, t.status) === "cancelled").length;
  const inProgressCount = leafTasks.filter((t) => statusGroupOf(TASK_STATUS_GROUPED, t.status) === "in_progress").length;
  const notStartedCount = Math.max(0, leafTasks.length - completedCount - cancelledCount - inProgressCount);

  const forecastEnd = openTasks.reduce<string | null>((max, t) => {
    const d = t.current_due_date?.slice(0, 10);
    if (!d) return max;
    return !max || d > max ? d : max;
  }, null) ?? project?.end_date ?? null;

  const baselineStart = project?.original_start_date ?? project?.start_date ?? null;
  const baselineEnd = project?.original_due_date ?? project?.end_date ?? null;
  const varianceDays = baselineEnd && forecastEnd
    ? Math.round((parseLocalDate(forecastEnd).getTime() - parseLocalDate(baselineEnd).getTime()) / 86400000)
    : 0;

  const overdueTasks = openTasks.filter((t) => t.current_due_date && t.current_due_date.slice(0, 10) < toISO(new Date())).length;
  const tasksChangedAfterBaseline = project?.wbs_status === "changed_after_baseline" ? openTasks.length : 0;
  const pendingExtensions = extensions.filter((e) => e.status === "Pending").length;
  const unassignedTasks = openTasks.filter((t) => !t.assignee_id).length;

  const committedProjects = allProjects.filter((p) => p.wbs_status && p.wbs_status !== "draft");
  const engine = useMemo(() => createAllocationEngine({
    tasks: allTasks as UtilTaskRow[],
    projects: committedProjects as UtilProjectRow[],
    holidays: holidaySet,
    availability,
    todayStr: toISO(new Date()),
  }), [allTasks, committedProjects, holidaySet, availability]);

  const nextTwoWeeks = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(new Date(), i)), []);
  const resourceRows = assigneeIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is PersonRow => !!p)
    .map((person) => {
      let planned = 0;
      let capacity = 0;
      let peak = 0;
      nextTwoWeeks.forEach((d) => {
        const date = toISO(d);
        if (!isWorkingDay(d, holidaySet)) return;
        const av = availability.find((a) => a.person_id === person.id && a.date === date);
        if (av?.status === "off") return;
        const cap = dailyCapacityHours(person, av?.status === "half_day");
        const hours = engine.totalFor(person.id, date);
        planned += hours;
        capacity += cap;
        peak = Math.max(peak, cap > 0 ? (hours / cap) * 100 : 0);
      });
      return {
        person,
        planned,
        capacity,
        avgPct: capacity > 0 ? (planned / capacity) * 100 : 0,
        peakPct: peak,
      };
    })
    .sort((a, b) => b.peakPct - a.peakPct);

  const overloadedAssignees = resourceRows.filter((r) => r.peakPct > 100).length;

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>Loading project overview…</div>;
  if (!project) return <div style={{ padding: 24 }}>Project not found.</div>;

  const projectCode = `P-${String(project.project_number ?? "").padStart(4, "0")}`;

  return (
    <div style={{ paddingBottom: 24 }}>
      <Link to="/projects" className="back-link" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 12.5 }}>
        <ArrowLeft size={13} /> Projects & Tasks
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ marginBottom: 3 }}>{project.name}</h1>
            <span className="status-pill" data-tone={project.status === "In Progress" ? "accent" : project.status === "Completed" ? "success" : project.status === "Paused" ? "purple" : "neutral"}>
              {project.status ?? "Not Started"}
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", maxWidth: 760 }}>{project.description || "No project description yet."}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            ["Baseline Start", baselineStart ? formatDate(baselineStart) : "—"],
            ["Baseline End", baselineEnd ? formatDate(baselineEnd) : "—"],
            ["Forecast End", forecastEnd ? formatDate(forecastEnd) : "—"],
            ["Variance", varianceDays === 0 ? "On baseline" : `${varianceDays > 0 ? "+" : ""}${varianceDays} day${Math.abs(varianceDays) === 1 ? "" : "s"}`],
          ].map(([label, value]) => (
            <div key={label} style={{ ...cardStyle(), padding: "8px 12px", minWidth: 112 }}>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{label}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 22, borderBottom: "1px solid var(--border)", marginTop: 16, marginBottom: 14 }}>
        <Link to={`/projects/${project.id}`} style={{ padding: "9px 2px", borderBottom: "2px solid var(--accent)", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, textDecoration: "none" }}>
          Overview
        </Link>
        <Link to={`/projects/${project.id}/wbs`} style={{ padding: "9px 2px", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>
          WBS
        </Link>
      </div>

      <div style={{ ...cardStyle(), display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(220px,.75fr) minmax(220px,.75fr)", gap: 0, padding: 0, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 12, background: "var(--hover-bg)", display: "grid", placeItems: "center", color: "var(--accent)" }}>
            <FolderKanban size={25} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--navy)" }}>{project.name}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{projectCode} · {project.category || "Uncategorized"}</div>
            <div style={{ display: "flex", gap: 20, marginTop: 10, flexWrap: "wrap" }}>
              <div><span style={{ fontSize: 10.5, color: "var(--muted)" }}>Project Owner</span><div style={{ fontSize: 12.5, fontWeight: 600 }}>{owner?.name ?? "Unassigned"}</div></div>
              <div><span style={{ fontSize: 10.5, color: "var(--muted)" }}>Phase</span><div style={{ fontSize: 12.5, fontWeight: 600 }}>{project.phase ?? "—"}</div></div>
              <div><span style={{ fontSize: 10.5, color: "var(--muted)" }}>Priority</span><div style={{ fontSize: 12.5, fontWeight: 600 }}>{project.priority ?? "—"}</div></div>
            </div>
          </div>
        </div>
        <div style={{ padding: 16, borderLeft: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700 }}>Project Health</div>
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 7, background: healthTone.bg, color: healthTone.fg, padding: "6px 10px", borderRadius: 999, fontSize: 12.5, fontWeight: 700 }}>
            <Gauge size={14} /> {healthLabel}
          </div>
          <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            {varianceDays > 0 ? `Forecast is ${varianceDays} day${varianceDays === 1 ? "" : "s"} beyond the current baseline.` : "Forecast remains within the current project envelope."}
          </div>
        </div>
        <div style={{ padding: 16, borderLeft: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11.5, fontWeight: 700 }}>Overall Progress</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1, height: 10, borderRadius: 999, background: "var(--hover-bg)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(0, Math.min(progress, 100))}%`, height: "100%", background: "#12b76a" }} />
            </div>
            <strong style={{ fontSize: 17 }}>{Math.round(progress)}%</strong>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 7 }}>{completedCount} of {leafTasks.length} leaf tasks completed</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 12 }}>
        <section style={{ ...cardStyle(), gridColumn: "span 4" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Key Dates</div>
          {[
            { label: "Baseline Start", value: baselineStart ? formatDate(baselineStart) : "—" },
            { label: "Baseline End", value: baselineEnd ? formatDate(baselineEnd) : "—" },
            { label: "Forecast End", value: forecastEnd ? formatDate(forecastEnd) : "—", alert: varianceDays > 0 },
            { label: "Variance", value: varianceDays === 0 ? "On baseline" : `${varianceDays > 0 ? "+" : ""}${varianceDays} day${Math.abs(varianceDays) === 1 ? "" : "s"}`, alert: varianceDays > 0 },
          ].map(({ label, value, alert }, i) => (
            <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--text-secondary)" }}><CalendarDays size={13} /> {label}</span>
              <strong style={{ fontSize: 11.5, color: alert ? "var(--danger-text)" : "var(--navy)" }}>{value}</strong>
            </div>
          ))}
        </section>

        <section style={{ ...cardStyle(), gridColumn: "span 4" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Task Progress</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 88, height: 88, borderRadius: "50%", background: `conic-gradient(#12b76a 0 ${progress}%, var(--hover-bg) ${progress}% 100%)`, display: "grid", placeItems: "center" }}>
              <div style={{ width: 62, height: 62, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800 }}>{Math.round(progress)}%</div>
            </div>
            <div style={{ flex: 1 }}>
              {[
                ["Completed", completedCount, "#12b76a"],
                ["In Progress", inProgressCount, "#2e90fa"],
                ["Not Started", notStartedCount, "#98a2b3"],
                ["Cancelled", cancelledCount, "#d0d5dd"],
              ].map(([label, n, color]) => (
                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, padding: "4px 0" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 8, height: 8, borderRadius: 3, background: color as string }} />{label}</span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ ...cardStyle(), gridColumn: "span 4" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Project Risks & Attention</div>
          {[
            { Icon: AlertTriangle, label: "Overdue tasks", count: overdueTasks },
            { Icon: Users, label: "Overallocated assignees", count: overloadedAssignees },
            { Icon: Clock3, label: "Pending extension requests", count: pendingExtensions },
            { Icon: AlertTriangle, label: "Unassigned open tasks", count: unassignedTasks },
            { Icon: CheckCircle2, label: "Changed after baseline", count: tasksChangedAfterBaseline ? 1 : 0 },
          ].map(({ Icon, label, count }, i) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 11.5 }}>
              <span style={{ display: "inline-flex", gap: 7, alignItems: "center", color: "var(--text-secondary)" }}><Icon size={13} /> {label}</span>
              <strong style={{ color: count > 0 ? "var(--danger-text)" : "var(--muted)" }}>{count}</strong>
            </div>
          ))}
        </section>

        <section style={{ ...cardStyle(), gridColumn: "span 8" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>Resource Summary</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Cross-project workload for this project's assignees · next 2 weeks</div>
            </div>
            <Link to="/utilization" style={{ fontSize: 11.5, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>Open Utilization →</Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8, marginBottom: 12 }}>
            {[
              ["Assignees", assigneeIds.length],
              ["Scoped Hours", `${Math.round(scopedHours * 10) / 10}h`],
              ["Assigned Hours", `${Math.round(assignedHours * 10) / 10}h`],
              ["Overallocated", overloadedAssignees],
            ].map(([label, value]) => (
              <div key={label as string} style={{ background: "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>{value}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px,1.4fr) repeat(3,minmax(80px,.7fr))", fontSize: 11 }}>
            <div style={{ color: "var(--muted)", padding: "6px 8px" }}>Team member</div>
            <div style={{ color: "var(--muted)", padding: "6px 8px", textAlign: "right" }}>Planned</div>
            <div style={{ color: "var(--muted)", padding: "6px 8px", textAlign: "right" }}>Avg Util.</div>
            <div style={{ color: "var(--muted)", padding: "6px 8px", textAlign: "right" }}>Peak</div>
            {resourceRows.slice(0, 6).map((r) => (
              <>
                <div key={r.person.id + "-name"} style={{ padding: "8px", borderTop: "1px solid var(--border)", fontWeight: 600 }}>{r.person.name}</div>
                <div key={r.person.id + "-planned"} style={{ padding: "8px", borderTop: "1px solid var(--border)", textAlign: "right" }}>{Math.round(r.planned * 10) / 10}h</div>
                <div key={r.person.id + "-avg"} style={{ padding: "8px", borderTop: "1px solid var(--border)", textAlign: "right" }}>{Math.round(r.avgPct)}%</div>
                <div key={r.person.id + "-peak"} style={{ padding: "8px", borderTop: "1px solid var(--border)", textAlign: "right", fontWeight: 700, color: r.peakPct > 100 ? "var(--danger-text)" : r.peakPct >= 80 ? "var(--warning-text)" : "var(--success-text)" }}>{Math.round(r.peakPct)}%</div>
              </>
            ))}
          </div>
        </section>

        <section style={{ ...cardStyle(), gridColumn: "span 4" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Project Information</div>
          {[
            ["Project ID", projectCode],
            ["Owner", owner?.name ?? "Unassigned"],
            ["Category", project.category ?? "—"],
            ["Status", project.status ?? "Not Started"],
            ["Phase", project.phase ?? "—"],
            ["Priority", project.priority ?? "—"],
            ["WBS Status", project.wbs_status.split("_").join(" ")],
          ].map(([label, value], i) => (
            <div key={label} style={{ display: "grid", gridTemplateColumns: "105px 1fr", gap: 10, padding: "7px 0", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 11.5 }}>
              <span style={{ color: "var(--muted)" }}>{label}</span>
              <strong style={{ fontWeight: 600 }}>{value}</strong>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
