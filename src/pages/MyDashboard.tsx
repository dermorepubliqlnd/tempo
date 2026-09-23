import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Folder,
  CheckCircle2,
  ShieldQuestion,
  BarChart3,
  Clock3,
  AlertTriangle,
  Gauge,
  ChevronRight,
  ChevronLeft,
  Calendar,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { formatDate } from "../lib/formatDate";
import { buildHolidaySet } from "../lib/workingDays";
import { loggedHoursTier, LOGGED_HOURS_LEGEND } from "../lib/loggedHoursBands";
import { colorForPerson } from "../lib/personColors";
// Reuses Health/Progress straight from Projects.tsx (same convention
// Dashboard.tsx already follows) so this page's numbers can never drift
// out of sync with what the Projects table itself shows for a project.
import { healthOf, actualProgress, countWorkingDays, type ProjectRow, type TaskRow } from "./Projects";
import {
  createAllocationEngine,
  dailyCapacityHours,
  isOpenTask,
  type AssigneeHistoryRow,
  type OwnerHistoryRow,
  type UtilPersonRow,
  type UtilProjectRow,
  type UtilTaskRow,
} from "../lib/dailyAllocation";

// My Dashboard (2026-09-19, Sandra: personal default landing page, built
// to her own mockup) -- everyone's own work snapshot: active projects,
// tasks due this week, pending approvals, utilization vs actual logged
// hours (two DIFFERENT things -- Utilization is assigned/scoped work via
// the same shared allocation engine every other utilization surface
// uses; Hours Logged is real submitted time entries), and month-to-date
// scoped-vs-logged + deliverable progress. The team-wide view moved to
// its own page/nav item, "/team-dashboard" (Dashboard.tsx, unchanged).

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
interface OutputTypeRow {
  id: string;
  name: string;
  sort_order: number | null;
}
interface TimeEntryRow {
  id: string;
  // 2026-09-22: null on a non-project entry (Meeting/Admin/etc.) --
  // these still count toward the person's logged hours, just not toward
  // any task.
  task_id: string | null;
  person_id: string;
  started_at: string;
  duration_minutes: number | null;
  status: string;
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
interface PendingTimeEntryRow {
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
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
// Same logged-hours color coding as Scoped vs Logged's Daily Activity view
// (HoursOverview.tsx) -- for ACTUAL logged hours, not the assigned/scoped
// utilization the allocation engine reports. See loggedHoursBands.ts for
// the 6-tier scale (phase64, 2026-09-23).
function toneColors(tone: "neutral" | "success" | "warning" | "danger"): { bg?: string; fg: string } {
  if (tone === "success") return { bg: "var(--success-bg)", fg: "var(--success-text)" };
  if (tone === "warning") return { bg: "var(--warning-bg)", fg: "var(--warning-text)" };
  if (tone === "danger") return { bg: "var(--danger-bg)", fg: "var(--danger-text)" };
  return { fg: "var(--muted)" };
}
const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MyDashboard() {
  const { person: me } = useSession();
  const { dialog: confirmDialog } = useConfirm();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  const [people, setPeople] = useState<PersonLite[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [ownerHistory, setOwnerHistory] = useState<OwnerHistoryRow[]>([]);
  const [assigneeHistory, setAssigneeHistory] = useState<AssigneeHistoryRow[]>([]);
  const [deletedHours, setDeletedHours] = useState<DeletedHourRow[]>([]);
  const [outputTypes, setOutputTypes] = useState<OutputTypeRow[]>([]);
  const [monthEntries, setMonthEntries] = useState<TimeEntryRow[]>([]);

  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [pendingTimeEntries, setPendingTimeEntries] = useState<PendingTimeEntryRow[]>([]);
  const [baselineRequests, setBaselineRequests] = useState<BaselineRow[]>([]);
  const [closureRequests, setClosureRequests] = useState<ClosureRow[]>([]);

  // Week picker (2026-09-19, mockup's top-right date range) -- Monday-
  // start work week, navigable, drives every "This Week" card/widget.
  // "This Month" widgets stay fixed to the current calendar month.
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = useMemo(() => {
    const d = new Date();
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    return addDays(addDays(d, diff), weekOffset * 7);
  }, [weekOffset]);
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  async function loadAll() {
    setLoading(true);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

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
      { data: outputTypeData },
      { data: monthEntryData },
      { data: extData },
      { data: teData },
      { data: blData },
      { data: clData },
    ] = await Promise.all([
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("projects").select("*").eq("is_archived", false),
      supabase.from("tasks").select("*").eq("is_archived", false),
      supabase.from("holidays").select("date"),
      supabase.from("person_availability").select("person_id,date,status"),
      supabase.from("project_owner_history").select("project_id,person_id,effective_from,effective_to"),
      supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to"),
      supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
      supabase.from("app_settings").select("historical_locking_enabled").eq("id", true).single(),
      supabase.from("output_types").select("id,name,sort_order").order("sort_order"),
      me
        ? supabase
            .from("time_entries")
            .select("id,task_id,person_id,started_at,duration_minutes,status")
            .eq("person_id", me.id)
            .in("status", ["confirmed", "approved"])
            .eq("is_archived", false)
            .gte("started_at", monthStart.toISOString())
        : Promise.resolve({ data: [] as TimeEntryRow[] }),
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
    setOutputTypes((outputTypeData as OutputTypeRow[]) ?? []);
    setMonthEntries((monthEntryData as TimeEntryRow[]) ?? []);
    setExtensions((((extData as unknown as ExtensionRow[]) ?? [])).filter((r) => r.request_type !== "start_date"));
    setPendingTimeEntries((teData as unknown as PendingTimeEntryRow[]) ?? []);
    setBaselineRequests((blData as BaselineRow[]) ?? []);
    setClosureRequests((clData as ClosureRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const isFullAccess = me?.access_level === "full";
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const holidaySet = useMemo(() => buildHolidaySet(holidays.map((h) => h.date)), [holidays]);
  const holidayDateStrings = useMemo(() => new Set(holidays.map((h) => h.date.slice(0, 10))), [holidays]);
  const todayIso = toISO(new Date());

  // ---- My active projects & tasks ----------------------------------
  const myOpenTasks = useMemo(() => {
    if (!me) return [];
    return tasks
      .filter((t) => t.assignee_id === me.id && isOpenTask(t))
      .map((t) => ({ ...t, project: projectById.get(t.project_id) ?? null }))
      .sort((a, b) => (a.current_due_date ?? "9999").localeCompare(b.current_due_date ?? "9999"));
  }, [tasks, me, projectById]);
  const overdueTasks = myOpenTasks.filter((t) => t.current_due_date && t.current_due_date.slice(0, 10) < todayIso);
  const tasksDueToday = myOpenTasks.filter((t) => t.current_due_date && t.current_due_date.slice(0, 10) === todayIso);
  const weekEndIso = toISO(weekDays[4]);
  const weekStartIso = toISO(weekDays[0]);
  const tasksThisWeek = myOpenTasks.filter((t) => t.current_due_date && t.current_due_date.slice(0, 10) >= weekStartIso && t.current_due_date.slice(0, 10) <= weekEndIso);

  const myProjects = useMemo(() => (me ? projects.filter((p) => p.owner_id === me.id) : []), [projects, me]);

  // ---- Utilization This Week (assigned/scoped work), via the SAME
  // shared allocation engine Utilization.tsx/HoursOverview.tsx/
  // WbsPlanning.tsx use -- so this number never disagrees with the real
  // Utilization page. ---------------------------------------------------
  const engine = useMemo(
    () =>
      createAllocationEngine({
        tasks: tasks as unknown as UtilTaskRow[],
        projects: projects as unknown as UtilProjectRow[],
        holidays: holidaySet,
        availability,
        assigneeHistory,
        ownerHistory,
        todayStr: todayIso,
        deletedHours,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, projects, holidaySet, availability, assigneeHistory, ownerHistory, deletedHours]
  );

  const dailyStats = useMemo(() => {
    if (!me) return [];
    const person: UtilPersonRow = { id: me.id, daily_capacity_hours: me.daily_capacity_hours };
    return weekDays.map((d) => {
      const dateStr = toISO(d);
      const offRow = availability.find((a) => a.person_id === me.id && a.date.slice(0, 10) === dateStr && a.status === "off");
      const halfDayRow = availability.find((a) => a.person_id === me.id && a.date.slice(0, 10) === dateStr && a.status === "half_day");
      const isHoliday = holidayDateStrings.has(dateStr);
      const off = !!offRow || isHoliday;
      const capacity = off ? 0 : dailyCapacityHours(person, !!halfDayRow);
      const scoped = off ? 0 : engine.totalFor(me.id, dateStr);
      const pct = capacity > 0 ? (scoped / capacity) * 100 : scoped > 0 ? 999 : 0;
      // 2026-09-22 bugfix (Sandra: non-project time wasn't showing in "My
      // Logged Hours This Week") -- this used to require e.task_id, which
      // silently dropped every non-project entry (task_id is null there)
      // from the week's logged total.
      const logged = monthEntries
        .filter((e) => toISO(new Date(e.started_at)) === dateStr)
        .reduce((sum, e) => sum + (e.duration_minutes ?? 0) / 60, 0);
      return { date: d, dateStr, capacity, scoped, pct, logged, off };
    });
  }, [me, weekDays, availability, holidayDateStrings, engine, monthEntries]);

  const weekScopedTotal = dailyStats.reduce((sum, d) => sum + d.scoped, 0);
  const weekCapacityTotal = dailyStats.reduce((sum, d) => sum + d.capacity, 0);
  const weekUtilPct = weekCapacityTotal > 0 ? (weekScopedTotal / weekCapacityTotal) * 100 : 0;
  const weekLoggedTotal = dailyStats.reduce((sum, d) => sum + d.logged, 0);
  const daysOverCapacity = dailyStats.filter((d) => d.capacity > 0 && d.pct > 100).length;
  const missingLogHours = dailyStats
    .filter((d) => d.dateStr <= todayIso && !d.off)
    .reduce((sum, d) => sum + Math.max(0, d.capacity - d.logged), 0);

  // ---- Scoped vs Logged (This Month), by project, for my tasks -----
  const scopedVsLoggedByProject = useMemo(() => {
    if (!me) return [];
    const map = new Map<string, { projectId: string; name: string; scoped: number; logged: number }>();
    tasks
      .filter((t) => t.assignee_id === me.id)
      .forEach((t) => {
        const proj = projectById.get(t.project_id);
        if (!proj) return;
        const entry = map.get(proj.id) ?? { projectId: proj.id, name: proj.name, scoped: 0, logged: 0 };
        entry.scoped += t.estimated_hours ?? 0;
        entry.logged += monthEntries.filter((e) => e.task_id === t.id).reduce((sum, e) => sum + (e.duration_minutes ?? 0) / 60, 0);
        map.set(proj.id, entry);
      });
    return Array.from(map.values())
      .filter((r) => r.scoped > 0 || r.logged > 0)
      .sort((a, b) => Math.abs(b.logged - b.scoped) - Math.abs(a.logged - a.scoped))
      .slice(0, 6);
  }, [tasks, me, projectById, monthEntries]);

  // ---- My Deliverables (This Month) -- grouped by Output Type among my
  // tasks due this calendar month. -----------------------------------
  const deliverables = useMemo(() => {
    if (!me) return [];
    const monthPrefix = todayIso.slice(0, 7);
    const map = new Map<string, { name: string; done: number; total: number; sort: number }>();
    tasks
      .filter((t) => t.assignee_id === me.id && t.output_type_id && t.current_due_date && t.current_due_date.slice(0, 7) === monthPrefix)
      .forEach((t) => {
        const ot = outputTypes.find((o) => o.id === t.output_type_id);
        const name = ot?.name ?? "Other";
        const entry = map.get(name) ?? { name, done: 0, total: 0, sort: ot?.sort_order ?? 999 };
        entry.total += 1;
        if (t.status === "Done") entry.done += 1;
        map.set(name, entry);
      });
    return Array.from(map.values()).sort((a, b) => a.sort - b.sort);
  }, [tasks, me, outputTypes, todayIso]);

  // ---- Approvals ---------------------------------------------------------
  // This card is informational only: it tells ME whether things I SUBMITTED
  // (extension requests, time entries, baseline/closure requests) are still
  // waiting on someone else's decision. It intentionally does NOT show
  // items I need to approve/reject myself -- that decision workflow lives
  // on the Approval Center page, which has the full reviewer-eligibility
  // logic. Duplicating an Approve button here would let people action their
  // own submissions with none of that context.
  const myPendingExtensions = extensions.filter((r) => r.requester?.id === me?.id);
  const myPendingTimeEntries = pendingTimeEntries.filter((r) => r.person_id === me?.id);
  const myPendingBaseline = baselineRequests.filter((r) => r.requested_by === me?.id);
  const myPendingClosure = closureRequests.filter((r) => r.requested_by === me?.id);
  const myPendingApprovalsCount = myPendingExtensions.length + myPendingTimeEntries.length + myPendingBaseline.length + myPendingClosure.length;

  type SubmittedItem = { key: string; label: string; project: string; date: string; kind: "extension" | "time" | "baseline" | "closure"; to: string };
  const mySubmittedItems: SubmittedItem[] = [
    ...myPendingExtensions.map((r) => ({
      key: `ext-${r.id}`,
      label: r.project ? r.project.name : r.task?.name ?? "Untitled task",
      project: r.project ? "Whole project" : r.task?.project?.name ?? "—",
      date: r.created_at,
      kind: "extension" as const,
      to: "/extension-requests",
    })),
    ...myPendingTimeEntries.map((r) => ({
      key: `time-${r.id}`,
      label: r.task?.name ?? "Untitled task",
      project: r.task?.project?.name ?? "—",
      date: r.started_at,
      kind: "time" as const,
      to: "/time-tracking",
    })),
    ...myPendingBaseline.map((r) => ({
      key: `bl-${r.id}`,
      label: projectById.get(r.project_id)?.name ?? "Untitled project",
      project: "Baseline approval",
      date: r.requested_at,
      kind: "baseline" as const,
      to: `/projects/${r.project_id}/wbs`,
    })),
    ...myPendingClosure.map((r) => ({
      key: `cl-${r.id}`,
      label: projectById.get(r.project_id)?.name ?? "Untitled project",
      project: "Project close request",
      date: r.requested_at,
      kind: "closure" as const,
      to: `/projects/${r.project_id}/wbs`,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (loading || !me) return <p style={{ padding: 20, color: "var(--muted)" }}>Loading…</p>;

  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>My Dashboard</h1>
          <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}>
            {greeting}, {me.name.split(" ")[0]}! Here's your work overview for today.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "7px 12px", background: "var(--surface)", boxShadow: "var(--shadow-card)" }}>
            <button onClick={() => setWeekOffset((v) => v - 1)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
              <ChevronLeft size={14} style={{ color: "var(--muted)" }} />
            </button>
            <Calendar size={13} style={{ color: "var(--muted)", margin: "0 4px" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", whiteSpace: "nowrap" }}>
              {weekDays[0].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – {weekDays[4].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <button onClick={() => setWeekOffset((v) => v + 1)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}>
              <ChevronRight size={14} style={{ color: "var(--muted)" }} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: colorForPerson(me),
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {initials(me.name)}
            </span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)" }}>{me.name}</div>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{me.job_title || "Team Member"}</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <MetricCard icon={<Folder size={16} />} colors={METRIC_COLORS.blue} label="My Active Projects" value={myProjects.length} sub={`of ${projects.length} total projects`} />
        <MetricCard icon={<CheckCircle2 size={16} />} colors={METRIC_COLORS.green} label="Tasks Due This Week" value={tasksThisWeek.length} sub={`${tasksDueToday.length} due today`} />
        <MetricCard icon={<ShieldQuestion size={16} />} colors={METRIC_COLORS.purple} label="Pending Approvals" value={myPendingApprovalsCount} sub="Sent by you, awaiting decision" />
        <MetricCard icon={<BarChart3 size={16} />} colors={METRIC_COLORS.teal} label="Utilization This Week" value={`${Math.round(weekUtilPct)}%`} sub={`of ${weekCapacityTotal.toFixed(1)}h capacity`} />
        <MetricCard icon={<Clock3 size={16} />} colors={METRIC_COLORS.blue} label="Hours Logged This Week" value={`${weekLoggedTotal.toFixed(1)}h`} sub={`of ${weekCapacityTotal.toFixed(1)}h expected`} />
        <MetricCard icon={<AlertTriangle size={16} />} colors={METRIC_COLORS.red} label="Overdue Items" value={overdueTasks.length} sub="Needs attention" />
      </div>

      {(tasksDueToday.length > 0 || myPendingApprovalsCount > 0 || overdueTasks.length > 0 || daysOverCapacity > 0 || missingLogHours > 0.1) && (
        <div className="dash-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "14px 20px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)", marginRight: 4 }}>Needs My Attention</span>
          {tasksDueToday.length > 0 && <AttentionPill tone="danger" icon={<Calendar size={12} />} value={tasksDueToday.length} label="Tasks due today" to="/projects?assignee=me" />}
          {myPendingApprovalsCount > 0 && <AttentionPill tone="purple" icon={<ShieldQuestion size={12} />} value={myPendingApprovalsCount} label="Pending approvals" to="/approval-center" />}
          {overdueTasks.length > 0 && <AttentionPill tone="danger" icon={<AlertTriangle size={12} />} value={overdueTasks.length} label={overdueTasks.length === 1 ? "Overdue task" : "Overdue tasks"} to="/projects?assignee=me" />}
          {daysOverCapacity > 0 && <AttentionPill tone="gold" icon={<Gauge size={12} />} value={daysOverCapacity} label={daysOverCapacity === 1 ? "Day over capacity" : "Days over capacity"} to="/utilization?person=me" />}
          {missingLogHours > 0.1 && <AttentionPill tone="accent" icon={<Clock3 size={12} />} value={`${missingLogHours.toFixed(1)}h`} label="Missing logs" to="/time-tracking" />}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20, alignItems: "start" }}>
        <div>
          <div className="dash-card">
            <SectionHeader title={`My Projects (${myProjects.length})`} to="/projects?owner=me" />
            {myProjects.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>You don't own any active projects.</p>
            ) : (
              <>
                <div style={{ display: "flex", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, padding: "0 4px 6px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ flex: "1 1 40%" }}>Project</span>
                  <span style={{ flex: "0 0 110px" }}>Health</span>
                  <span style={{ flex: "1 1 30%" }}>Progress</span>
                  <span style={{ flex: "0 0 90px", textAlign: "right" }}>End Date</span>
                </div>
                {myProjects.slice(0, 6).map((p) => {
                  const health = healthOf(p, tasks, holidayDateStrings);
                  const progress = actualProgress(p.id, tasks);
                  return (
                    <div key={p.id} className="dash-row" onClick={() => navigate(`/projects/${p.id}/wbs`)}>
                      <span style={{ flex: "1 1 40%", fontWeight: 600, color: "var(--navy)", fontSize: 12.5 }}>{p.name}</span>
                      <span style={{ flex: "0 0 110px" }}>
                        <span className={`status-pill ${health.tone}`} style={{ fontSize: 9.5 }}>
                          {health.label.toUpperCase()}
                        </span>
                      </span>
                      <span style={{ flex: "1 1 30%", display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--hover-bg)", overflow: "hidden" }}>
                          <div style={{ width: `${progress ?? 0}%`, height: "100%", background: "var(--accent)", borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{progress === null ? "—" : `${Math.round(progress)}%`}</span>
                      </span>
                      <span style={{ flex: "0 0 90px", textAlign: "right", fontSize: 11.5, color: "var(--text-secondary)" }}>{formatDate(p.end_date)}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div className="dash-card">
            <SectionHeader title={`My Tasks This Week (${tasksThisWeek.length})`} to="/projects?assignee=me" />
            {tasksThisWeek.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>Nothing due this week.</p>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, padding: "0 4px 6px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ flex: "0 0 24px" }} />
                  <span style={{ flex: "1 1 35%" }}>Task</span>
                  <span style={{ flex: "1 1 25%" }}>Project</span>
                  <span style={{ flex: "0 0 90px" }}>Due Date</span>
                  <span style={{ flex: "0 0 110px", textAlign: "right" }}>Status</span>
                </div>
                {tasksThisWeek.slice(0, 8).map((t) => {
                  const overdue = t.current_due_date && t.current_due_date.slice(0, 10) < todayIso;
                  return (
                    <div key={t.id} className="dash-row" onClick={() => navigate(`/projects/${t.project_id}`)}>
                      <span style={{ flex: "0 0 24px" }}>
                        <input type="checkbox" disabled title="Update status from the task's own page" style={{ cursor: "not-allowed" }} />
                      </span>
                      <span style={{ flex: "1 1 35%", fontWeight: 600, color: "var(--navy)", fontSize: 12.5 }}>{t.name}</span>
                      <span style={{ flex: "1 1 25%", fontSize: 11.5, color: "var(--text-secondary)" }}>{t.project?.name ?? "—"}</span>
                      <span style={{ flex: "0 0 90px", fontSize: 11.5, color: overdue ? "var(--danger-text)" : "var(--text-secondary)", fontWeight: overdue ? 700 : 400 }}>
                        {overdue ? "Overdue" : t.current_due_date?.slice(0, 10) === todayIso ? "Today" : formatDate(t.current_due_date)}
                      </span>
                      <span style={{ flex: "0 0 110px", textAlign: "right" }}>
                        <span className={`status-pill ${t.status === "In Progress" ? "accent" : "neutral"}`} style={{ fontSize: 9.5 }}>
                          {(t.status ?? "Not Started").toUpperCase()}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          <div className="dash-card" style={{ marginBottom: 0 }}>
            <SectionHeader title="Pending Approvals" to="/approval-center" small="Requests you've sent that are still awaiting a decision" />
            {mySubmittedItems.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>You have no pending requests right now.</p>
            ) : (
              <>
                <div style={{ display: "flex", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, padding: "0 4px 6px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ flex: "1 1 40%" }}>Item</span>
                  <span style={{ flex: "1 1 25%" }}>Project</span>
                  <span style={{ flex: "0 0 90px" }}>Submitted</span>
                  <span style={{ flex: "0 0 90px", textAlign: "right" }}>Status</span>
                </div>
                {mySubmittedItems.slice(0, 5).map((item) => (
                  <Link key={item.key} to={item.to} className="dash-row" style={{ textDecoration: "none", color: "inherit" }}>
                    <span style={{ flex: "1 1 40%", fontWeight: 600, color: "var(--navy)", fontSize: 12.5 }}>{item.label}</span>
                    <span style={{ flex: "1 1 25%", fontSize: 11.5, color: "var(--text-secondary)" }}>{item.project}</span>
                    <span style={{ flex: "0 0 90px", fontSize: 11.5, color: "var(--text-secondary)" }}>{formatDate(item.date)}</span>
                    <span style={{ flex: "0 0 90px", textAlign: "right" }}>
                      <span className="status-pill warning" style={{ fontSize: 9.5 }}>PENDING</span>
                    </span>
                  </Link>
                ))}
              </>
            )}
          </div>
        </div>

        <div>
          <div className="dash-card">
            <SectionHeader title="My Utilization This Week" to="/utilization?person=me" small="Based on assigned work vs available capacity" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {dailyStats.map((d) => {
                const over = d.capacity > 0 && d.pct > 100;
                const colors = d.off ? { bg: "var(--hover-bg)", fg: "var(--muted)" } : over ? toneColors("danger") : toneColors("success");
                return (
                  <div key={d.dateStr} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textAlign: "center", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      {WEEKDAY_LABEL[d.date.getDay()]}
                      <div style={{ fontSize: 9, fontWeight: 400 }}>{d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    </div>
                    <div style={{ padding: "10px 4px", textAlign: "center", background: colors.bg }}>
                      {d.off ? (
                        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Off</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: colors.fg }}>{Math.round(d.pct)}%</div>
                          <div style={{ fontSize: 9, color: colors.fg }}>
                            {d.scoped.toFixed(1)}h / {d.capacity.toFixed(1)}h
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="dash-card">
            <SectionHeader title="My Logged Hours This Week" to="/hours-overview?person=me" small="Based on your actual submitted time entries" />
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(5, 1fr)", gap: 6, alignItems: "center" }}>
              <span />
              {dailyStats.map((d) => (
                <span key={d.dateStr} style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>
                  {WEEKDAY_LABEL[d.date.getDay()]}
                  <div style={{ fontSize: 9, fontWeight: 400 }}>{d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                </span>
              ))}
              <div>
                <div style={{ fontWeight: 600, color: "var(--navy)", fontSize: 12 }}>{me.name}</div>
                <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{me.job_title || "Team Member"}</div>
              </div>
              {dailyStats.map((d) => {
                const colors = loggedHoursTier(d.logged);
                return (
                  <div key={d.dateStr} style={{ textAlign: "center", background: colors.bg, color: colors.fg, fontWeight: 700, fontSize: 12, padding: "8px 0", borderRadius: "var(--radius-sm)" }}>
                    {d.logged > 0 ? (
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                        {d.logged.toFixed(1)}h
                        {/* 2026-09-23 (Sandra): Very low and Significantly above
                            share the same danger-red -- the arrow tells the two
                            apart at a glance, same as HoursOverview.tsx's Daily
                            Activity grid. */}
                        {colors.key === "very_low" && <ArrowDown size={10} />}
                        {colors.key === "excessive" && <ArrowUp size={10} />}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 18, fontSize: 11, color: "var(--text-secondary)", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <span>
                Expected Hours <strong style={{ color: "var(--navy)" }}>{weekCapacityTotal.toFixed(1)}h</strong>
              </span>
              <span>
                Logged Hours <strong style={{ color: "var(--navy)" }}>{weekLoggedTotal.toFixed(1)}h</strong>
              </span>
              <span>
                Variance{" "}
                <strong style={{ color: weekLoggedTotal - weekCapacityTotal >= 0 ? "var(--success-text)" : "var(--danger-text)" }}>
                  {weekLoggedTotal - weekCapacityTotal >= 0 ? "+" : ""}
                  {(weekLoggedTotal - weekCapacityTotal).toFixed(1)}h
                </strong>
              </span>
            </div>
            {/* 2026-09-23 (phase64): same 6-tier legend as HoursOverview's
                Daily Activity view, so the color coding reads the same
                wherever logged hours show up. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10, color: "var(--muted)", marginTop: 10 }}>
              {LOGGED_HOURS_LEGEND.map(({ range, label, tone }) => (
                <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className={`status-pill ${tone}`} style={{ fontSize: 9.5, padding: "1px 5px", fontWeight: 700 }}>
                    {range}
                  </span>
                  {label}
                  {label === "Very low" && <ArrowDown size={10} style={{ color: "var(--danger-text)" }} />}
                  {label === "Significantly above" && <ArrowUp size={10} style={{ color: "var(--danger-text)" }} />}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div className="dash-card" style={{ marginBottom: 0 }}>
              <SectionHeader title="Productivity" small="This Month" to="/hours-overview?person=me" />
              {scopedVsLoggedByProject.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--muted)" }}>Nothing yet this month.</p>
              ) : (
                <div>
                  {scopedVsLoggedByProject.map((r, i) => {
                    const variance = r.logged - r.scoped;
                    const dotColor = DOT_PALETTE[i % DOT_PALETTE.length];
                    return (
                      <div key={r.projectId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", borderBottom: "1px solid var(--border)", fontSize: 11.5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontWeight: 600, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        <span style={{ color: "var(--text-secondary)", flexShrink: 0 }}>{r.logged.toFixed(1)}h</span>
                        <span style={{ color: variance >= 0 ? "var(--danger-text)" : "var(--success-text)", fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: "right" }}>
                          {variance >= 0 ? "+" : ""}
                          {variance.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="dash-card" style={{ marginBottom: 0 }}>
              <SectionHeader title="Deliverables" small="This Month" to="/projects?assignee=me" />
              {deliverables.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--muted)" }}>None due this month.</p>
              ) : (
                <div>
                  {deliverables.map((d) => (
                    <div key={d.name} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                        <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                        <span style={{ fontWeight: 700, color: "var(--navy)", flexShrink: 0, marginLeft: 6 }}>
                          {d.done}/{d.total}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: "var(--hover-bg)", overflow: "hidden" }}>
                        <div style={{ width: `${d.total > 0 ? (d.done / d.total) * 100 : 0}%`, height: "100%", background: "var(--accent)", borderRadius: 3 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}

const METRIC_COLORS: Record<string, { bg: string; fg: string }> = {
  blue: { bg: "#e5f0fe", fg: "#2f6fed" },
  green: { bg: "#e2f8ea", fg: "#16a34a" },
  purple: { bg: "#f0e8fd", fg: "#8b5cf6" },
  teal: { bg: "#dcf7f2", fg: "#0d9488" },
  red: { bg: "#fde4e2", fg: "#dc2626" },
};

const DOT_PALETTE = ["#f59e0b", "#2f6fed", "#16a34a", "#8b5cf6", "#0d9488", "#ec4899"];

function SectionHeader({ title, to, small }: { title: string; to: string; small?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
      <div>
        <h2 style={{ fontSize: 13.5, margin: 0, color: "var(--navy)" }}>{title}</h2>
        {small && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{small}</div>}
      </div>
      <Link to={to} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none", flexShrink: 0 }}>
        View All
      </Link>
    </div>
  );
}

function MetricCard({ icon, colors, label, value, sub }: { icon: JSX.Element; colors: { bg: string; fg: string }; label: string; value: number | string; sub: string }) {
  return (
    <div className="dash-card" style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: "1 1 180px", minWidth: 165, marginBottom: 0, padding: "16px" }}>
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: "50%", background: colors.bg, color: colors.fg, flexShrink: 0 }}>
        {icon}
      </span>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)" }}>{label}</div>
        <div style={{ fontSize: 21, fontWeight: 700, color: "var(--navy)", lineHeight: 1.25 }}>{value}</div>
        <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{sub}</div>
      </div>
    </div>
  );
}

function AttentionPill({ tone, icon, value, label, to }: { tone: string; icon: JSX.Element; value: number | string; label: string; to: string }) {
  return (
    <Link
      to={to}
      className={`status-pill ${tone}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "7px 12px", textDecoration: "none" }}
    >
      {icon}
      <strong>{value}</strong> {label}
      <ChevronRight size={11} />
    </Link>
  );
}
