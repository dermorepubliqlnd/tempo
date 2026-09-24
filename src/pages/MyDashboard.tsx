import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
  Play,
  Square,
  Eye,
  EyeOff,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import Modal from "../components/Modal";
import { useSession } from "../lib/useSession";
import { useApprovalAuthority } from "../lib/useApprovalAuthority";
import { useConfirm } from "../lib/useConfirm";
import { formatDate } from "../lib/formatDate";
import { buildHolidaySet, buildHolidayNameMap, nonWorkingDayConfirmMessage } from "../lib/workingDays";
import { loggedHoursTier, LOGGED_HOURS_LEGEND } from "../lib/loggedHoursBands";
const LEGEND_DOT_COLOR: Record<string, string> = {
  blue: "var(--blue-text)",
  skyblue: "var(--skyblue-text)",
  success: "var(--success-text)",
  warning: "var(--warning-text)",
  danger: "var(--danger-text)",
};
import { colorForPerson } from "../lib/personColors";
import { useTimeTracking } from "../lib/TimeTrackingContext";
import { parseLocalDate, calendarDaysBetween } from "../lib/taskTiming";
// Reuses Health/Progress straight from Projects.tsx (same convention
// Dashboard.tsx already follows) so this page's numbers can never drift
// out of sync with what the Projects table itself shows for a project.
import { wbsStatusMetaFor } from "../lib/wbsStatus";
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
  name: string;
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
interface MyCorrectionRequest {
  id: string;
  created_at: string;
  entry: { id: string; task: { id: string; name: string; project: { id: string; name: string } | null } | null; activity_type: { id: string; name: string } | null } | null;
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

// phase104: requests on an archived task/project stay out of every list
// (they come back if the item is restored from the Archive).
function notOnArchived(r: unknown): boolean {
  const x = r as { task?: { is_archived?: boolean } | null; project?: { is_archived?: boolean } | null };
  return !x.task?.is_archived && !x.project?.is_archived;
}

// My Work Today grid (2026-09-24, v3 -- Sandra: "still too much white space").
// ONE grid for header + every cell (rows use display:contents), so columns
// size to their ACTUAL content (max-content / fit-content caps) and line up
// across rows. Content packs left with a uniform gap; the single 1fr spacer
// before Actions takes whatever is left so Actions stays at the right edge.
// v4 (Sandra: "big gap again"): no spacer column. Every data column is
// `auto`: sized to its content, then the grid's default stretch adds the SAME
// extra width to each auto track, so leftover space is spread evenly between
// columns instead of piling up in one gap before Actions. Task/Project
// cells carry a maxWidth so long names cap their max-content size.
const MWT_COLUMNS = [
  ...Array(8).fill("auto"), // Task ID, Task, Status, Timing, Project, Dates, Hours, Remaining
  "max-content",                                // Actions
];
const MWT_GRID: CSSProperties = { display: "grid", gridTemplateColumns: MWT_COLUMNS.join(" "), alignItems: "stretch" };
const MWT_GAP = 28;

export default function MyDashboard() {
  const { person: me } = useSession();
  // 2026-09-24: Approval Center is hidden for users without approval
  // authority, so the Pending Approvals header links elsewhere for them.
  const hasApprovalAuthority = useApprovalAuthority();
  const { running, busy: timerBusy, start: startTaskTimer, requestStop } = useTimeTracking();
  const { confirm, dialog: confirmDialog } = useConfirm();
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
  const [myCorrectionRequests, setMyCorrectionRequests] = useState<MyCorrectionRequest[]>([]);

  // 2026-09-23 (My Work Today, "Hide from Today"): a per-person-per-day
  // dismissal, kept in its own small table (task_daily_hidden) so it
  // never touches the task row itself. Fetched unfiltered-by-date for
  // me (tiny dataset) -- filtered down to "hidden_date === today" at
  // render time so this doesn't need to be a query dependency.
  const [hiddenToday, setHiddenToday] = useState<{ task_id: string; hidden_date: string }[]>([]);
  // 2026-09-23 (Sandra: lightbox for Tasks due today / Overdue tasks --
  // see AttentionPill below) -- which list is open, or null when closed.
  const [attentionModal, setAttentionModal] = useState<"due_today" | "overdue" | "ready_to_close" | "completed_open" | null>(null);
  // 2026-09-23 (My Work Today "Logged" column, Sandra: "show logged
  // hours against the tasks") -- same confirmed/approved, not-archived
  // definition Projects.tsx's own Spent Hrs column uses, just scoped to
  // entries I logged myself (my own assigned tasks) rather than a
  // month window like the weekly card above.
  const [myTaskEntries, setMyTaskEntries] = useState<{ task_id: string | null; duration_minutes: number | null }[]>([]);
  const [justHidden, setJustHidden] = useState<{ id: string; name: string } | null>(null);
  const [showHiddenToday, setShowHiddenToday] = useState(false);

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
      { data: hiddenData },
      { data: myTaskEntryData },
      { data: myCorrData },
    ] = await Promise.all([
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("projects").select("*").eq("is_archived", false),
      supabase.from("tasks").select("*").eq("is_archived", false),
      supabase.from("holidays").select("date,name"),
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
           task:tasks!extension_requests_task_id_fkey ( id, name, is_archived, project_id, project:projects ( id, name, owner_id ) ),
           project:projects!extension_requests_project_id_fkey ( id, name, is_archived, owner_id ),
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
        .eq("is_archived", false)
        .order("started_at", { ascending: false }),
      supabase.from("project_baseline_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
      supabase.from("project_closure_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
      me ? supabase.from("task_daily_hidden").select("task_id,hidden_date").eq("person_id", me.id) : Promise.resolve({ data: [] as { task_id: string; hidden_date: string }[] }),
      me
        ? supabase.from("time_entries").select("task_id,duration_minutes").eq("person_id", me.id).eq("is_archived", false).in("status", ["confirmed", "approved"])
        : Promise.resolve({ data: [] as { task_id: string | null; duration_minutes: number | null }[] }),
      // 2026-09-23 (phase102): my pending time-correction requests.
      me
        ? supabase
            .from("time_entry_correction_requests")
            .select("id, created_at, entry:time_entries ( id, task:tasks ( id, name, project:projects ( id, name ) ), activity_type:non_project_activity_types ( id, name ) )")
            .eq("requested_by", me.id)
            .eq("status", "pending")
        : Promise.resolve({ data: [] }),
    ]);
    setMyCorrectionRequests((myCorrData as unknown as MyCorrectionRequest[] | null) ?? []);

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
    setExtensions((((extData as unknown as ExtensionRow[]) ?? [])).filter((r) => r.request_type !== "start_date" && notOnArchived(r)));
    setPendingTimeEntries((teData as unknown as PendingTimeEntryRow[]) ?? []);
    setBaselineRequests((blData as BaselineRow[]) ?? []);
    setClosureRequests((clData as ClosureRow[]) ?? []);
    setHiddenToday((hiddenData as { task_id: string; hidden_date: string }[]) ?? []);
    setMyTaskEntries((myTaskEntryData as { task_id: string | null; duration_minutes: number | null }[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  const isFullAccess = me?.access_level === "full";
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const holidaySet = useMemo(() => buildHolidaySet(holidays.map((h) => h.date)), [holidays]);
  const holidayNames = useMemo(() => buildHolidayNameMap(holidays), [holidays]);
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

  // ---- My Work Today (2026-09-23) ------------------------------------
  // NOT the same as "due today"/"due this week" -- tasks whose SCHEDULE
  // (start_date..current_due_date) is active today, even if the actual
  // due date is later. Reuses myOpenTasks (already the assignee-me +
  // isOpenTask filter, i.e. excludes Done/Cancelled -- tasks don't have
  // a separate "archived" status, see [[project_capaciq_archive_semantics]])
  // rather than re-deriving the exclusion rule.
  const hiddenTodayIds = useMemo(() => new Set(hiddenToday.filter((h) => h.hidden_date === todayIso).map((h) => h.task_id)), [hiddenToday, todayIso]);
  const myWorkTodayAll = useMemo(
    () => myOpenTasks.filter((t) => t.start_date && t.start_date.slice(0, 10) <= todayIso && t.current_due_date && t.current_due_date.slice(0, 10) >= todayIso),
    [myOpenTasks, todayIso]
  );
  const myWorkTodayHiddenCount = myWorkTodayAll.filter((t) => hiddenTodayIds.has(t.id)).length;
  const myWorkTodayVisible = showHiddenToday ? myWorkTodayAll : myWorkTodayAll.filter((t) => !hiddenTodayIds.has(t.id));
  // 2026-09-23 (Sandra: "expand the Project column, can the width be
  // dynamic to fit the project name?") -- each My Work Today row is its
  // own independent flex container (not a real <table>), so columns
  // can't auto-fit to content the way table cells do while staying
  // aligned across rows. Approximated here instead: size the Project
  // column once, up front, to fit the LONGEST project name currently
  // visible (~6.3px/char at this font size + a little padding), floored
  // at the old 140px so a short name doesn't shrink the column too far.
  const myWorkTodayProjectColWidth = Math.max(140, ...myWorkTodayVisible.map((t) => (t.project?.name?.length ?? 0) * 6.3 + 20));
  function loggedHoursForTask(taskId: string): number {
    const childIds = new Set(tasks.filter((t) => t.parent_task_id === taskId).map((t) => t.id));
    const minutes = myTaskEntries
      .filter((e) => e.task_id === taskId || (e.task_id && childIds.has(e.task_id)))
      .reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
    return Math.round((minutes / 60) * 100) / 100;
  }
  // 2026-09-23 (Sandra, round 3: "replace tagging with timing -- pull
  // the timing for each task") -- Tag (Starts Today/Due Soon) column
  // retired in favor of the app's existing "Timing" concept
  // (Overdue/Due soon/On track), same thresholds as Projects.tsx's own
  // Timing column and HoursOverview.tsx's Per Task view, via the shared
  // taskTiming.ts helpers rather than a third copy of this logic. My
  // Work Today only ever shows open (Not Started/In Progress) tasks --
  // isOpenTask already excludes Done/Cancelled -- so this only needs
  // timingOf's to-do/in-progress branch (due-date-vs-today), not the
  // completed/cancelled ones.
  function workTodayTiming(t: (typeof myWorkTodayAll)[number]): { label: string; tone: "success" | "warning" | "danger" } {
    const due = parseLocalDate(t.current_due_date);
    const daysLeft = calendarDaysBetween(due, new Date());
    if (daysLeft < 0) return { label: "Overdue", tone: "danger" };
    if (daysLeft <= 3) return { label: "Due soon", tone: "warning" };
    return { label: "On track", tone: "success" };
  }

  async function hideTaskFromToday(taskId: string, taskName: string) {
    if (!me) return;
    setHiddenToday((prev) => [...prev, { task_id: taskId, hidden_date: todayIso }]);
    setJustHidden({ id: taskId, name: taskName });
    const { error } = await supabase.from("task_daily_hidden").upsert({ person_id: me.id, task_id: taskId, hidden_date: todayIso }, { onConflict: "person_id,task_id,hidden_date" });
    if (error) {
      // Roll back the optimistic update if the write failed.
      setHiddenToday((prev) => prev.filter((h) => !(h.task_id === taskId && h.hidden_date === todayIso)));
      alert(`Couldn't hide task: ${error.message}`);
    }
  }
  async function unhideTaskFromToday(taskId: string) {
    if (!me) return;
    setHiddenToday((prev) => prev.filter((h) => !(h.task_id === taskId && h.hidden_date === todayIso)));
    setJustHidden((cur) => (cur?.id === taskId ? null : cur));
    const { error } = await supabase.from("task_daily_hidden").delete().eq("person_id", me.id).eq("task_id", taskId).eq("hidden_date", todayIso);
    if (error) alert(`Couldn't restore task: ${error.message}`);
  }
  // Auto-dismiss the "Task hidden from Today. Undo" banner -- the hide
  // itself already took effect; this just stops offering an undo after
  // it's no longer the most recent action.
  useEffect(() => {
    if (!justHidden) return;
    const t = setTimeout(() => setJustHidden(null), 6000);
    return () => clearTimeout(t);
  }, [justHidden]);
  const weekEndIso = toISO(weekDays[4]);
  const weekStartIso = toISO(weekDays[0]);
  const tasksThisWeek = myOpenTasks.filter((t) => t.current_due_date && t.current_due_date.slice(0, 10) >= weekStartIso && t.current_due_date.slice(0, 10) <= weekEndIso);

  // 2026-09-24 (Sandra): My Projects lists only projects whose WBS is NOT
  // closed -- a closed WBS is final, nothing left to act on.
  const myProjects = useMemo(() => (me ? projects.filter((p) => p.owner_id === me.id && p.wbs_status !== "closed") : []), [projects, me]);

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
      // Parent tasks excluded: their outputs are counted on the sub-tasks.
      .filter((t) => t.assignee_id === me.id && t.output_type_id && !tasks.some((c) => c.parent_task_id === t.id) && t.current_due_date && t.current_due_date.slice(0, 7) === monthPrefix)
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
  const myPendingApprovalsCount = myPendingExtensions.length + myPendingTimeEntries.length + myPendingBaseline.length + myPendingClosure.length + myCorrectionRequests.length;

  type SubmittedItem = { key: string; label: string; project: string; date: string; kind: "extension" | "time" | "correction" | "baseline" | "closure"; to: string };
  const mySubmittedItems: SubmittedItem[] = [
    ...myPendingExtensions.map((r) => ({
      key: `ext-${r.id}`,
      label: r.project ? r.project.name : r.task?.name ?? "Untitled task",
      project: r.project ? "Whole project" : r.task?.project?.name ?? "—",
      date: r.created_at,
      kind: "extension" as const,
      to: "/projects",
    })),
    ...myPendingTimeEntries.map((r) => ({
      key: `time-${r.id}`,
      label: r.task?.name ?? "Untitled task",
      project: r.task?.project?.name ?? "—",
      date: r.started_at,
      kind: "time" as const,
      to: "/time-tracking",
    })),
    ...myCorrectionRequests.map((r) => ({
      key: `corr-${r.id}`,
      label: `Time correction: ${r.entry?.task?.name ?? r.entry?.activity_type?.name ?? "entry"}`,
      project: r.entry?.task?.project?.name ?? "Non-project",
      date: r.created_at,
      kind: "correction" as const,
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

  // phase114 (Sandra: "remind the project owner -- you have a project
  // that's Completed and at 100%, please review your WBS and close it").
  const parentTaskIdSet = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  const leafTasksOf = (projectId: string) => tasks.filter((t) => t.project_id === projectId && !parentTaskIdSet.has(t.id));
  const myCompletedProjects = projects.filter((p) => p.owner_id === me?.id && p.status === "Completed" && p.wbs_status !== "closed" && p.wbs_status !== "draft");
  const completedOpenProjects = myCompletedProjects
    .map((p) => ({ p, open: leafTasksOf(p.id).filter((t) => t.status !== "Done" && t.status !== "Cancelled") }))
    .filter((x) => x.open.length > 0);
  const readyToCloseProjects = myCompletedProjects
    .filter((p) => !completedOpenProjects.some((x) => x.p.id === p.id))
    .map((p) => ({
      p,
      unvalidated: leafTasksOf(p.id).filter((t) => t.status === "Done" && !t.validated_completion_date).length,
      days: p.completed_at ? Math.max(0, Math.floor((Date.now() - new Date(p.completed_at).getTime()) / 86400000)) : null,
    }));

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

      {(tasksDueToday.length > 0 || overdueTasks.length > 0 || missingLogHours > 0.1 || readyToCloseProjects.length > 0 || completedOpenProjects.length > 0) && (
        <div className="dash-card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "14px 20px" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)", marginRight: 4 }}>Needs My Attention</span>
          {/* 2026-09-23 (Sandra: "Pending approvals, remove and use the
              KPI card" / "Days over capacity remove") -- both trimmed;
              the KPI row above already covers Pending Approvals (correctly
              framed "sent by you, awaiting decision") and Overdue Items,
              so repeating them here was redundant. Tasks due today and
              Overdue tasks open a lightbox (no real due-today/overdue
              filter exists yet to route to) listing Task ID/Task/Project.
              Missing logs now always routes to MY Time specifically
              (?scope=mine), not whatever Team/All scope was last viewed --
              same experience for every task/project owner. */}
          {tasksDueToday.length > 0 && (
            <AttentionPill tone="danger" icon={<Calendar size={12} />} value={tasksDueToday.length} label="Tasks due today" onClick={() => setAttentionModal("due_today")} />
          )}
          {overdueTasks.length > 0 && (
            <AttentionPill tone="danger" icon={<AlertTriangle size={12} />} value={overdueTasks.length} label={overdueTasks.length === 1 ? "Overdue task" : "Overdue tasks"} onClick={() => setAttentionModal("overdue")} />
          )}
          {missingLogHours > 0.1 && (
            <AttentionPill tone="accent" icon={<Clock3 size={12} />} value={`${missingLogHours.toFixed(1)}h`} label="Missing hours this week" to="/time-tracking?scope=mine" />
          )}
          {readyToCloseProjects.length > 0 && (
            <AttentionPill tone="success" icon={<CheckCircle2 size={12} />} value={readyToCloseProjects.length} label={readyToCloseProjects.length === 1 ? "Project ready to close" : "Projects ready to close"} onClick={() => setAttentionModal("ready_to_close")} />
          )}
          {completedOpenProjects.length > 0 && (
            <AttentionPill tone="warning" icon={<AlertTriangle size={12} />} value={completedOpenProjects.length} label={completedOpenProjects.length === 1 ? "Completed project has open tasks" : "Completed projects have open tasks"} onClick={() => setAttentionModal("completed_open")} />
          )}
        </div>
      )}

      {(attentionModal === "ready_to_close" || attentionModal === "completed_open") && (
        <Modal
          title={attentionModal === "ready_to_close" ? "Projects ready to close" : "Completed projects with open tasks"}
          onClose={() => setAttentionModal(null)}
        >
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 0 }}>
            {attentionModal === "ready_to_close"
              ? "These projects are marked Completed and every task is Done or Cancelled. Review the WBS and request closure. Any Done task still awaiting validation has to be validated first."
              : "These projects are marked Completed but still have open tasks. Finish or cancel those tasks, or set the project back to In Progress."}
          </p>
          {(attentionModal === "ready_to_close" ? readyToCloseProjects : completedOpenProjects).map((x) => (
            <div key={x.p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
              <span style={{ flex: "0 0 64px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                {x.p.project_number ? `P-${String(x.p.project_number).padStart(4, "0")}` : "—"}
              </span>
              <span style={{ flex: "1 1 auto", fontWeight: 600, color: "var(--navy)" }}>{x.p.name}</span>
              <span style={{ flex: "0 0 auto", color: "var(--text-secondary)" }}>
                {"open" in x
                  ? `${x.open.length} open task${x.open.length === 1 ? "" : "s"}`
                  : [
                      x.days !== null ? `Completed ${x.days === 0 ? "today" : `${x.days}d ago`}` : null,
                      x.unvalidated > 0 ? `${x.unvalidated} awaiting validation` : "All validated",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
              <Link to={`/projects/${x.p.id}/wbs`} style={{ flex: "0 0 auto", fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
                Review WBS →
              </Link>
            </div>
          ))}
        </Modal>
      )}

      {(attentionModal === "due_today" || attentionModal === "overdue") && (
        <Modal
          title={attentionModal === "due_today" ? "Tasks due today" : "Overdue tasks"}
          onClose={() => setAttentionModal(null)}
        >
          {(() => {
            const rows = attentionModal === "due_today" ? tasksDueToday : overdueTasks;
            return rows.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)" }}>Nothing here.</p>
            ) : (
              <>
                <div style={{ display: "flex", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, padding: "0 4px 6px", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ flex: "0 0 64px" }}>Task ID</span>
                  <span style={{ flex: "1 1 auto" }}>Task</span>
                  <span style={{ flex: "0 0 140px" }}>Project</span>
                </div>
                {rows.map((t) => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", padding: "7px 4px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                    <span style={{ flex: "0 0 64px", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>T-{String(t.task_number).padStart(4, "0")}</span>
                    <span style={{ flex: "1 1 auto", fontWeight: 500 }}>{t.name}</span>
                    <span style={{ flex: "0 0 140px", color: "var(--text-secondary)" }}>{t.project?.name ?? "—"}</span>
                  </div>
                ))}
              </>
            );
          })()}
        </Modal>
      )}

      {/* 2026-09-23 (Sandra: "My Work Today ... helps employees quickly
          see what they are expected to work on today ... complement,
          not replace, the existing task list") -- distinct from Due
          Today/Due This Week: schedule-active-today (start_date <=
          today <= current_due_date), not deadline-today. Placed above
          My Projects per her follow-up. */}
      {myWorkTodayAll.length > 0 && (
        <div className="dash-card">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
            <h2 style={{ fontSize: 13.5, margin: 0, color: "var(--navy)" }}>My Work Today</h2>
            {myWorkTodayHiddenCount > 0 && (
              <button
                onClick={() => setShowHiddenToday((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}
              >
                {showHiddenToday ? `Hide hidden (${myWorkTodayHiddenCount})` : `Show hidden (${myWorkTodayHiddenCount})`}
              </button>
            )}
          </div>
          {justHidden && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--text-secondary)", background: "var(--hover-bg)", borderRadius: "var(--radius-sm)", padding: "6px 10px", marginBottom: 8 }}>
              <span>Task hidden from Today.</span>
              <button onClick={() => unhideTaskFromToday(justHidden.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontWeight: 600, fontSize: 11.5, padding: 0 }}>
                Undo
              </button>
            </div>
          )}
          {/* 2026-09-23 (Sandra, round 2: "it's ugly... task column too
              wide... task status header overlapping the tag column, not
              centered with the list below it... cut the hrs variance bar
              in half") -- switched every column to a fixed pixel width
              (no flex-grow at all -- growth is what let Task balloon)
              inside a horizontally-scrollable wrapper. Task Status/Tag
              headers got `whiteSpace: nowrap` -- they were wrapping onto
              a second line at their old width, which is what made them
              look like they were bleeding into the next column. Task/
              Project headers went back to left-aligned (matching their
              left-aligned, long-text data) -- centering a header over a
              long left-aligned value is what looked off; short/numeric
              columns stay centered, matching their data. */}
          {/* 2026-09-23 (Sandra, round 3: "replace tagging with timing...
              project is too wide... add a gap just to fill the white
              space minimally") -- Tag column retired for Timing
              (Overdue/Due soon/On track, shared taskTiming.ts logic).
              Every column is back to a plain fixed width -- Project no
              longer flex-grows (that's what made it balloon out with
              nothing but blank space in it); instead a small 8px gap
              between every column soaks up the leftover row width
              evenly, a little at a time, rather than dumping it all
              into one column. */}
          {/* 2026-09-24 (Sandra: "use the horizontal space better, reduce
              the blank area on the right") -- a real table spanning the
              full card: Task (name + ID) and Project are the flexible
              columns (Project widest), Dates and Hours are combined into
              one column each, the variance reads "Xh remaining" / "Xh
              over" instead of a signed number, and the Start/Stop + Hide
              icon buttons sit right-aligned. UI only -- the same timer and
              hide handlers as before. */}
          {/* 2026-09-24 (Sandra: column spacing diagnosis) -- switched from
              a fixed-layout <table> (where Task's 22% and Project's auto
              width absorbed ALL extra space on wide screens, leaving big
              empty stretches after short text) to ONE shared CSS Grid
              template for header + rows: Task and Project are capped, a
              flexible spacer before Actions takes any leftover width, and
              a uniform 16px column gap does the separating. */}
          <div style={{ overflowX: "auto" }}>
            <div style={MWT_GRID}>
              {["Task ID", "Task", "Status", "Timing", "Project", "Dates", "Hours (Logged / Est.)", "Remaining / Variance", "Actions"].map((h, i, arr) => (
                <span
                  key={`h${i}`}
                  style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", textAlign: i === arr.length - 1 ? "right" : "left", padding: `8px ${i === arr.length - 1 ? 0 : MWT_GAP}px 6px 0`, borderBottom: "1px solid var(--border)" }}
                >
                  {h}
                </span>
              ))}
          {myWorkTodayVisible.length === 0 ? (
            <p style={{ gridColumn: "1 / -1", fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>Nothing left to show -- everything scheduled for today is hidden.</p>
          ) : (
            myWorkTodayVisible.map((t) => {
              const isHidden = hiddenTodayIds.has(t.id);
              const isRunningHere = running?.task_id === t.id;
              const timerDisabled = timerBusy || (Boolean(running) && !isRunningHere);
              const timing = workTodayTiming(t);
              const logged = loggedHoursForTask(t.id);
              const variance = hoursVarianceOf(t.estimated_hours, logged);
              const varianceTone = hoursVarianceTone(variance?.percent ?? null);
              // Every cell carries the row's padding/border/opacity (display:contents rows have no box).
              const td: CSSProperties = { fontSize: 12, minWidth: 0, padding: `10px ${MWT_GAP}px 10px 0`, borderBottom: "1px solid var(--border)", opacity: isHidden ? 0.55 : 1, display: "flex", flexDirection: "column", justifyContent: "center" };
              const iconBtn: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer", padding: 0 };
              return (
                <div key={t.id} style={{ display: "contents" }}>
                  <div style={{ ...td, fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>T-{String(t.task_number).padStart(4, "0")}</div>
                  <div style={td}>
                    <div style={{ maxWidth: 260, fontWeight: 600, color: "var(--navy)", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.name}>{t.name}</div>
                  </div>
                  <div style={{ ...td, alignItems: "flex-start" }}>
                    <span className={`status-pill ${myWorkTodayStatusTone(t.status)}`} style={{ fontSize: 9, whiteSpace: "nowrap" }}>{t.status ?? "—"}</span>
                  </div>
                  <div style={{ ...td, alignItems: "flex-start" }}>
                    <span className={`status-pill ${timing.tone}`} style={{ fontSize: 9, whiteSpace: "nowrap" }}>{timing.label}</span>
                  </div>
                  <div style={{ ...td, color: "var(--text-secondary)" }} title={t.project?.name ?? undefined}>
                    <div style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{t.project?.name ?? "—"}</div>
                  </div>
                  <div style={{ ...td, color: "var(--text-secondary)", fontSize: 11.5, whiteSpace: "nowrap" }}>
                    {t.start_date ? formatDate(t.start_date) : "—"} → {formatDate(t.current_due_date)}
                  </div>
                  <div style={td}>
                    <div style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      <strong style={{ color: "var(--navy)" }}>{logged > 0 ? `${logged.toFixed(1)}h` : "0h"}</strong>
                      <span style={{ color: "var(--muted)" }}> / {t.estimated_hours ? `${t.estimated_hours.toFixed(1)}h` : "—"}</span>
                    </div>
                    {variance && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <div style={{ flex: "0 0 90px", height: 5, borderRadius: 3, background: "var(--hover-bg)", overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${Math.min(Math.max(variance.percent, 0), 100)}%`,
                              height: "100%",
                              borderRadius: 3,
                              background: varianceTone === "success" ? "var(--accent)" : varianceTone === "warning" ? "var(--warning-text)" : "var(--danger-text)",
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{variance.percent}%</span>
                      </div>
                    )}
                  </div>
                  <div style={{ ...td, alignItems: "flex-start" }}>
                    {variance ? (
                      <span className={`status-pill ${variance.hours <= 0 ? "success" : varianceTone}`} style={{ fontSize: 10, whiteSpace: "nowrap" }}>
                        {variance.hours <= 0 ? `${Math.abs(variance.hours).toFixed(1)}h remaining` : `${variance.hours.toFixed(1)}h over`}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>—</span>
                    )}
                  </div>
                  <div style={{ ...td, paddingRight: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", whiteSpace: "nowrap" }}>
                    <button
                      onClick={async () => {
                        if (isRunningHere) {
                          const res = await requestStop();
                          if (res.error) alert(`Couldn't stop timer: ${res.error}`);
                        } else {
                          // Weekend/holiday soft check (never blocks), checked against TODAY.
                          const warnMsg = nonWorkingDayConfirmMessage(todayIso, holidayNames);
                          if (warnMsg && !(await confirm({ message: warnMsg, confirmLabel: "Yes, start" }))) return;
                          const res = await startTaskTimer({ id: t.id, name: t.name });
                          if (res.error) alert(`Couldn't start timer: ${res.error}`);
                        }
                      }}
                      disabled={timerDisabled}
                      title={isRunningHere ? "Stop timer" : running ? `Stop the timer running on "${running.task_name}" first` : "Start timer"}
                      style={{
                        ...iconBtn,
                        background: isRunningHere ? "var(--danger-text)" : "var(--accent)",
                        color: "#fff",
                        cursor: timerDisabled ? "default" : "pointer",
                        opacity: Boolean(running) && !isRunningHere ? 0.35 : 1,
                      }}
                    >
                      {isRunningHere ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
                    </button>
                    {isHidden ? (
                      <button onClick={() => unhideTaskFromToday(t.id)} title="Restore to My Work Today" style={{ ...iconBtn, marginLeft: 6, background: "none", border: "1px solid var(--border)", color: "var(--accent)" }}>
                        <EyeOff size={13} />
                      </button>
                    ) : (
                      <button onClick={() => hideTaskFromToday(t.id, t.name)} title="Hide task for today" style={{ ...iconBtn, marginLeft: 6, background: "none", border: "1px solid var(--border)", color: "var(--muted)" }}>
                        <Eye size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        <div>
          {/* Hidden entirely when every project I own is closed ("all clear"). */}
          {myProjects.length > 0 && (
          <div className="dash-card">
            <SectionHeader title={`My Projects (${myProjects.length})`} to="/projects?owner=me" />
            {/* One grid for header + rows. All columns `auto`: sized to content,
                then leftover width is added EQUALLY to every column (Sandra:
                no single long gap after Project). Spacing via right padding,
                not column-gap, so row borders stay continuous. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, auto)", alignItems: "center" }}>
              {["ID", "Project", "WBS Status", "Health", "Progress", "End Date"].map((h, i) => (
                <span key={h} style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, padding: `0 ${i === 5 ? 0 : 16}px 6px 0`, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", textAlign: i === 3 ? "center" : i === 5 ? "right" : "left" }}>{h}</span>
              ))}
              {myProjects.slice(0, 6).map((p) => {
                const health = healthOf(p, tasks, holidayDateStrings);
                const progress = actualProgress(p.id, tasks);
                const closureRequested = closureRequests.some((r) => r.project_id === p.id);
                const baselinePending = baselineRequests.some((r) => r.project_id === p.id);
                const wbsMeta = closureRequested
                  ? { label: "Closure Requested", hint: "Closure has been requested and is waiting for approval.", color: "var(--warning-text, #b45309)", bg: "var(--warning-bg, #fff7ed)", border: "#f3dfb8" }
                  : wbsStatusMetaFor(p.wbs_status, baselinePending);
                const cell: CSSProperties = { padding: "9px 16px 9px 0", borderBottom: "1px solid var(--border)", cursor: "pointer", minWidth: 0, alignSelf: "stretch", display: "flex", alignItems: "center" };
                const go = () => navigate(`/projects/${p.id}/wbs`);
                return (
                  <div key={p.id} className="dash-grid-row" style={{ display: "contents" }}>
                    <span onClick={go} style={{ ...cell, fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      {p.project_number ? `P-${String(p.project_number).padStart(4, "0")}` : "—"}
                    </span>
                    <span onClick={go} style={{ ...cell, fontWeight: 600, color: "var(--navy)", fontSize: 12.5 }} title={p.name}>
                      <span style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.3 }}>{p.name}</span>
                    </span>
                    <span onClick={go} style={cell}>
                      <span title={wbsMeta?.hint} style={{ display: "inline-block", padding: "1px 7px", fontSize: 10.5, fontWeight: 500, whiteSpace: "nowrap", borderRadius: "var(--radius-btn)", border: `1px solid ${wbsMeta?.border ?? "var(--border)"}`, background: wbsMeta?.bg ?? "var(--surface)", color: wbsMeta?.color ?? "var(--text-secondary)" }}>
                        {wbsMeta?.label ?? p.wbs_status}
                      </span>
                    </span>
                    <span onClick={go} style={{ ...cell, justifyContent: "center" }}>
                      <span className={`status-pill ${health.tone}`} style={{ fontSize: 9.5, whiteSpace: "nowrap" }}>{health.label.toUpperCase()}</span>
                    </span>
                    <span onClick={go} style={{ ...cell, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: "0 0 60px", height: 6, borderRadius: 3, background: "var(--hover-bg)", overflow: "hidden" }}>
                        <div style={{ width: `${progress ?? 0}%`, height: "100%", background: "var(--accent)", borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--muted)", width: 32, textAlign: "right" }}>{progress === null ? "—" : `${Math.round(progress)}%`}</span>
                    </span>
                    <span onClick={go} style={{ ...cell, paddingRight: 0, justifyContent: "flex-end", fontSize: 11.5, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{formatDate(p.end_date)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          <div className="dash-card">
            <SectionHeader title={`Tasks Due This Week (${tasksThisWeek.length})`} to="/projects?assignee=me" />
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
            <SectionHeader title="Pending Approvals" to={hasApprovalAuthority ? "/approval-center" : "/time-tracking?scope=mine"} small="Requests you've sent that are still awaiting a decision" />
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
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
            {/* 2026-09-23 (Sandra: "match the My Logged Hours UI with My
                Utilization. I like the per day borders/shape... since
                this is a personal dashboard, I don't think we need to
                show the name and role") -- same bordered-card grid as
                My Utilization This Week above, name/role row dropped. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8 }}>
              {dailyStats.map((d) => {
                // 2026-09-23 (dynamic expected hours): d.capacity already
                // accounts for off/half-day/holiday (computed above in
                // dailyStats using the same expectedHoursForDay/
                // dailyCapacityHours logic Utilization/WBS use) -- pass it
                // straight through instead of assuming a flat 7.5h shift,
                // so a half-day person logging near their reduced target
                // reads "Within expected" instead of "Very low".
                const colors = loggedHoursTier(d.logged, d.capacity);
                const isFullTimeOff = d.off && d.logged <= 0;
                return (
                  <div key={d.dateStr} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textAlign: "center", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                      {WEEKDAY_LABEL[d.date.getDay()]}
                      <div style={{ fontSize: 9, fontWeight: 400 }}>{d.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    </div>
                    <div style={{ padding: "10px 4px", textAlign: "center", background: colors.bg }}>
                      {isFullTimeOff ? (
                        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Time Off</div>
                      ) : d.logged > 0 ? (
                        <div style={{ fontSize: 14, fontWeight: 700, color: colors.fg }}>
                          {d.logged.toFixed(1)}h
                        </div>
                      ) : (
                        <div style={{ fontSize: 14, fontWeight: 700, color: colors.fg }}>{"—"}</div>
                      )}
                    </div>
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
            {/* 2026-09-23 (stakeholder review: "keep it subtle -- a
                small legend, not swatch pills") -- same dot-style legend
                as HoursOverview's Daily Activity view now, same colors,
                same reduced-to-5-tiers set. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 10, color: "var(--muted)", marginTop: 10 }}>
              {LOGGED_HOURS_LEGEND.filter((l) => l.tone !== "neutral").map(({ label, tone }) => (
                <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: LEGEND_DOT_COLOR[tone], flexShrink: 0 }} />
                  {label}
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

// 2026-09-23 (Sandra: "instead of progress please show hrs variance --
// this is existing") -- same Est. vs Actual formula Projects.tsx's own
// Task Hrs Variance column already uses (hoursVarianceOf/
// hoursVarianceTone there), reimplemented locally here rather than
// importing a page-local (non-exported) helper from Projects.tsx. Null
// when there's no estimate to compare against.
function hoursVarianceOf(estimatedHours: number | null | undefined, spentHours: number): { hours: number; percent: number } | null {
  if (!estimatedHours) return null;
  return {
    hours: Math.round((spentHours - estimatedHours) * 100) / 100,
    percent: Math.round((spentHours / estimatedHours) * 100),
  };
}
function hoursVarianceTone(percent: number | null): "success" | "warning" | "danger" | "neutral" {
  if (percent === null) return "neutral";
  if (percent <= 100) return "success";
  if (percent <= 125) return "warning";
  return "danger";
}

// 2026-09-23 (Task Status column) -- My Work Today already excludes
// Done/Cancelled tasks (isOpenTask), so in practice this only ever
// shows "Not Started"/"In Progress"; kept as a simple direct mapping
// rather than importing Projects.tsx's fuller status-grouping config,
// which also covers custom/Site-Settings-mapped status labels this
// page doesn't need to handle.
function myWorkTodayStatusTone(status: string | null): "success" | "accent" | "neutral" {
  if (status === "In Progress") return "accent";
  if (status === "Done") return "success";
  return "neutral";
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

// 2026-09-23 (Sandra: pared Needs My Attention down to items that
// aren't already a KPI card and that route somewhere real) -- Pending
// approvals and Days over capacity were removed here since the KPI row
// above already shows them (correctly framed as "sent by you, awaiting
// decision"). Missing logs still links out (now always to MY Time,
// never Team/All -- see the ?scope=mine param). Tasks due today/
// Overdue tasks don't have a real due-today/overdue filter to route to
// yet, so instead of a broken link they open a lightbox listing the
// actual tasks (onClick), same pill styling either way.
function AttentionPill({
  tone,
  icon,
  value,
  label,
  to,
  onClick,
}: {
  tone: string;
  icon: JSX.Element;
  value: number | string;
  label: string;
  to?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon}
      <strong>{value}</strong> {label}
      {(to || onClick) && <ChevronRight size={11} />}
    </>
  );
  const style: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, padding: "7px 12px", textDecoration: "none" };
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`status-pill ${tone}`} style={{ ...style, border: "none", cursor: "pointer", font: "inherit" }}>
        {content}
      </button>
    );
  }
  return to ? (
    <Link to={to} className={`status-pill ${tone}`} style={style}>
      {content}
    </Link>
  ) : (
    <span className={`status-pill ${tone}`} style={style}>
      {content}
    </span>
  );
}
