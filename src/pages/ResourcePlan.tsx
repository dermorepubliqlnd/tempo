import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, ExternalLink, Users } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
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

export default function ResourcePlan() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [allTasks, setAllTasks] = useState<TaskRow[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [holidayDates, setHolidayDates] = useState<string[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("next_2_weeks");
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

  const parentIds = useMemo(
    () => new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string)),
    [tasks]
  );
  const leafTasks = useMemo(() => tasks.filter((t) => !parentIds.has(t.id)), [tasks, parentIds]);
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
    () => allProjects.filter((p) => p.wbs_status && p.wbs_status !== "draft"),
    [allProjects]
  );

  const orgEngine = useMemo(
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
        tasks: tasks as UtilTaskRow[],
        projects: project ? ([project] as UtilProjectRow[]) : [],
        holidays: holidaySet,
        availability,
        todayStr: toISO(new Date()),
      }),
    [tasks, project, holidaySet, availability]
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
        return { date, pct: null as number | null, totalHours: 0, projectHours: 0, capacity: 0, label: weekend ? "Weekend" : holiday ? "Holiday" : "Off" };
      }
      const cap = dailyCapacityHours(person, av?.status === "half_day");
      const total = orgEngine.totalFor(person.id, date);
      const own = projectEngine.totalFor(person.id, date);
      const pct = cap > 0 ? (total / cap) * 100 : 0;
      periodHours += total;
      projectHours += own;
      capacity += cap;
      peak = Math.max(peak, pct);
      return { date, pct, totalHours: total, projectHours: own, capacity: cap, label: av?.status === "half_day" ? "Half day" : "Working day" };
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
      projectScoped,
    };
  });

  const overloaded = resourceRows.filter((r) => r.peak > 100).length;
  const projectPlannedInPeriod = resourceRows.reduce((sum, r) => sum + r.projectHours, 0);

  const timelineStart = days.length ? toISO(days[0]) : "";
  const timelineEnd = days.length ? toISO(days[days.length - 1]) : "";
  const dayCount = Math.max(days.length, 1);

  const taskRows = [...activeTasks].sort((a, b) => {
    const aDate = a.start_date ?? a.current_due_date ?? "";
    const bDate = b.start_date ?? b.current_due_date ?? "";
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
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
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>Contributor Capacity</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
              Large % = total cross-project utilization · small line = hours coming from this project.
            </div>
          </div>
          <Link to="/utilization" style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Full Utilization <ExternalLink size={11} />
          </Link>
        </div>

        <div style={{ overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: `minmax(190px,1.4fr) repeat(${days.length}, minmax(58px,.55fr)) 66px`, minWidth: Math.max(980, 260 + days.length * 58), fontSize: 10.5 }}>
            <div style={{ padding: "7px 9px", color: "var(--muted)", fontWeight: 700, background: "var(--hover-bg)" }}>Contributor</div>
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
            <div style={{ padding: "7px 5px", textAlign: "center", color: "var(--muted)", fontWeight: 700, background: "var(--hover-bg)", borderLeft: "1px solid var(--border)" }}>Avg</div>

            {resourceRows.map((r) => (
              <Fragment key={r.person.id}>
                <div style={{ padding: "8px 9px", borderTop: "1px solid var(--border)", background: "var(--surface)", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.person.name}</div>
                  <div style={{ marginTop: 2, fontSize: 9.5, color: "var(--muted)" }}>
                    {Math.round(r.projectScoped * 10) / 10}h scoped · {Math.round(r.projectHours * 10) / 10}h in period
                  </div>
                </div>
                {r.cells.map((cell) => {
                  const rounded = cell.pct == null ? null : Math.round(cell.pct);
                  const tone = pctTone(rounded);
                  return (
                    <div
                      key={cell.date}
                      title={rounded == null ? cell.label : `${rounded}% total utilization · ${Math.round(cell.totalHours * 10) / 10}h / ${Math.round(cell.capacity * 10) / 10}h capacity · ${Math.round(cell.projectHours * 10) / 10}h from this project`}
                      style={{ padding: "6px 3px", borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)", textAlign: "center", background: tone.bg, color: tone.fg, minHeight: 42 }}
                    >
                      <div style={{ fontWeight: 800 }}>{rounded == null ? "—" : `${rounded}%`}</div>
                      {rounded != null && cell.projectHours > 0 && (
                        <div style={{ fontSize: 8.5, marginTop: 2, opacity: 0.85 }}>{Math.round(cell.projectHours * 10) / 10}h project</div>
                      )}
                    </div>
                  );
                })}
                <div style={{ padding: "8px 3px", borderTop: "1px solid var(--border)", borderLeft: "1px solid var(--border)", textAlign: "center", fontWeight: 800, color: pctTone(Math.round(r.avg)).fg }}>
                  {Math.round(r.avg)}%
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
          <div style={{ minWidth: Math.max(980, 430 + days.length * 38) }}>
            <div style={{ display: "grid", gridTemplateColumns: `minmax(240px,1.7fr) 145px 76px minmax(${days.length * 38}px,3fr)`, background: "var(--hover-bg)", color: "var(--muted)", fontSize: 10, fontWeight: 700 }}>
              <div style={{ padding: "7px 9px" }}>Task</div>
              <div style={{ padding: "7px 8px", borderLeft: "1px solid var(--border)" }}>Assignee</div>
              <div style={{ padding: "7px 8px", borderLeft: "1px solid var(--border)", textAlign: "right" }}>Scoped</div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, minmax(38px,1fr))`, borderLeft: "1px solid var(--border)" }}>
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
                  <div key={task.id} style={{ display: "grid", gridTemplateColumns: `minmax(240px,1.7fr) 145px 76px minmax(${days.length * 38}px,3fr)`, borderTop: "1px solid var(--border)", minHeight: 42, fontSize: 10.5 }}>
                    <div style={{ padding: "8px 9px", minWidth: 0 }}>
                      <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.name}</div>
                      <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2 }}>
                        {task.start_date ? formatDate(task.start_date) : "No start"} → {task.current_due_date ? formatDate(task.current_due_date) : "No due date"}
                      </div>
                    </div>
                    <div style={{ padding: "8px", borderLeft: "1px solid var(--border)", color: person ? "var(--text-secondary)" : "var(--muted)" }}>
                      {person?.name ?? "Unassigned"}
                    </div>
                    <div style={{ padding: "8px", borderLeft: "1px solid var(--border)", textAlign: "right", fontWeight: 700 }}>
                      {task.estimated_hours != null ? `${Math.round(Number(task.estimated_hours) * 10) / 10}h` : "—"}
                    </div>
                    <div style={{ position: "relative", borderLeft: "1px solid var(--border)", background: "repeating-linear-gradient(to right, transparent 0 calc((100% / " + days.length + ") - 1px), var(--border) calc((100% / " + days.length + ") - 1px) calc(100% / " + days.length + "))" }}>
                      {bar ? (
                        <div
                          title={`${task.start_date ? formatDate(task.start_date) : "No start"} → ${task.current_due_date ? formatDate(task.current_due_date) : "No due date"}`}
                          style={{
                            position: "absolute",
                            left: `${bar.left}%`,
                            width: `${bar.width}%`,
                            top: 12,
                            height: 18,
                            borderRadius: 5,
                            background: "var(--accent)",
                            opacity: 0.82,
                            boxShadow: bar.startsBefore || bar.endsAfter ? "inset 0 0 0 1px rgba(255,255,255,.55)" : "none",
                          }}
                        />
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
