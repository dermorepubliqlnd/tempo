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

interface TimeEntryLite {
  task_id: string | null;
  duration_minutes: number | null;
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
  if (l.includes("late") || l.includes("open tasks")) return { bg: "#fffaeb", fg: "#b54708" };
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
  const [timeEntries, setTimeEntries] = useState<TimeEntryLite[]>([]);
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

      const projectTaskIds = ((tasksRes.data as TaskRow[] | null) ?? []).map((t) => t.id);
      if (projectTaskIds.length > 0) {
        const timeRes = await supabase
          .from("time_entries")
          .select("task_id,duration_minutes")
          .in("task_id", projectTaskIds)
          .in("status", ["confirmed", "approved"])
          .eq("is_archived", false);
        if (!cancelled) setTimeEntries((timeRes.data as TimeEntryLite[] | null) ?? []);
      } else {
        setTimeEntries([]);
      }

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
  const unassignedScopedHours = leafTasks.filter((t) => !t.assignee_id).reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);
  const loggedHours = Math.round((timeEntries.reduce((sum, e) => sum + Number(e.duration_minutes ?? 0), 0) / 60) * 10) / 10;
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

  // Load = committed (started) projects only, matching Utilization's
  // default view -- plus this project itself so a draft still previews.
  const engine = useMemo(() => {
    const committedProjects = allProjects.filter((p) => (p.wbs_status && p.wbs_status !== "draft") || p.id === projectId);
    const committedIds = new Set(committedProjects.map((p) => p.id));
    return createAllocationEngine({
      tasks: allTasks.filter((t) => committedIds.has(t.project_id)) as UtilTaskRow[],
      projects: committedProjects as UtilProjectRow[],
      holidays: holidaySet,
      availability,
      todayStr: toISO(new Date()),
    });
  }, [allTasks, allProjects, projectId, holidaySet, availability]);

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
      const projectScopedHours = leafTasks
        .filter((t) => t.assignee_id === person.id)
        .reduce((sum, t) => sum + Number(t.estimated_hours ?? 0), 0);
      return {
        person,
        planned,
        capacity,
        projectScopedHours,
        avgPct: capacity > 0 ? (planned / capacity) * 100 : 0,
        peakPct: peak,
      };
    })
    .sort((a, b) => b.peakPct - a.peakPct);

  const overloadedAssignees = resourceRows.filter((r) => r.peakPct > 100).length;

  if (loading) return <div style={{ padding: 24, color: "var(--muted)" }}>Loading project overview…</div>;
  if (!project) return <div style={{ padding: 24 }}>Project not found.</div>;

  const projectCode = `P-${String(project.project_number ?? "").padStart(4, "0")}`;

  const scheduleStartMs = baselineStart ? parseLocalDate(baselineStart).getTime() : null;
  const baselineEndMs = baselineEnd ? parseLocalDate(baselineEnd).getTime() : null;
  const forecastEndMs = forecastEnd ? parseLocalDate(forecastEnd).getTime() : null;
  const scheduleMaxMs =
    scheduleStartMs !== null && baselineEndMs !== null && forecastEndMs !== null
      ? Math.max(baselineEndMs, forecastEndMs)
      : null;
  const scheduleSpanMs =
    scheduleStartMs !== null && scheduleMaxMs !== null
      ? Math.max(86400000, scheduleMaxMs - scheduleStartMs)
      : null;
  const baselineWidthPct =
    scheduleSpanMs && scheduleStartMs !== null && baselineEndMs !== null
      ? Math.max(4, Math.min(100, ((baselineEndMs - scheduleStartMs) / scheduleSpanMs) * 100))
      : 0;
  const forecastWidthPct =
    scheduleSpanMs && scheduleStartMs !== null && forecastEndMs !== null
      ? Math.max(4, Math.min(100, ((forecastEndMs - scheduleStartMs) / scheduleSpanMs) * 100))
      : 0;

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
          <div style={{ fontSize: 11.5, fontWeight: 700 }}>Task Progress</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
            <div style={{ width: 82, height: 82, borderRadius: "50%", background: `conic-gradient(#12b76a 0 ${Math.max(0, Math.min(progress, 100))}%, var(--hover-bg) ${Math.max(0, Math.min(progress, 100))}% 100%)`, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <div style={{ width: 58, height: 58, borderRadius: "50%", background: "var(--surface)", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 800 }}>
                {Math.round(progress)}%
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {[
                ["Completed", completedCount, "#12b76a"],
                ["In Progress", inProgressCount, "#2e90fa"],
                ["Not Started", notStartedCount, "#98a2b3"],
                ["Cancelled", cancelledCount, "#d0d5dd"],
              ].map(([label, n, color]) => (
                <div key={label as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, padding: "2px 0", gap: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: color as string }} />{label}
                  </span>
                  <strong>{n}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 12 }}>
        <section style={{ ...cardStyle(), gridColumn: "span 6" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Schedule Snapshot</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 10.5, color: "var(--muted)" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#98a2b3" }} /> Baseline
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: "#2e90fa" }} /> Current Forecast
              </span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 14 }}>
            {[
              ["Baseline Start", baselineStart ? formatDate(baselineStart) : "—"],
              ["Baseline End", baselineEnd ? formatDate(baselineEnd) : "—"],
              ["Forecast End", forecastEnd ? formatDate(forecastEnd) : "—"],
              ["Variance", varianceDays === 0 ? "On baseline" : `${varianceDays > 0 ? "+" : ""}${varianceDays} day${Math.abs(varianceDays) === 1 ? "" : "s"}`],
            ].map(([label, value], i) => (
              <div key={label} style={{ padding: "8px 9px", borderLeft: i ? "1px solid var(--border)" : "none", minWidth: 0 }}>
                <div style={{ fontSize: 9.5, color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</div>
                <div style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  marginTop: 3,
                  color: (label === "Forecast End" || label === "Variance") && varianceDays > 0 ? "var(--danger-text)" : "var(--navy)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {baselineStart && baselineEnd && forecastEnd ? (
            <div style={{ padding: "2px 2px 0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "68px minmax(0,1fr)", alignItems: "center", gap: 8, marginBottom: 9 }}>
                <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Baseline</span>
                <div style={{ position: "relative", height: 14, minWidth: 0 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 5, height: 4, background: "var(--hover-bg)", borderRadius: 999 }} />
                  <div style={{ position: "absolute", left: 0, top: 2, width: `${baselineWidthPct}%`, height: 10, background: "#98a2b3", borderRadius: 999 }} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "68px minmax(0,1fr)", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Forecast</span>
                <div style={{ position: "relative", height: 14, minWidth: 0 }}>
                  <div style={{ position: "absolute", left: 0, right: 0, top: 5, height: 4, background: "var(--hover-bg)", borderRadius: 999 }} />
                  <div style={{ position: "absolute", left: 0, top: 2, width: `${forecastWidthPct}%`, height: 10, background: "#2e90fa", borderRadius: 999 }} />
                  {varianceDays > 0 && (
                    <div style={{
                      position: "absolute",
                      left: `${baselineWidthPct}%`,
                      top: 2,
                      width: `${Math.max(0, forecastWidthPct - baselineWidthPct)}%`,
                      height: 10,
                      background: "repeating-linear-gradient(135deg, rgba(255,255,255,.78) 0 3px, rgba(255,255,255,.18) 3px 6px)",
                      borderRadius: "0 999px 999px 0",
                    }} />
                  )}
                </div>
              </div>

              <div style={{ marginTop: 9, textAlign: "right", fontSize: 10.5, fontWeight: 700, color: varianceDays > 0 ? "var(--danger-text)" : varianceDays < 0 ? "var(--success-text)" : "var(--text-secondary)" }}>
                {varianceDays === 0 ? "On baseline" : `${varianceDays > 0 ? "+" : ""}${varianceDays} day${Math.abs(varianceDays) === 1 ? "" : "s"} vs baseline`}
              </div>
            </div>
          ) : (
            <div style={{ padding: "16px 4px 4px", textAlign: "center", fontSize: 11.5, color: "var(--muted)" }}>
              Baseline and forecast dates will appear here once the project schedule is available.
            </div>
          )}
        </section>

        <section style={{ ...cardStyle(), gridColumn: "span 6" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>Project Risks & Attention</div>
          {[
            { Icon: AlertTriangle, label: "Overdue tasks", count: overdueTasks },
            { Icon: Users, label: "Overallocated assignees", count: overloadedAssignees },
            { Icon: Clock3, label: "Pending extension requests", count: pendingExtensions },
            { Icon: CheckCircle2, label: "Changed after baseline", count: tasksChangedAfterBaseline ? 1 : 0 },
          ].map(({ Icon, label, count }, i) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none", fontSize: 11.5 }}>
              <span style={{ display: "inline-flex", gap: 7, alignItems: "center", color: "var(--text-secondary)" }}><Icon size={13} /> {label}</span>
              <strong style={{ color: count > 0 ? "var(--danger-text)" : "var(--muted)" }}>{count}</strong>
            </div>
          ))}
        </section>

        <section style={{ ...cardStyle(), gridColumn: "span 12" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>Resource Summary</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Cross-project workload for this project's assignees · next 2 weeks</div>
            </div>
            <Link to="/utilization" style={{ fontSize: 11.5, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>Open Utilization →</Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8, marginBottom: 12 }}>
            <div style={{ background: "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{assigneeIds.length}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Total Contributors</div>
            </div>
            <div style={{ background: overloadedAssignees > 0 ? "#fff1f1" : "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: overloadedAssignees > 0 ? "var(--danger-text)" : "var(--navy)" }}>{overloadedAssignees}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Overallocated</div>
            </div>
            <div style={{ background: "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{Math.round(scopedHours * 10) / 10}h</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Scoped Hours</div>
              {unassignedScopedHours > 0 && (
                <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 3 }}>
                  {Math.round(unassignedScopedHours * 10) / 10}h unassigned
                </div>
              )}
            </div>
            <div style={{ background: "var(--hover-bg)", borderRadius: 8, padding: "10px 11px" }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{loggedHours}h</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>Logged Hours</div>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 700 }}>Scoped Hours by Contributor</div>
                <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 1 }}>Share of this project's scoped effort</div>
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{Math.round(scopedHours * 10) / 10}h total</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 7 }}>
              {resourceRows.map((r) => {
                const pct = scopedHours > 0 ? Math.round((r.projectScopedHours / scopedHours) * 100) : 0;
                return (
                  <div key={r.person.id + "-scope"} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "8px 9px", background: "var(--surface)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.person.name}</span>
                      <strong style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>{Math.round(r.projectScopedHours * 10) / 10}h</strong>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--hover-bg)", overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", background: "var(--accent)", borderRadius: 999 }} />
                      </div>
                      <span style={{ fontSize: 9.5, color: "var(--muted)", minWidth: 28, textAlign: "right" }}>{pct}%</span>
                    </div>
                  </div>
                );
              })}
              {unassignedScopedHours > 0 && (
                <div style={{ border: "1px dashed var(--border)", borderRadius: 7, padding: "8px 9px", background: "var(--hover-bg)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600 }}>Unassigned</span>
                    <strong style={{ fontSize: 10.5, color: "var(--muted)" }}>{Math.round(unassignedScopedHours * 10) / 10}h</strong>
                  </div>
                  <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 6 }}>
                    {scopedHours > 0 ? Math.round((unassignedScopedHours / scopedHours) * 100) : 0}% of scope not yet allocated
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `minmax(170px,1.4fr) repeat(${nextTwoWeeks.length}, minmax(54px, .55fr)) 64px`,
                minWidth: 980,
                fontSize: 10.5,
              }}
            >
              <div style={{ padding: "7px 8px", color: "var(--muted)", fontWeight: 600, background: "var(--hover-bg)" }}>Team member</div>
              {nextTwoWeeks.map((d) => {
                const date = toISO(d);
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                const holiday = !weekend && !isWorkingDay(d, holidaySet);
                return (
                  <div
                    key={date}
                    style={{
                      padding: "5px 4px",
                      textAlign: "center",
                      color: "var(--muted)",
                      background: weekend || holiday ? "var(--hover-bg)" : "var(--surface)",
                      borderLeft: "1px solid var(--border)",
                      lineHeight: 1.25,
                    }}
                  >
                    <div style={{ fontSize: 9.5 }}>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div style={{ fontWeight: 700, color: "var(--text-secondary)" }}>{d.getDate()}</div>
                  </div>
                );
              })}
              <div style={{ padding: "7px 6px", textAlign: "center", color: "var(--muted)", fontWeight: 600, background: "var(--hover-bg)", borderLeft: "1px solid var(--border)" }}>
                Avg
              </div>

              {resourceRows.map((r) => {
                const daily = nextTwoWeeks.map((d) => {
                  const date = toISO(d);
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  const holiday = !weekend && !isWorkingDay(d, holidaySet);
                  const av = availability.find((a) => a.person_id === r.person.id && a.date === date);
                  const isOff = weekend || holiday || av?.status === "off";
                  if (isOff) return { date, pct: null as number | null, label: weekend ? "Weekend" : holiday ? "Holiday" : "Off" };
                  const cap = dailyCapacityHours(r.person, av?.status === "half_day");
                  const hours = engine.totalFor(r.person.id, date);
                  const pct = cap > 0 ? Math.round((hours / cap) * 100) : 0;
                  return { date, pct, label: `${Math.round(hours * 10) / 10}h / ${Math.round(cap * 10) / 10}h` };
                });

                return (
                  <>
                    <div key={r.person.id + "-name"} style={{ padding: "8px", borderTop: "1px solid var(--border)", fontWeight: 600, background: "var(--surface)", whiteSpace: "nowrap" }}>
                      {r.person.name}
                    </div>
                    {daily.map((cell) => {
                      const pct = cell.pct;
                      const bg =
                        pct == null ? "var(--hover-bg)" :
                        pct > 100 ? "#fff1f1" :
                        pct >= 80 ? "#fff7e8" :
                        "#ecfdf3";
                      const fg =
                        pct == null ? "var(--muted)" :
                        pct > 100 ? "var(--danger-text)" :
                        pct >= 80 ? "var(--warning-text)" :
                        "var(--success-text)";
                      return (
                        <div
                          key={r.person.id + "-" + cell.date}
                          title={pct == null ? cell.label : `${pct}% · ${cell.label}`}
                          style={{
                            padding: "8px 4px",
                            borderTop: "1px solid var(--border)",
                            borderLeft: "1px solid var(--border)",
                            textAlign: "center",
                            background: bg,
                            color: fg,
                            fontWeight: pct != null && pct >= 80 ? 700 : 600,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {pct == null ? "—" : `${pct}%`}
                        </div>
                      );
                    })}
                    <div
                      key={r.person.id + "-avg"}
                      style={{
                        padding: "8px 4px",
                        borderTop: "1px solid var(--border)",
                        borderLeft: "1px solid var(--border)",
                        textAlign: "center",
                        fontWeight: 700,
                        color: r.avgPct > 100 ? "var(--danger-text)" : r.avgPct >= 80 ? "var(--warning-text)" : "var(--success-text)",
                        background: "var(--surface)",
                      }}
                    >
                      {Math.round(r.avgPct)}%
                    </div>
                  </>
                );
              })}
            </div>
          </div>
        </section>


      </div>
    </div>
  );
}
