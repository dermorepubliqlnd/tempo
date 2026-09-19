import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ListChecks, AlertTriangle, FolderKanban, Gauge, ClipboardCheck, CalendarClock, Timer, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { formatDate } from "../lib/formatDate";
import { buildHolidaySet } from "../lib/workingDays";
import {
  createAllocationEngine,
  dailyCapacityHours,
  isOpenTask,
  parentTaskIdsOf,
  type AssigneeHistoryRow,
  type OwnerHistoryRow,
  type UtilPersonRow,
  type UtilProjectRow,
  type UtilTaskRow,
} from "../lib/dailyAllocation";
import { tierOf } from "../lib/utilizationBands";

// My Dashboard (2026-09-19, Sandra: "all team members by default have
// access to a different personal dashboard, but also have access to this
// [team-wide] dashboard as a team view") -- this is the new default
// landing page ("/"); the previous Dashboard.tsx moved to its own nav
// item, "/team-dashboard". Everything here is scoped to the signed-in
// person: their own open tasks, the projects they own, their current
// week's utilization (via the same shared allocation engine Utilization.
// tsx/HoursOverview.tsx/WbsPlanning.tsx already use, so the number here
// never disagrees with the real Utilization page), and a read-only
// summary of approvals -- both what's awaiting their decision and what
// they themselves are still waiting on -- with a link into the Approval
// Center for the actual decide action rather than re-implementing it
// here a third time.

interface ProjectRow {
  id: string;
  name: string;
  owner_id: string | null;
  start_date: string | null;
  end_date: string | null;
  wbs_status: string | null;
  status: string | null;
  phase: string | null;
  health: string | null;
  is_archived: boolean;
}
interface TaskRow {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  name: string;
  assignee_id: string | null;
  status: string | null;
  start_date: string | null;
  current_due_date: string | null;
  estimated_hours: number | null;
  work_type_id: string | null;
  is_archived: boolean;
}
interface PersonLite {
  id: string;
  name: string;
  reports_to: string | null;
}
interface HolidayRow {
  date: string;
}
interface AvailabilityRow {
  person_id: string;
  date: string;
  status: "off" | "half_day";
}
interface DeletedHourRow {
  person_id: string;
  date: string;
  hours: number;
}

interface ExtensionRow {
  id: string;
  requested_new_due_date: string;
  request_type: "due_date" | "start_date" | null;
  created_at: string;
  task: { id: string; name: string; project_id: string; project: { id: string; name: string; owner_id: string | null } | null } | null;
  project: { id: string; name: string; owner_id: string | null } | null;
  requester: { id: string; name: string } | null;
}
interface TimeEntryRowLite {
  id: string;
  started_at: string;
  requested_by: string | null;
  person_id: string;
  task: { id: string; name: string; project_id: string; project: { id: string; name: string; owner_id: string | null } | null } | null;
}
interface BaselineRow {
  id: string;
  project_id: string;
  requested_by: string | null;
  requested_at: string;
}
interface ClosureRow {
  id: string;
  project_id: string;
  requested_by: string | null;
  requested_at: string;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export default function MyDashboard() {
  const { person: me } = useSession();
  const [loading, setLoading] = useState(true);

  const [people, setPeople] = useState<PersonLite[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [ownerHistory, setOwnerHistory] = useState<OwnerHistoryRow[]>([]);
  const [assigneeHistory, setAssigneeHistory] = useState<AssigneeHistoryRow[]>([]);
  const [deletedHours, setDeletedHours] = useState<DeletedHourRow[]>([]);

  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryRowLite[]>([]);
  const [baselineRequests, setBaselineRequests] = useState<BaselineRow[]>([]);
  const [closureRequests, setClosureRequests] = useState<ClosureRow[]>([]);

  async function loadAll() {
    setLoading(true);
    const [
      { data: peopleData },
      { data: projectData },
      { data: taskData },
      { data: holidayData },
      { data: availabilityData },
      { data: ownHistData },
      { data: assHistData },
      { data: delHrsData },
      { data: settingsData },
      { data: extData },
      { data: teData },
      { data: blData },
      { data: clData },
    ] = await Promise.all([
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("projects").select("id,name,owner_id,start_date,end_date,wbs_status,status,phase,health,is_archived"),
      supabase
        .from("tasks")
        .select("id,project_id,parent_task_id,name,assignee_id,status,start_date,current_due_date,estimated_hours,work_type_id,is_archived")
        .eq("is_archived", false),
      supabase.from("holidays").select("date"),
      supabase.from("person_availability").select("person_id,date,status"),
      supabase.from("project_owner_history").select("project_id,person_id,effective_from,effective_to"),
      supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to"),
      supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
      supabase.from("app_settings").select("historical_locking_enabled").eq("id", true).single(),
      supabase
        .from("extension_requests")
        .select(
          `id, requested_new_due_date, request_type, created_at,
           task:tasks!extension_requests_task_id_fkey ( id, name, project_id, project:projects ( id, name, owner_id ) ),
           project:projects!extension_requests_project_id_fkey ( id, name, owner_id ),
           requester:people!extension_requests_requested_by_fkey ( id, name )`
        )
        .eq("status", "Pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("time_entries")
        .select(
          `id, started_at, requested_by, person_id,
           task:tasks ( id, name, project_id, project:projects ( id, name, owner_id ) )`
        )
        .eq("status", "pending_approval")
        .order("started_at", { ascending: false }),
      supabase.from("project_baseline_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
      supabase.from("project_closure_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
    ]);

    setPeople((peopleData as PersonLite[]) ?? []);
    setProjects((projectData as ProjectRow[]) ?? []);
    setTasks((taskData as TaskRow[]) ?? []);
    setHolidays((holidayData as HolidayRow[]) ?? []);
    setAvailability((availabilityData as AvailabilityRow[]) ?? []);
    const historicalLockingEnabled = (settingsData as { historical_locking_enabled?: boolean } | null)?.historical_locking_enabled ?? false;
    setOwnerHistory(historicalLockingEnabled ? (ownHistData as OwnerHistoryRow[]) ?? [] : []);
    setAssigneeHistory(historicalLockingEnabled ? (assHistData as AssigneeHistoryRow[]) ?? [] : []);
    setDeletedHours((delHrsData as DeletedHourRow[]) ?? []);
    setExtensions((((extData as unknown as ExtensionRow[]) ?? [])).filter((r) => r.request_type !== "start_date"));
    setTimeEntries((teData as unknown as TimeEntryRowLite[]) ?? []);
    setBaselineRequests((blData as BaselineRow[]) ?? []);
    setClosureRequests((clData as ClosureRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const isFullAccess = me?.access_level === "full";
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const activeProjects = useMemo(() => projects.filter((p) => !p.is_archived), [projects]);

  // ---- My open tasks -----------------------------------------------------
  const myOpenTasks = useMemo(() => {
    if (!me) return [];
    return tasks
      .filter((t) => t.assignee_id === me.id && isOpenTask(t))
      .map((t) => ({ ...t, project: projectById.get(t.project_id) ?? null }))
      .sort((a, b) => (a.current_due_date ?? "9999").localeCompare(b.current_due_date ?? "9999"));
  }, [tasks, me, projectById]);
  const todayIso = toISO(new Date());
  const overdueTasks = myOpenTasks.filter((t) => t.current_due_date && t.current_due_date.slice(0, 10) < todayIso);

  // ---- My projects (owned) -----------------------------------------------
  const myProjects = useMemo(() => {
    if (!me) return [];
    return activeProjects.filter((p) => p.owner_id === me.id);
  }, [activeProjects, me]);

  // ---- This week's utilization, via the same shared engine every other
  // utilization surface uses (Utilization.tsx / HoursOverview.tsx /
  // WbsPlanning.tsx) -- see dailyAllocation.ts. ------------------------
  const holidaySet = useMemo(() => buildHolidaySet(holidays.map((h) => h.date)), [holidays]);
  const engine = useMemo(
    () =>
      createAllocationEngine({
        tasks: tasks as UtilTaskRow[],
        projects: activeProjects as UtilProjectRow[],
        holidays: holidaySet,
        availability,
        assigneeHistory,
        ownerHistory,
        todayStr: todayIso,
        deletedHours,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, activeProjects, holidaySet, availability, assigneeHistory, ownerHistory, deletedHours]
  );
  const weekStart = useMemo(() => {
    const d = new Date();
    const dow = d.getDay();
    // Monday-start work week.
    const diff = dow === 0 ? -6 : 1 - dow;
    return addDays(d, diff);
  }, []);
  const weekUtilization = useMemo(() => {
    if (!me) return null;
    const person: UtilPersonRow = { id: me.id, daily_capacity_hours: me.daily_capacity_hours };
    let planned = 0;
    let available = 0;
    for (let i = 0; i < 5; i++) {
      const d = addDays(weekStart, i);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      const dateStr = toISO(d);
      if (holidaySet.has(dateStr)) continue;
      const offRow = availability.find((a) => a.person_id === me.id && a.date.slice(0, 10) === dateStr && a.status === "off");
      if (offRow) continue;
      const halfDayRow = availability.find((a) => a.person_id === me.id && a.date.slice(0, 10) === dateStr && a.status === "half_day");
      const capacity = dailyCapacityHours(person, !!halfDayRow);
      const value = engine.totalFor(me.id, dateStr);
      planned += value;
      available += capacity;
    }
    const pct = available > 0 ? (planned / available) * 100 : planned > 0 ? 999 : 0;
    return { pct, planned, available };
  }, [me, weekStart, holidaySet, availability, engine]);

  // ---- Approvals -----------------------------------------------------
  function canDecideExtension(row: ExtensionRow): boolean {
    if (!me) return false;
    if (isFullAccess) return true;
    if (row.project) {
      const ownerId = row.project.owner_id;
      if (!ownerId) return false;
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }
    const ownerId = row.task?.project?.owner_id ?? null;
    if (!ownerId) return false;
    const requesterId = row.requester?.id ?? null;
    if (ownerId === me.id && requesterId !== ownerId) return true;
    if (requesterId === ownerId) {
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }
    return false;
  }
  function canDecideTimeEntry(row: TimeEntryRowLite): boolean {
    if (!me) return false;
    if (isFullAccess) return true;
    const ownerId = row.task?.project?.owner_id ?? null;
    if (!ownerId) return false;
    const requesterId = row.requested_by;
    if (ownerId === me.id && requesterId !== ownerId) return true;
    if (requesterId === ownerId) {
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }
    return false;
  }
  const canDecideBaseline = !!me?.can_approve_rebaseline;
  function canDecideClosure(row: ClosureRow): boolean {
    if (!me) return false;
    if (isFullAccess || me.can_approve_closures) return true;
    const proj = projectById.get(row.project_id);
    return !!proj && proj.owner_id === me.id;
  }

  const needsMyDecisionCount =
    extensions.filter(canDecideExtension).length +
    timeEntries.filter(canDecideTimeEntry).length +
    (canDecideBaseline ? baselineRequests.length : 0) +
    closureRequests.filter(canDecideClosure).length;

  const myPendingExtensions = extensions.filter((r) => r.requester?.id === me?.id);
  const myPendingTimeEntries = timeEntries.filter((r) => r.person_id === me?.id);

  const needsMyDecisionItems = [
    ...extensions.filter(canDecideExtension).map((r) => ({
      key: `ext-${r.id}`,
      label: r.project ? r.project.name : r.task?.name ?? "Untitled task",
      sub: "Extension request",
      date: r.created_at,
    })),
    ...timeEntries.filter(canDecideTimeEntry).map((r) => ({
      key: `time-${r.id}`,
      label: r.task?.name ?? "Untitled task",
      sub: "Time entry",
      date: r.started_at,
    })),
    ...(canDecideBaseline
      ? baselineRequests.map((r) => ({ key: `bl-${r.id}`, label: projectById.get(r.project_id)?.name ?? "Untitled project", sub: "Baseline approval", date: r.requested_at }))
      : []),
    ...closureRequests.filter(canDecideClosure).map((r) => ({
      key: `cl-${r.id}`,
      label: projectById.get(r.project_id)?.name ?? "Untitled project",
      sub: "Project close request",
      date: r.requested_at,
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  if (loading || !me) return <p style={{ padding: 20, color: "var(--muted)" }}>Loading…</p>;

  const tier = weekUtilization ? tierOf(weekUtilization.pct) : null;

  return (
    <div>
      <h1 style={{ marginBottom: 2 }}>My Dashboard</h1>
      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, marginBottom: 16 }}>
        Hi {me.name.split(" ")[0]} — here's your work at a glance.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <MetricCard icon={<ListChecks size={15} />} tone="accent" label="My Open Tasks" value={myOpenTasks.length} />
        <MetricCard icon={<AlertTriangle size={15} />} tone="danger" label="Overdue" value={overdueTasks.length} />
        <MetricCard icon={<FolderKanban size={15} />} tone="purple" label="My Projects" value={myProjects.length} />
        <MetricCard
          icon={<Gauge size={15} />}
          tone={tier?.key === "overloaded" ? "danger" : tier?.key === "healthy" ? "success" : tier?.key === "unallocated" || tier?.key === "available" ? "slate" : "warning"}
          label="This Week's Utilization"
          value={weekUtilization ? `${Math.round(weekUtilization.pct)}%` : "—"}
        />
        <Link to="/approval-center" style={{ textDecoration: "none" }}>
          <MetricCard icon={<ClipboardCheck size={15} />} tone="gold" label="Needs Your Decision" value={needsMyDecisionCount} />
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
        <div>
          <h2 style={{ fontSize: 13 }}>My Tasks ({myOpenTasks.length})</h2>
          {myOpenTasks.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>No open tasks assigned to you.</p>
          ) : (
            <div>
              {myOpenTasks.slice(0, 8).map((t) => {
                const overdue = t.current_due_date && t.current_due_date.slice(0, 10) < todayIso;
                return (
                  <Link
                    key={t.id}
                    to={`/projects/${t.project_id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "10px 14px",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      background: "var(--surface)",
                      marginBottom: 8,
                      textDecoration: "none",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>{t.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{t.project?.name ?? "—"}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span className={`status-pill ${overdue ? "danger" : "neutral"}`} style={{ fontSize: 9.5 }}>
                        {formatDate(t.current_due_date)}
                      </span>
                      <ChevronRight size={13} style={{ color: "var(--muted)" }} />
                    </div>
                  </Link>
                );
              })}
              {myOpenTasks.length > 8 && (
                <Link to="/projects" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
                  View all {myOpenTasks.length} tasks →
                </Link>
              )}
            </div>
          )}

          <h2 style={{ fontSize: 13, marginTop: 24 }}>My Projects ({myProjects.length})</h2>
          {myProjects.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>You don't own any active projects.</p>
          ) : (
            <div>
              {myProjects.map((p) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}/wbs`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 14px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    background: "var(--surface)",
                    marginBottom: 8,
                    textDecoration: "none",
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>{p.name}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {p.status && (
                      <span className="status-pill neutral" style={{ fontSize: 9.5 }}>
                        {p.status}
                      </span>
                    )}
                    <ChevronRight size={13} style={{ color: "var(--muted)" }} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 13 }}>Needs Your Decision ({needsMyDecisionCount})</h2>
          </div>
          {needsMyDecisionItems.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Nothing waiting on you right now.</p>
          ) : (
            <div>
              {needsMyDecisionItems.map((item) => (
                <div
                  key={item.key}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 8 }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{item.label}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>{item.sub}</div>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--muted)" }}>{formatDate(item.date)}</span>
                </div>
              ))}
              <Link to="/approval-center" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
                Open Approval Center →
              </Link>
            </div>
          )}

          <h2 style={{ fontSize: 13, marginTop: 24 }}>My Pending Requests</h2>
          {myPendingExtensions.length === 0 && myPendingTimeEntries.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Nothing of yours is waiting on approval.</p>
          ) : (
            <div>
              {myPendingExtensions.map((r) => (
                <div
                  key={`mine-ext-${r.id}`}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 8 }}
                >
                  <span className="status-pill gold" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 8, flexShrink: 0 }}>
                    <CalendarClock size={12} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{r.project ? r.project.name : r.task?.name ?? "Untitled task"}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>Extension request · requested {formatDate(r.created_at)}</div>
                  </div>
                </div>
              ))}
              {myPendingTimeEntries.map((r) => (
                <div
                  key={`mine-time-${r.id}`}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 8 }}
                >
                  <span className="status-pill accent" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 8, flexShrink: 0 }}>
                    <Timer size={12} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{r.task?.name ?? "Untitled task"}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>Time entry · logged {formatDate(r.started_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon, tone, label, value }: { icon: JSX.Element; tone: string; label: string; value: number | string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flex: "1 1 190px",
        minWidth: 170,
        padding: "12px 14px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <span className={`status-pill ${tone}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}>
        {icon}
      </span>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--navy)" }}>{label}</div>
        <div style={{ fontSize: 19, fontWeight: 700, color: "var(--navy)", lineHeight: 1.15 }}>{value}</div>
      </div>
    </div>
  );
}
