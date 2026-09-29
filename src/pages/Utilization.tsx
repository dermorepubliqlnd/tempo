import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Minus, Circle, CheckCircle2, TrendingUp, Gauge, AlertTriangle, Info, X, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useSearchParams } from "react-router-dom";
import { buildHolidaySet } from "../lib/workingDays";
// One shared allocation engine for all three utilization surfaces
// (this page, Scoped vs Logged, and WBS Planning's Utilization snapshot).
// See src/lib/dailyAllocation.ts for what used to be duplicated here.
import { createAllocationEngine, dailyCapacityHours, parentTaskIdsOf, type UtilTaskRow } from "../lib/dailyAllocation";
import UtilPersonFilterButton from "../components/UtilPersonFilterButton";
import MultiSelectFilter from "../components/MultiSelectFilter";
import { displayPct, tierOf, UTIL_LEGEND } from "../lib/utilizationBands";

interface PersonRow {
  id: string;
  name: string;
  daily_capacity_hours: number;
  is_active: boolean;
  job_title?: string | null;
}
interface ProjectRow {
  id: string;
  name: string;
  owner_id: string | null;
  start_date: string | null;
  end_date: string | null;
  // Optional (2026-08-24): threaded into SchedProjectRow so the forward
  // scheduler can give already-baselined work precedence over Draft
  // projects, same as WBS Planning -- see capacityScheduler.ts's
  // SchedProjectRow for the rationale.
  wbs_status?: string | null;
}
interface TaskRow {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  name: string;
  assignee_id: string | null;
  status: string | null;
  start_date: string | null;
  current_due_date: string;
  estimated_hours: number | null;
  is_archived: boolean;
  sort_order: number | null;
  work_type_id: string | null;
  created_at: string;
  created_by: string | null;
}
interface AvailabilityRow {
  id: string;
  person_id: string;
  date: string;
  status: "off" | "half_day";
}
interface HolidayRow {
  id: string;
  date: string;
  name: string;
  category: "legal_ph" | "local" | "internal";
}
// Ownership/assignment history (2026-08-14): a transfer should freeze
// everything already elapsed under the ORIGINAL owner/assignee, only
// shifting future days to the new one. Mirrors supabase/policies.sql
// "Migration 2026-08-14b" and src/lib/utilizationCalc.ts's own shape.
interface OwnerHistoryRow {
  project_id: string;
  person_id: string;
  effective_from: string;
  effective_to: string | null;
}
interface AssigneeHistoryRow {
  task_id: string;
  person_id: string;
  effective_from: string;
  effective_to: string | null;
}
// Deletion history archive (2026-08-14c, hours-native since Phase 2
// 2026-08-20): when a task/project is permanently deleted, its
// already-elapsed Utilization hours are archived (supabase/policies.sql
// "Migration 2026-08-14c", table shape updated by the Phase 2 migration)
// as raw per-person-per-day numbers before the row disappears --
// deliberately no task/project name retained ("just the numbers", Sandra's
// explicit choice for this scope).
interface DeletedHourRow {
  person_id: string;
  date: string;
  hours: number;
}

// Same local-timezone date helpers used everywhere else in the app — never
// `new Date("YYYY-MM-DD")` directly (parses as UTC midnight, can shift a
// day in negative-UTC timezones).
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(r, diff);
}
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const WEEKDAY_LABEL = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// Scaled up ~1.25x from the original 46/220 for a roomier grid — keep
// these two in lockstep with the same constants in DayPlanner.tsx so the
// two grids stay visually matched.
const CELL_W = 58;
const LABEL_W = 360;
// Weekly-mode columns need more room than a daily cell (two lines: avg %
// and a "planned / available" hours summary underneath).
const WEEK_CELL_W = 108;

// Icon per band tier -- utilizationBands.ts intentionally stays decoupled
// from any icon library (see its own header comment), so the key->icon
// mapping lives here instead.
const TIER_ICONS: Record<string, typeof Minus> = {
  unallocated: Minus,
  available: Circle,
  healthy: CheckCircle2,
  high: TrendingUp,
  full: Gauge,
  overloaded: AlertTriangle,
};
const LEGEND_ICON_BY_LABEL: Record<string, typeof Minus> = {
  Unallocated: Minus,
  Available: Circle,
  Healthy: CheckCircle2,
  High: TrendingUp,
  Full: Gauge,
  Overloaded: AlertTriangle,
};

function rollupCellStyle(i: number): CSSProperties {
  return {
    width: CELL_W,
    minWidth: CELL_W,
    textAlign: "center",
    padding: "9px 3px",
    borderBottom: "1px solid var(--border)",
    borderLeft: i % 7 === 0 ? "1px solid var(--border)" : undefined,
  };
}
function subCellStyle(i: number): CSSProperties {
  return {
    width: CELL_W,
    minWidth: CELL_W,
    textAlign: "center",
    padding: "5px 3px",
    borderBottom: "1px solid var(--border)",
    borderLeft: i % 7 === 0 ? "1px solid var(--border)" : undefined,
  };
}
function rollupWeekCellStyle(wi: number): CSSProperties {
  return {
    width: WEEK_CELL_W,
    minWidth: WEEK_CELL_W,
    textAlign: "center",
    padding: "9px 3px",
    borderBottom: "1px solid var(--border)",
    borderLeft: wi === 0 ? undefined : "1px solid var(--border)",
  };
}
function subWeekCellStyle(wi: number): CSSProperties {
  return {
    width: WEEK_CELL_W,
    minWidth: WEEK_CELL_W,
    textAlign: "center",
    padding: "5px 3px",
    borderBottom: "1px solid var(--border)",
    borderLeft: wi === 0 ? undefined : "1px solid var(--border)",
  };
}

// NOTE (2026-08-31): the local weekend-only `taskWorkingDays` /
// `projectWorkingDays` that used to live here are gone. They were
// holiday-blind and Time-Off-blind, so in the default "Actual" mode any hours
// that landed on a holiday or a person's Off day were silently deleted from
// the grid (those cells render "Holiday"/"Off" and never print a value) --
// one of the concrete "utilization disappeared" mechanisms. Both now come
// from src/lib/dailyAllocation.ts, shared with Scoped vs Logged and the WBS
// snapshot so all three spread the same hours over the same days.

export default function Utilization() {
  const { person: me } = useSession();
  const [searchParams] = useSearchParams();
  const [people, setPeople] = useState<PersonRow[]>([]);
  // Every person, active or not (2026-09-03) -- deactivated people's
  // past Utilization data was never deleted, it's just been hidden by
  // the active-only fetch below by default. showAllPeople lets Sandra
  // flip to seeing everyone, same toggle as HoursOverview.tsx.
  const [allPeople, setAllPeople] = useState<PersonRow[]>([]);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [workTypes, setWorkTypes] = useState<{ id: string; is_fixed_schedule: boolean }[]>([]);
  const [ownerHistory, setOwnerHistory] = useState<OwnerHistoryRow[]>([]);
  const [assigneeHistory, setAssigneeHistory] = useState<AssigneeHistoryRow[]>([]);
  // Always-retained assignment history for workload-entry diagnostics. The
  // allocation engine may intentionally ignore history while historical
  // locking is disabled, but "when did this task enter this person's
  // workload?" must remain independently observable.
  const [workloadAssigneeHistory, setWorkloadAssigneeHistory] = useState<AssigneeHistoryRow[]>([]);
  const [deletedHours, setDeletedHours] = useState<DeletedHourRow[]>([]);
  const [loading, setLoading] = useState(true);

  // 2026-09-03 (Sandra: default should be the current month, with date
  // filters instead of a week-count picker; drop the Capacity-Based mode
  // entirely -- "this makes no sense"). rangeStart/rangeEnd replace the
  // old weekOffset/rangeWeeks pair -- Prev/Next now shift by the exact
  // span currently shown (so a custom date-filtered range pages by its
  // own width, not a fixed week count), and the From/To inputs let Sandra
  // pick any window directly instead of jumping to a date and having a
  // fixed 1/2/4-week span built around it.
  const [rangeStart, setRangeStart] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [rangeEnd, setRangeEnd] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  });
  const [detailPersonId, setDetailPersonId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"daily" | "weekly">("daily");
  // Person filter (2026-09-03, Sandra: "add a name filter so we can just
  // select who we want to view") -- reuses the same searchable multi-select
  // already shipped on Scoped vs Logged (HoursOverview.tsx) and the WBS
  // snapshot (WbsPlanning.tsx), so all three surfaces behave identically.
  const [personFilter, setPersonFilter] = useState<Set<string> | null>(null);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  // 2026-09-21 (Sandra): let My Dashboard's "View All" links land here
  // already scoped to the signed-in person (?person=me), instead of always
  // showing the full team. One-shot on mount only -- doesn't fight the
  // person picker below if they then change it themselves.
  useEffect(() => {
    if (searchParams.get("person") === "me" && me?.id) {
      setPersonFilter(new Set([me.id]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);
  const [personFilterOpen, setPersonFilterOpen] = useState(false);
  const [personFilterSearch, setPersonFilterSearch] = useState("");
  // Role filter (2026-09-18, Sandra: "add option to filter by role") --
  // filters by the same job_title field shown under each name.
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  // Phase 1 utilization UX: make the display intent explicit instead of
  // treating hours as a secondary on/off decoration.
  const [displayMode, setDisplayMode] = useState<"both" | "utilization" | "hours">("both");
  const [taskSort, setTaskSort] = useState<"project" | "oldest" | "newest">("project");
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedCell, setSelectedCell] = useState<{ personId: string; dateStr: string } | null>(null);

  async function loadAll() {
    setLoading(true);
    const [{ data: p }, { data: ap }, { data: pr }, { data: tk }, { data: av }, { data: hol }, { data: wts }, { data: ownHist }, { data: assHist }, { data: delHrs }, { data: settings }] = await Promise.all([
      supabase.from("people").select("id,name,daily_capacity_hours,is_active,job_title").eq("is_active", true).order("name"),
      supabase.from("people").select("id,name,daily_capacity_hours,is_active,job_title").order("name"),
      supabase.from("projects").select("id,name,owner_id,start_date,end_date,wbs_status,status,paused_at,resumed_at").eq("is_archived", false),
      supabase.from("tasks").select("id,project_id,parent_task_id,name,assignee_id,status,start_date,current_due_date,estimated_hours,is_archived,sort_order,work_type_id,created_at,created_by").eq("is_archived", false),
      supabase.from("person_availability").select("*"),
      supabase.from("holidays").select("*"),
      supabase.from("work_types").select("id,is_fixed_schedule"),
      supabase.from("project_owner_history").select("project_id,person_id,effective_from,effective_to"),
      supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to"),
      supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
      supabase.from("app_settings").select("historical_locking_enabled").eq("id", true).single(),
    ]);
    setPeople((p as PersonRow[]) ?? []);
    setAllPeople((ap as PersonRow[]) ?? []);
    setProjects((pr as ProjectRow[]) ?? []);
    setTasks((tk as TaskRow[]) ?? []);
    setAvailability((av as AvailabilityRow[]) ?? []);
    setHolidays((hol as HolidayRow[]) ?? []);
    setWorkTypes((wts as { id: string; is_fixed_schedule: boolean }[]) ?? []);
    // Sandra, 2026-08-14: "we're still playing around with the system" --
    // a global off switch (app_settings.historical_locking_enabled,
    // default false) for freezing past ownership/assignee attribution.
    // While off, leave these empty so ownerMatchesOnDate/
    // assigneeMatchesOnDate fall back to each project/task's CURRENT
    // owner_id/assignee_id everywhere below (their pre-history behavior).
    const historicalLockingEnabled = (settings as { historical_locking_enabled?: boolean } | null)?.historical_locking_enabled ?? false;
    setOwnerHistory(historicalLockingEnabled ? (ownHist as OwnerHistoryRow[]) ?? [] : []);
    setWorkloadAssigneeHistory((assHist as AssigneeHistoryRow[]) ?? []);
    setAssigneeHistory(historicalLockingEnabled ? (assHist as AssigneeHistoryRow[]) ?? [] : []);
    setDeletedHours((delHrs as DeletedHourRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Earliest anchor date is fixed (Sandra: "we can back-track dates as
  // far as Jan 2026 only") -- clamp any backward navigation so the
  // visible window never starts before it.
  const EARLIEST_ANCHOR = useMemo(() => new Date(2026, 0, 1), []);
  const todayRaw = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) arr.push(d);
    return arr;
  }, [rangeStart, rangeEnd]);

  // Shift the whole window backward/forward by its own current width (in
  // days) -- a custom-filtered range pages by its own size instead of an
  // unrelated fixed week count.
  function shiftRange(direction: -1 | 1) {
    const spanDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    setRangeStart((s) => addDays(s, direction * spanDays));
    setRangeEnd((e) => addDays(e, direction * spanDays));
  }
  function resetToCurrentMonth() {
    const d = new Date();
    setRangeStart(new Date(d.getFullYear(), d.getMonth(), 1));
    setRangeEnd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  function setRangeStartFromInput(dateStr: string) {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split("-").map(Number);
    const chosen = new Date(y, (m ?? 1) - 1, d ?? 1);
    if (chosen <= rangeEnd) setRangeStart(chosen);
  }
  function setRangeEndFromInput(dateStr: string) {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split("-").map(Number);
    const chosen = new Date(y, (m ?? 1) - 1, d ?? 1);
    if (chosen >= rangeStart) setRangeEnd(chosen);
  }
  const isAtEarliestAnchor = rangeStart <= EARLIEST_ANCHOR;

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  // Auto-scroll-to-today (2026-08-25, same fix as WbsPlanning.tsx's
  // Utilization snapshot panel -- see that file's comment for the full
  // rationale). Today sits at the very START of this grid by design (the
  // Phase 8 windowing fix anchors weekOffset 0 to today, not a Monday-
  // snapped week), so at a narrower viewport/zoom it's the first thing
  // that can end up scrolled past with no visible cue. Scrolls today's
  // column (daily) or week (weekly) into view whenever it's part of the
  // currently-shown window.
  const utilScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = utilScrollRef.current;
    if (!el) return;
    const todayIso = toISO(todayRaw);
    let targetLeft: number | null = null;
    if (viewMode === "daily") {
      const idx = days.findIndex((d) => toISO(d) === todayIso);
      if (idx !== -1) targetLeft = LABEL_W + idx * CELL_W;
    } else {
      const weekIdx = weeks.findIndex((week) => week.some((d) => toISO(d) === todayIso));
      if (weekIdx !== -1) targetLeft = LABEL_W + weekIdx * WEEK_CELL_W;
    }
    if (targetLeft === null) return;
    const colW = viewMode === "daily" ? CELL_W : WEEK_CELL_W;
    // Bugfix (2026-08-26, same class of issue as WbsPlanning.tsx's
    // Utilization snapshot panel -- see that file's comment): only
    // scroll if today's column isn't already fully visible at the
    // current position, instead of unconditionally re-centering every
    // time (which would hide this grid's own leftmost column whenever
    // today isn't already visible there, e.g. after paging weekOffset).
    //
    // Round 2 (2026-08-26, Sandra: a date column's own header text was
    // visibly clipped at 90% zoom, not just scrolled out of view): LABEL_W
    // is a STICKY overlay that always occupies the viewport's first
    // LABEL_W pixels regardless of scroll position -- a column can pass
    // the numeric "within [scrollLeft, scrollLeft+clientWidth)" check
    // while still rendering partly underneath that sticky region. Both
    // the visibility check and the centering math below now account for
    // it (same fix as WbsPlanning.tsx's STICKY_OFFSET).
    const viewStart = el.scrollLeft + LABEL_W;
    const viewEnd = el.scrollLeft + el.clientWidth;
    if (targetLeft >= viewStart && targetLeft + colW <= viewEnd) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const desired = targetLeft - el.clientWidth / 2 - LABEL_W / 2 + colW / 2;
    el.scrollLeft = Math.max(0, Math.min(desired, maxScroll));
  }, [days, weeks, viewMode, todayRaw]);

  const holidayByDate = useMemo(() => {
    const m = new Map<string, HolidayRow>();
    holidays.forEach((h) => m.set(h.date, h));
    return m;
  }, [holidays]);

  const holidaySet = useMemo(() => buildHolidaySet(holidays.map((h) => h.date)), [holidays]);
  const today = useMemo(() => toISO(new Date()), []);

  function availabilityFor(personId: string, dateStr: string): AvailabilityRow | undefined {
    return availability.find((a) => a.person_id === personId && a.date === dateStr);
  }
  function dayBlocked(personId: string, dateStr: string, dow: number): "holiday" | "off" | "weekend" | null {
    if (dow === 0 || dow === 6) return "weekend";
    if (holidayByDate.has(dateStr)) return "holiday";
    if (availabilityFor(personId, dateStr)?.status === "off") return "off";
    return null;
  }

  // 2026-07-28: parent tasks (tasks with their own sub-tasks) are excluded
  // from utilization hours -- a parent's own span/hours are already just a
  // rollup of its children (see WBS Planning's parentAssigneeState / the
  // Effort "N/A" treatment for parents), so counting a parent's own
  // Estimated Hours+Assignee here on top of its children's would
  // double-count whoever it's assigned to. Now computed by the shared
  // engine (dailyAllocation.ts) so every surface applies the identical
  // rule -- WBS Planning's snapshot used to apply it to only ONE project's
  // depth-0 parents, which is why it showed ~2x this page for the same
  // person on the same day.
  const parentTaskIds = useMemo(() => parentTaskIdsOf(tasks), [tasks]);

  // The single shared allocation engine. Everything below (rollup cells,
  // per-task sub-rows, PM sub-rows, weekly aggregation) reads from it, so
  // Scoped vs Logged and the WBS snapshot -- which build the same engine
  // from the same tables -- cannot drift from this page's numbers.
  // 2026-09-24 (Sandra): Project multi-select filter -- when set, the
  // engine only sees those projects' tasks and PM overhead, so every
  // number on the page is "utilization from these projects". Archived
  // (deleted-task) hours can't be attributed to a project, so they're
  // left out while the filter is on.
  const projectFilterSet = useMemo(() => (projectFilter.length ? new Set(projectFilter) : null), [projectFilter]);
  const engineTasks = useMemo(() => (projectFilterSet ? tasks.filter((t) => projectFilterSet.has(t.project_id)) : tasks), [tasks, projectFilterSet]);
  const engineProjects = useMemo(() => (projectFilterSet ? projects.filter((p) => projectFilterSet.has(p.id)) : projects), [projects, projectFilterSet]);
  const engine = useMemo(
    () =>
      createAllocationEngine({
        tasks: engineTasks as UtilTaskRow[],
        projects: engineProjects,
        holidays: holidaySet,
        availability,
        assigneeHistory,
        ownerHistory,
        todayStr: today,
        deletedHours: projectFilterSet ? [] : deletedHours,
      }),
    [engineTasks, engineProjects, projectFilterSet, holidaySet, availability, assigneeHistory, ownerHistory, today, deletedHours]
  );

  // "Ever associated" -- 2026-08-14: a person's expandable sub-rows now
  // list every task/project their history shows they EVER held, not just
  // whoever currently holds it. Each sub-row's own per-date value is then
  // gated by history too (the engine's assigneeMatchesOnDate/
  // ownerMatchesOnDate), so a transferred task/project correctly shows
  // nonzero only across the date range this specific person actually held
  // it -- the old assignee's sub-row goes to 0 the day it moves on, the new
  // assignee's sub-row starts contributing from that same day, and the two
  // together always sum to the task/project's real total.
  function historicalOwnerIds(projectId: string): Set<string> {
    return new Set(ownerHistory.filter((h) => h.project_id === projectId).map((h) => h.person_id));
  }
  function historicalAssigneeIds(taskId: string): Set<string> {
    return new Set(assigneeHistory.filter((h) => h.task_id === taskId).map((h) => h.person_id));
  }

  function deletedHoursFor(personId: string, dateStr: string): number {
    return engine.deletedHoursOnDate(personId, dateStr);
  }
  function hasDeletedHistory(personId: string): boolean {
    return engine.hasDeletedHistory(personId);
  }

  // Fix (2026-09-03, Sandra: "the task has been wiped out and there's
  // nothing I can see... I don't see the revision and review task"): this
  // used to also exclude Done tasks outright, so a completed task's real
  // historical hours (now correctly shown by dailyHoursFor/the shared
  // engine's date-gated fix, see dailyAllocation.ts) had no sub-row left to
  // explain them -- the collapsed total moved but its own breakdown looked
  // empty. Sub-rows now list every task this person is OR ever was
  // assigned to, open or Done alike; a Done task's row simply reads 0 on
  // any date from today forward, same as the collapsed total does.
  function openTasksFor(personId: string): TaskRow[] {
    return engineTasks.filter(
      (t) => (t.assignee_id === personId || historicalAssigneeIds(t.id).has(personId)) && !parentTaskIds.has(t.id)
    );
  }
  function ownedProjectsFor(personId: string): ProjectRow[] {
    return engineProjects.filter((p) => p.owner_id === personId || historicalOwnerIds(p.id).has(personId));
  }

  type WorkloadEntry = { date: string | null; estimated: boolean };

  function workloadEntryFor(t: TaskRow, personId: string): WorkloadEntry {
    const assignment = workloadAssigneeHistory
      .filter((h) => h.task_id === t.id && h.person_id === personId)
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
    if (assignment) return { date: assignment.effective_from.slice(0, 10), estimated: false };

    const date = t.created_at ? t.created_at.slice(0, 10) : null;
    // created_at was introduced on Sep 21 and older rows were reconstructed
    // from their historical epoch-ms sort_order. Keep that useful history,
    // but surface its approximate nature rather than presenting it as audit
    // certainty.
    return { date, estimated: !!date && date < "2026-09-21" };
  }

  function formatWorkloadDate(entry: WorkloadEntry): string {
    if (!entry.date) return "—";
    const d = parseLocalDate(entry.date);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return entry.estimated ? `~${label}` : label;
  }

  function orderedTasksFor(personId: string): TaskRow[] {
    const q = taskSearch.trim().toLowerCase();
    const rows = openTasksFor(personId).filter((t) => {
      if (!q) return true;
      const projectName = projects.find((p) => p.id === t.project_id)?.name ?? "";
      return t.name.toLowerCase().includes(q) || projectName.toLowerCase().includes(q);
    });
    return [...rows].sort((a, b) => {
      const aEntry = workloadEntryFor(a, personId).date ?? "9999-12-31";
      const bEntry = workloadEntryFor(b, personId).date ?? "9999-12-31";
      if (taskSort === "oldest") return aEntry.localeCompare(bEntry) || a.name.localeCompare(b.name);
      if (taskSort === "newest") return bEntry.localeCompare(aEntry) || a.name.localeCompare(b.name);
      const ap = projects.find((p) => p.id === a.project_id)?.name ?? "";
      const bp = projects.find((p) => p.id === b.project_id)?.name ?? "";
      return ap.localeCompare(bp) || aEntry.localeCompare(bEntry) || a.name.localeCompare(b.name);
    });
  }

  function taskHoursOnDate(t: TaskRow, dateStr: string, forPersonId: string): number {
    return engine.taskHoursOnDate(forPersonId, t as UtilTaskRow, dateStr);
  }
  function pmHoursOnDate(p: ProjectRow, dateStr: string, forPersonId: string): number {
    return engine.pmHoursOnDate(forPersonId, p, dateStr);
  }

  function dailyHoursFor(personId: string, dateStr: string): number {
    return engine.totalFor(personId, dateStr);
  }

  function dailyCapacityFor(person: PersonRow, halfDay: boolean): number {
    return dailyCapacityHours(person, halfDay);
  }

  // 2026-09-03: Capacity-Based mode (the forward-scheduler-backed
  // smoothing preview) removed per Sandra -- "this makes no sense". Every
  // date, past and future, now always uses the plain even-split "Actual"
  // calc below -- deletedHoursFor is already folded into dailyHoursFor via
  // the shared engine, so no separate archived-hours handling is needed
  // here anymore either.
  const scopedPeople = showAllPeople ? allPeople : people;
  const roleOptions = useMemo(
    () => Array.from(new Set(allPeople.map((p) => p.job_title).filter((r): r is string => !!r))).sort((a, b) => a.localeCompare(b)),
    [allPeople]
  );
  const visiblePeople = scopedPeople
    .filter((p) => !personFilter || personFilter.has(p.id))
    .filter((p) => !roleFilter || p.job_title === roleFilter)
    // Project filter: only people who work on (or own) one of those projects.
    .filter((p) => !projectFilterSet || openTasksFor(p.id).length > 0 || ownedProjectsFor(p.id).length > 0);

  // Single source of truth for a rollup cell's numeric hours value, for
  // BOTH the daily grid and the weekly aggregation below.
  function valueForDate(person: PersonRow, dateStr: string): number {
    return dailyHoursFor(person.id, dateStr);
  }
  function pmValueForDate(person: PersonRow, projectId: string, dateStr: string): number {
    const p = projects.find((x) => x.id === projectId);
    return p ? pmHoursOnDate(p, dateStr, person.id) : 0;
  }
  function taskValueForDate(person: PersonRow, t: TaskRow, dateStr: string): number {
    return taskHoursOnDate(t, dateStr, person.id);
  }

  interface WeekStats {
    avgPct: number;
    plannedHours: number;
    availableHours: number;
    peakPct: number;
    overloadedDays: number;
    workingDaysCount: number;
  }
  function weekStatsForPerson(person: PersonRow, week: Date[]): WeekStats {
    let workingDaysCount = 0;
    let plannedHours = 0;
    let availableHours = 0;
    let peakPct = 0;
    let overloadedDays = 0;
    let pctSum = 0;
    week.forEach((d) => {
      const dateStr = toISO(d);
      const dow = d.getDay();
      if (dayBlocked(person.id, dateStr, dow)) return;
      const av = availabilityFor(person.id, dateStr);
      const capacity = dailyCapacityFor(person, av?.status === "half_day");
      const value = valueForDate(person, dateStr);
      const pct = capacity > 0 ? (value / capacity) * 100 : value > 0 ? 999 : 0;
      workingDaysCount++;
      plannedHours += value;
      availableHours += capacity;
      pctSum += pct;
      if (pct > peakPct) peakPct = pct;
      if (pct > 100) overloadedDays++;
    });
    return {
      avgPct: workingDaysCount > 0 ? pctSum / workingDaysCount : 0,
      plannedHours,
      availableHours,
      peakPct,
      overloadedDays,
      workingDaysCount,
    };
  }
  function weekSum(week: Date[], getValue: (dateStr: string) => number): number {
    return week.reduce((sum, d) => sum + getValue(toISO(d)), 0);
  }

  const columnCount = viewMode === "daily" ? days.length : weeks.length;

  const detailPerson = detailPersonId ? allPeople.find((p) => p.id === detailPersonId) ?? people.find((p) => p.id === detailPersonId) : null;
  const detailTasks = detailPerson ? orderedTasksFor(detailPerson.id) : [];
  const detailOwnedProjects = detailPerson ? ownedProjectsFor(detailPerson.id) : [];
  const detailWeekStats = detailPerson ? weeks.map((week) => ({ week, stats: weekStatsForPerson(detailPerson, week) })) : [];

  const selectedPerson = selectedCell ? allPeople.find((p) => p.id === selectedCell.personId) ?? people.find((p) => p.id === selectedCell.personId) : null;
  const selectedAvailability = selectedCell && selectedPerson ? availabilityFor(selectedPerson.id, selectedCell.dateStr) : undefined;
  const selectedCapacity = selectedCell && selectedPerson ? dailyCapacityFor(selectedPerson, selectedAvailability?.status === "half_day") : 0;
  const selectedAllocated = selectedCell && selectedPerson ? valueForDate(selectedPerson, selectedCell.dateStr) : 0;
  const selectedPct = selectedCapacity > 0 ? (selectedAllocated / selectedCapacity) * 100 : selectedAllocated > 0 ? 999 : 0;
  const selectedContributions = selectedCell && selectedPerson
    ? [
        ...openTasksFor(selectedPerson.id)
          .map((t) => {
            const hours = taskValueForDate(selectedPerson, t, selectedCell.dateStr);
            const projectName = projects.find((p) => p.id === t.project_id)?.name ?? "No project";
            return { id: t.id, label: t.name, projectName, hours, entry: workloadEntryFor(t, selectedPerson.id), kind: "task" as const };
          })
          .filter((r) => r.hours > 0),
        ...ownedProjectsFor(selectedPerson.id)
          .map((p) => ({
            id: `pm-${p.id}`,
            label: "Project management",
            projectName: p.name,
            hours: pmValueForDate(selectedPerson, p.id, selectedCell.dateStr),
            entry: { date: p.start_date, estimated: false } as WorkloadEntry,
            kind: "pm" as const,
          }))
          .filter((r) => r.hours > 0),
      ].sort((a, b) => (a.entry.date ?? "9999-12-31").localeCompare(b.entry.date ?? "9999-12-31"))
    : [];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ marginBottom: 3 }}>Utilization</h1>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            View scoped task effort across your team to plan capacity and identify potential overloads.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, maxWidth: 455, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface)" }}>
          <Info size={15} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.45 }}>
            Utilization shows planned/scoped task effort based on hours. It does not show actual time worked.
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => shiftRange(-1)} className="planner-nav-btn" disabled={isAtEarliestAnchor} title={isAtEarliestAnchor ? "Can't go earlier than Jan 2026" : "Previous"} style={isAtEarliestAnchor ? { opacity: 0.4, cursor: "default" } : undefined}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--navy)", minWidth: 165 }}>
              {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
              {days[days.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <button onClick={() => shiftRange(1)} className="planner-nav-btn" title="Next"><ChevronRight size={14} /></button>
            <button onClick={resetToCurrentMonth} style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>This month</button>
            <div style={{ width: 1, height: 18, background: "var(--border)" }} />
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
              From
              <input type="date" min="2026-01-01" value={toISO(rangeStart)} onChange={(e) => setRangeStartFromInput(e.target.value)} style={{ fontSize: 11, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 7px" }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
              To
              <input type="date" min="2026-01-01" value={toISO(rangeEnd)} onChange={(e) => setRangeEndFromInput(e.target.value)} style={{ fontSize: 11, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 7px" }} />
            </label>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              {(["daily", "weekly"] as const).map((mode) => (
                <button key={mode} onClick={() => setViewMode(mode)} style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", padding: "5px 12px", border: "none", cursor: "pointer", background: viewMode === mode ? "var(--accent)" : "transparent", color: viewMode === mode ? "#fff" : "var(--muted)" }}>{mode}</button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Display:</span>
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              {([
                ["both", "Both"],
                ["utilization", "Utilization"],
                ["hours", "Hours"],
              ] as const).map(([mode, label]) => (
                <button key={mode} onClick={() => setDisplayMode(mode)} style={{ fontSize: 11, fontWeight: 700, padding: "5px 10px", border: "none", cursor: "pointer", background: displayMode === mode ? "var(--accent)" : "transparent", color: displayMode === mode ? "#fff" : "var(--muted)" }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 9, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <UtilPersonFilterButton people={scopedPeople} selected={personFilter} open={personFilterOpen} setOpen={setPersonFilterOpen} search={personFilterSearch} setSearch={setPersonFilterSearch} onChange={setPersonFilter} />
          <MultiSelectFilter options={projects.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))} selected={projectFilter} onChange={setProjectFilter} noun="projects" singular="Project" />
          <select value={showAllPeople ? "all" : "active"} onChange={(e) => setShowAllPeople(e.target.value === "all")} title="Deactivated team members' past hours are retained" style={{ fontSize: 11, fontWeight: 600, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 7px" }}>
            <option value="active">Active team members only</option>
            <option value="all">Show all (incl. deactivated)</option>
          </select>
          {roleOptions.length > 0 && (
            <select value={roleFilter ?? "__all__"} onChange={(e) => setRoleFilter(e.target.value === "__all__" ? null : e.target.value)} title="Filter by role" style={{ fontSize: 11, fontWeight: 600, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 7px" }}>
              <option value="__all__">All roles</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <div style={{ position: "relative" }}>
              <Search size={13} style={{ position: "absolute", left: 8, top: 7, color: "var(--muted)" }} />
              <input value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="Search expanded tasks…" style={{ width: 190, fontSize: 11, padding: "5px 8px 5px 27px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--navy)" }} />
            </div>
            <select value={taskSort} onChange={(e) => setTaskSort(e.target.value as "project" | "oldest" | "newest")} title="Order expanded task details" style={{ fontSize: 11, fontWeight: 600, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 7px" }}>
              <option value="project">Tasks: Project</option>
              <option value="oldest">Tasks: Added oldest</option>
              <option value="newest">Tasks: Added newest</option>
            </select>
            <button
              onClick={() => { setPersonFilter(null); setProjectFilter([]); setRoleFilter(null); setShowAllPeople(false); setTaskSearch(""); setTaskSort("project"); }}
              style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: "7px 10px", marginBottom: 8, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        {UTIL_LEGEND.map(({ pct, label, tone }) => {
          const Icon = LEGEND_ICON_BY_LABEL[label] ?? Minus;
          return (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5 }}>
              <span className={`status-pill ${tone}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon size={11} />{pct}</span>
              <span style={{ color: "var(--muted)" }}>{label}</span>
            </div>
          );
        })}
      </div>

      <div ref={utilScrollRef} className="card" style={{ padding: 0, overflowX: "auto", overflowY: "visible" }}>
        {loading ? (
          <div style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "max-content" }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 2,
                    background: "var(--surface)",
                    width: LABEL_W,
                    minWidth: LABEL_W,
                    borderBottom: "1px solid var(--border)",
                  }}
                />
                {viewMode === "daily"
                  ? weeks.map((week, wi) => (
                      <th
                        key={wi}
                        colSpan={7}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          letterSpacing: 0.3,
                          padding: "8px 5px",
                          borderBottom: "1px solid var(--border)",
                          borderLeft: "1px solid var(--border)",
                        }}
                      >
                        {week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
                        {week[week.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </th>
                    ))
                  : weeks.map((week, wi) => (
                      <th
                        key={wi}
                        style={{
                          width: WEEK_CELL_W,
                          minWidth: WEEK_CELL_W,
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--navy)",
                          padding: "8px 5px",
                          borderBottom: "1px solid var(--border)",
                          borderLeft: wi === 0 ? undefined : "1px solid var(--border)",
                        }}
                      >
                        {week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
                        {/* Fix (2026-09-03, Sandra: "weekly view comes out blank"):
                            hardcoded week[6] assumed every week chunk is a full 7
                            days, but `weeks` is just days.length sliced into 7s --
                            the trailing week of a range whose day count isn't a
                            multiple of 7 (e.g. "This month" on a 30-day month is
                            4 full weeks + a 2-day remainder) is shorter than 7,
                            so week[6] was undefined and .toLocaleDateString()
                            threw, crashing the whole page to blank. Use the
                            week's own last day instead. */}
                        {week[week.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </th>
                    ))}
              </tr>
              {viewMode === "daily" && (
                <tr>
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      background: "var(--surface)",
                      width: LABEL_W,
                      minWidth: LABEL_W,
                      borderBottom: "1px solid var(--border)",
                      textAlign: "left",
                      padding: "5px 13px",
                      fontSize: 13,
                      color: "var(--muted)",
                    }}
                  >
                    Team Member
                  </th>
                  {days.map((d, i) => {
                    const dow = d.getDay();
                    const weekend = dow === 0 || dow === 6;
                    return (
                      <th
                        key={i}
                        style={{
                          width: CELL_W,
                          minWidth: CELL_W,
                          padding: "5px 3px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: weekend ? "var(--muted)" : "var(--navy)",
                          background: weekend ? "var(--hover-bg)" : undefined,
                          borderBottom: "1px solid var(--border)",
                          borderLeft: i % 7 === 0 ? "1px solid var(--border)" : undefined,
                        }}
                      >
                        {WEEKDAY_LABEL[dow]} {d.getDate()}
                      </th>
                    );
                  })}
                </tr>
              )}
              {viewMode === "weekly" && (
                <tr>
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 2,
                      background: "var(--surface)",
                      width: LABEL_W,
                      minWidth: LABEL_W,
                      borderBottom: "1px solid var(--border)",
                      textAlign: "left",
                      padding: "5px 13px",
                      fontSize: 13,
                      color: "var(--muted)",
                    }}
                  >
                    Team Member
                  </th>
                  {weeks.map((_, wi) => (
                    <th key={wi} style={{ borderBottom: "1px solid var(--border)", borderLeft: wi === 0 ? undefined : "1px solid var(--border)" }} />
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {visiblePeople.length === 0 ? (
                <tr>
                  <td colSpan={1 + columnCount} style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>
                    {personFilter && personFilter.size === 0
                      ? "No team members selected."
                      : roleFilter && visiblePeople.length === 0
                      ? `No team members with the role "${roleFilter}".`
                      : showAllPeople
                      ? "No team members found."
                      : "No active team members found."}
                  </td>
                </tr>
              ) : (
                visiblePeople.map((person) => {
                  const isOpen = detailPersonId === person.id;
                  return (
                    <Fragment key={person.id}>
                      <tr style={{ background: "#fafbfc" }}>
                        <td
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 1,
                            background: "#fafbfc",
                            padding: "8px 13px",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--navy)",
                            borderBottom: "1px solid var(--border)",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                          onClick={() => {
                            setDetailPersonId(person.id);
                            setSelectedCell((prev) => (prev?.personId === person.id ? prev : null));
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <span>
                              {person.name}
                              {person.job_title && (
                                <>
                                  <br />
                                  <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 11 }}>{person.job_title}</span>
                                </>
                              )}
                            </span>
                          </span>
                        </td>
                        {viewMode === "daily"
                          ? days.map((d, i) => {
                              const dateStr = toISO(d);
                              const dow = d.getDay();
                              const blocked = dayBlocked(person.id, dateStr, dow);

                              if (blocked === "holiday") {
                                const h = holidayByDate.get(dateStr)!;
                                return (
                                  <td key={i} title={h.name} style={{ ...rollupCellStyle(i), background: "#eef1f5", color: "var(--muted)", fontSize: 11, fontWeight: 600 }}>
                                    Holiday
                                  </td>
                                );
                              }
                              if (blocked === "weekend") {
                                return <td key={i} style={{ ...rollupCellStyle(i), background: "var(--hover-bg)" }} />;
                              }
                              const av = availabilityFor(person.id, dateStr);
                              if (blocked === "off") {
                                return (
                                  <td key={i} style={{ ...rollupCellStyle(i), background: "#f1f2f4", color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>
                                    Off
                                  </td>
                                );
                              }
                              const value = valueForDate(person, dateStr);
                              const capacity = dailyCapacityFor(person, av?.status === "half_day");
                              const pct = capacity > 0 ? (value / capacity) * 100 : value > 0 ? 999 : 0;
                              const tier = tierOf(pct);
                              const Icon = TIER_ICONS[tier.key] ?? Minus;
                              return (
                                <td
                                  key={i}
                                  title={`${tier.label} · ${value.toFixed(1)}h allocated / ${capacity.toFixed(1)}h capacity`}
                                  onClick={() => {
                                    setDetailPersonId(person.id);
                                    setSelectedCell({ personId: person.id, dateStr });
                                  }}
                                  role="button"
                                  style={{
                                    ...rollupCellStyle(i),
                                    background: tier.bg,
                                    color: tier.fg,
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    outline: selectedCell?.personId === person.id && selectedCell?.dateStr === dateStr ? "2px solid var(--accent)" : undefined,
                                    outlineOffset: -2,
                                  }}
                                >
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <Icon size={13} />
                                    {displayMode !== "hours" && (
                                      <span>
                                        {tier.key === "unallocated" ? "–" : `${displayPct(pct)}%`}
                                        {av?.status === "half_day" && <span style={{ fontSize: 9, marginLeft: 2 }}>½</span>}
                                      </span>
                                    )}
                                    {displayMode !== "utilization" && (
                                      <span style={{ fontSize: displayMode === "hours" ? 11 : 9, fontWeight: displayMode === "hours" ? 700 : 500, opacity: displayMode === "hours" ? 1 : 0.78 }}>
                                        {value.toFixed(1)}h
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })
                          : weeks.map((week, wi) => {
                              const stats = weekStatsForPerson(person, week);
                              const tier = tierOf(stats.avgPct);
                              const Icon = TIER_ICONS[tier.key] ?? Minus;
                              const title =
                                stats.workingDaysCount === 0
                                  ? "No working days this week"
                                  : `${displayPct(stats.avgPct)}% ${tier.label} · Planned ${stats.plannedHours.toFixed(1)}h / ${stats.availableHours.toFixed(1)}h · Peak day ${displayPct(
                                      stats.peakPct
                                    )}% · Overloaded days: ${stats.overloadedDays}`;
                              return (
                                <td
                                  key={wi}
                                  style={{
                                    ...rollupWeekCellStyle(wi),
                                    background: stats.workingDaysCount === 0 ? undefined : tier.bg,
                                    color: stats.workingDaysCount === 0 ? "var(--muted)" : tier.fg,
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                  }}
                                  title={title}
                                >
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    <Icon size={13} />
                                    {displayMode !== "hours" && <span>{stats.workingDaysCount === 0 ? "–" : `${displayPct(stats.avgPct)}%`}</span>}
                                    {displayMode !== "utilization" && (
                                      <span style={{ fontSize: displayMode === "hours" ? 11 : 9, fontWeight: displayMode === "hours" ? 700 : 500, opacity: displayMode === "hours" ? 1 : 0.78 }}>
                                        {stats.plannedHours.toFixed(1)}h{displayMode === "both" ? ` / ${stats.availableHours.toFixed(1)}h` : ""}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                      </tr>
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>


      {detailPerson && (
        <>
          <div
            onClick={() => { setDetailPersonId(null); setSelectedCell(null); }}
            style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(15, 35, 65, 0.22)" }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 40,
              width: "min(80vw, 1480px)",
              minWidth: "720px",
              background: "var(--surface)",
              boxShadow: "-18px 0 42px rgba(15, 35, 65, 0.18)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "var(--navy)", marginBottom: 2 }}>{detailPerson.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{detailPerson.job_title ?? "Team member"}</div>
              </div>
              <button onClick={() => { setDetailPersonId(null); setSelectedCell(null); }} title="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", padding: 3 }}><X size={18} /></button>
            </div>

            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, overflowX: "auto" }}>
              {detailWeekStats.map(({ week, stats }, wi) => {
                const tier = tierOf(stats.avgPct);
                return (
                  <div key={wi} style={{ minWidth: 165, padding: "9px 11px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: tier.bg }}>
                    <div style={{ fontSize: 9.5, color: "var(--muted)", marginBottom: 3 }}>
                      {week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {week[week.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 17, fontWeight: 800, color: tier.fg }}>{displayPct(stats.avgPct)}%</span>
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>{stats.plannedHours.toFixed(1)}h / {stats.availableHours.toFixed(1)}h</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 4 }}>
                <button style={{ padding: "6px 10px", border: "none", borderBottom: "2px solid var(--accent)", background: "transparent", color: "var(--accent)", fontSize: 11, fontWeight: 700 }}>Tasks by Project</button>
                <button disabled style={{ padding: "6px 10px", border: "none", background: "transparent", color: "var(--muted)", fontSize: 11 }}>Tasks by Date</button>
                <button disabled style={{ padding: "6px 10px", border: "none", background: "transparent", color: "var(--muted)", fontSize: 11 }}>Pipeline Sequence</button>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 7, alignItems: "center" }}>
                <div style={{ position: "relative" }}>
                  <Search size={13} style={{ position: "absolute", left: 8, top: 7, color: "var(--muted)" }} />
                  <input value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="Search projects or tasks…" style={{ width: 220, fontSize: 11, padding: "5px 8px 5px 27px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--navy)" }} />
                </div>
                <select value={taskSort} onChange={(e) => setTaskSort(e.target.value as "project" | "oldest" | "newest")} style={{ fontSize: 11, fontWeight: 600, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 7px" }}>
                  <option value="project">Project (A–Z)</option>
                  <option value="oldest">Added oldest</option>
                  <option value="newest">Added newest</option>
                </select>
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: selectedCell?.personId === detailPerson.id ? "minmax(0, 1fr) 330px" : "1fr" }}>
              <div style={{ minWidth: 0, overflow: "auto", padding: "0 18px 18px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface)" }}>
                    <tr>
                      <th style={{ textAlign: "left", padding: "9px 8px", borderBottom: "1px solid var(--border)", minWidth: 250 }}>Project / Task</th>
                      <th style={{ textAlign: "right", padding: "9px 8px", borderBottom: "1px solid var(--border)", width: 90 }}>Planned</th>
                      <th style={{ textAlign: "left", padding: "9px 8px", borderBottom: "1px solid var(--border)", width: 130 }}>Added to Workload</th>
                      {days.map((d) => <th key={toISO(d)} style={{ textAlign: "center", padding: "9px 5px", borderBottom: "1px solid var(--border)", minWidth: 48 }}>{WEEKDAY_LABEL[d.getDay()]}<br />{d.getDate()}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {detailOwnedProjects.map((p) => {
                      const pTasks = detailTasks.filter((t) => t.project_id === p.id);
                      const pmDays = engine.pmDays(detailPerson.id, p);
                      if (taskSort === "project" && pTasks.length === 0 && !pmDays.size) return null;
                      return (
                        <Fragment key={p.id}>
                          <tr style={{ background: "var(--hover-bg)" }}>
                            <td style={{ padding: "8px", borderBottom: "1px solid var(--border)", fontWeight: 800, color: "var(--navy)" }}>{p.name}</td>
                            <td style={{ padding: "8px", borderBottom: "1px solid var(--border)", textAlign: "right", fontWeight: 700 }}>
                              {pTasks.reduce((s, t) => s + (t.estimated_hours ?? 0), 0).toFixed(1)}h
                            </td>
                            <td style={{ padding: "8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>—</td>
                            {days.map((d) => {
                              const v = pmValueForDate(detailPerson, p.id, toISO(d));
                              return <td key={toISO(d)} style={{ textAlign: "center", padding: "8px 4px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{v > 0 ? v.toFixed(2) : ""}</td>;
                            })}
                          </tr>
                          {pTasks.map((t) => {
                            const entry = workloadEntryFor(t, detailPerson.id);
                            return (
                              <tr key={t.id}>
                                <td style={{ padding: "7px 8px 7px 24px", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)" }}>{t.name}</td>
                                <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)", textAlign: "right", color: "var(--navy)" }}>{(t.estimated_hours ?? 0).toFixed(1)}h</td>
                                <td title={entry.estimated ? "Estimated from historical task order" : "Date this task entered this person's workload"} style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)", color: entry.estimated ? "var(--muted)" : "var(--accent)", fontWeight: 600 }}>{formatWorkloadDate(entry)}</td>
                                {days.map((d) => {
                                  const v = taskValueForDate(detailPerson, t, toISO(d));
                                  return <td key={toISO(d)} style={{ textAlign: "center", padding: "7px 4px", borderBottom: "1px solid var(--border)", color: "var(--muted)", background: selectedCell?.personId === detailPerson.id && selectedCell?.dateStr === toISO(d) ? "var(--hover-bg)" : undefined }}>{v > 0 ? v.toFixed(1) : ""}</td>;
                                })}
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                    {detailTasks.filter((t) => !detailOwnedProjects.some((p) => p.id === t.project_id)).map((t) => {
                      const proj = projects.find((p) => p.id === t.project_id);
                      const entry = workloadEntryFor(t, detailPerson.id);
                      return (
                        <tr key={t.id}>
                          <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ color: "var(--text-secondary)" }}>{t.name}</div>
                            <div style={{ color: "var(--muted)", fontSize: 9.5 }}>{proj?.name ?? "No project"}</div>
                          </td>
                          <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>{(t.estimated_hours ?? 0).toFixed(1)}h</td>
                          <td style={{ padding: "7px 8px", borderBottom: "1px solid var(--border)", color: entry.estimated ? "var(--muted)" : "var(--accent)", fontWeight: 600 }}>{formatWorkloadDate(entry)}</td>
                          {days.map((d) => {
                            const v = taskValueForDate(detailPerson, t, toISO(d));
                            return <td key={toISO(d)} style={{ textAlign: "center", padding: "7px 4px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>{v > 0 ? v.toFixed(1) : ""}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {detailTasks.some((t) => workloadEntryFor(t, detailPerson.id).estimated) && (
                  <div style={{ display: "flex", gap: 7, marginTop: 12, padding: 9, borderRadius: "var(--radius-sm)", background: "var(--hover-bg)", fontSize: 9.5, color: "var(--muted)" }}>
                    <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                    Dates prefixed with ~ are historical estimates reconstructed from the previous task ordering before exact task creation timestamps were introduced.
                  </div>
                )}
              </div>

              {selectedCell?.personId === detailPerson.id && selectedPerson && (
                <div style={{ borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--navy)" }}>
                        {parseLocalDate(selectedCell.dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Selected utilization day</div>
                    </div>
                    <button onClick={() => setSelectedCell(null)} title="Close day details" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><X size={14} /></button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                    {selectedPct > 100 ? <AlertTriangle size={15} style={{ color: "var(--danger)" }} /> : <Gauge size={15} style={{ color: "var(--accent)" }} />}
                    <span style={{ fontSize: 22, fontWeight: 800, color: selectedPct > 100 ? "var(--danger)" : "var(--navy)" }}>{displayPct(selectedPct)}%</span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14 }}>
                    <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", textAlign: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{selectedCapacity.toFixed(1)}h</div>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>Capacity</div>
                    </div>
                    <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", textAlign: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{selectedAllocated.toFixed(1)}h</div>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>Allocated</div>
                    </div>
                    <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", textAlign: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: selectedAllocated > selectedCapacity ? "var(--danger)" : "var(--success)" }}>{selectedAllocated > selectedCapacity ? "+" : ""}{(selectedAllocated - selectedCapacity).toFixed(1)}h</div>
                      <div style={{ fontSize: 9, color: "var(--muted)" }}>{selectedAllocated > selectedCapacity ? "Over" : "Remaining"}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--navy)", marginBottom: 6 }}>Work contributing to this day</div>
                  {selectedContributions.map((r, i) => (
                    <div key={r.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i + 1}. {r.label}</div>
                          <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{r.projectName}</div>
                          <div style={{ fontSize: 9.5, color: "var(--accent)", marginTop: 2 }}>Added {formatWorkloadDate(r.entry)}</div>
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 800 }}>{r.hours.toFixed(1)}h</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </>
      )}


    </div>
  );
}
