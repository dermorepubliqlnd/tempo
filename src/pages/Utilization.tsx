import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, Circle, CheckCircle2, TrendingUp, Gauge, AlertTriangle, Info, X, Search, ArrowRight, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useSearchParams } from "react-router-dom";
import { buildHolidaySet } from "../lib/workingDays";
// One shared allocation engine for all three utilization surfaces
// (this page, Scoped vs Logged, and WBS Planning's Utilization snapshot).
// See src/lib/dailyAllocation.ts for what used to be duplicated here.
import { createAllocationEngine, dailyCapacityHours, isOpenTask, parentTaskIdsOf, type UtilTaskRow } from "../lib/dailyAllocation";
import UtilPersonFilterButton from "../components/UtilPersonFilterButton";
import MultiSelectFilter from "../components/MultiSelectFilter";
import { displayPct, tierOf, UTIL_LEGEND } from "../lib/utilizationBands";

interface PersonRow {
  id: string;
  name: string;
  daily_capacity_hours: number;
  is_active: boolean;
  job_title?: string | null;
  tracks_time?: boolean | null;
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
  status?: string | null;
  paused_at?: string | null;
  resumed_at?: string | null;
  project_type_id?: string | null;
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
interface SavedUtilView {
  id: string;
  name: string;
  personIds: string[] | null;
  roleFilter: string | null;
  projectIds: string[];
  showAllPeople: boolean;
  planningPreset: "month" | "this_week" | "next_week" | "next_2_weeks" | "custom";
  customStart?: string;
  customEnd?: string;
  viewMode: "daily" | "weekly";
  displayMode: "both" | "utilization" | "hours";
  isDefault?: boolean;
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
function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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

const PROJECT_TYPE_TONES = [
  { bg: "rgba(59,130,246,.10)", fg: "#2563eb", dot: "#3b82f6" },
  { bg: "rgba(16,185,129,.10)", fg: "#059669", dot: "#10b981" },
  { bg: "rgba(245,158,11,.12)", fg: "#b7791f", dot: "#f59e0b" },
  { bg: "rgba(139,92,246,.10)", fg: "#7c3aed", dot: "#8b5cf6" },
];

function taskStatusTone(status: string | null): { bg: string; fg: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "done" || s.includes("complete")) return { bg: "rgba(16,185,129,.10)", fg: "#059669" };
  if (s === "cancelled" || s === "canceled") return { bg: "rgba(100,116,139,.10)", fg: "#64748b" };
  if (s.includes("progress")) return { bg: "rgba(59,130,246,.10)", fg: "#2563eb" };
  if (s.includes("review") || s.includes("approval")) return { bg: "rgba(139,92,246,.10)", fg: "#7c3aed" };
  if (s.includes("not started")) return { bg: "rgba(148,163,184,.12)", fg: "#64748b" };
  return { bg: "rgba(245,158,11,.12)", fg: "#b7791f" };
}

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
  const [rawProjects, setProjects] = useState<ProjectRow[]>([]);
  // 2026-10-02 (Sandra): default = approved work only (projects past Draft);
  // Draft / Awaiting Baseline Approval only with "Include pending projects".
  const [includePending, setIncludePending] = useState<boolean>(() => {
    try {
      return localStorage.getItem("tempo.util.includePending") === "1";
    } catch {
      return false;
    }
  });
  function toggleIncludePending(v: boolean) {
    setIncludePending(v);
    try {
      localStorage.setItem("tempo.util.includePending", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
  const [projectTypes, setProjectTypes] = useState<{ id: string; name: string; sort_order: number | null }[]>([]);
  const [rawTasks, setTasks] = useState<TaskRow[]>([]);
  const projects = useMemo(() => (includePending ? rawProjects : rawProjects.filter((p) => !!p.wbs_status && p.wbs_status !== "draft")), [rawProjects, includePending]);
  const tasks = useMemo(() => {
    if (includePending) return rawTasks;
    const ok = new Set(projects.map((p) => p.id));
    return rawTasks.filter((t) => ok.has(t.project_id));
  }, [rawTasks, projects, includePending]);
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
  const [planningPreset, setPlanningPreset] = useState<"month" | "this_week" | "next_week" | "next_2_weeks" | "custom">("month");
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
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  // Role filter (2026-09-18, Sandra: "add option to filter by role") --
  // filters by the same job_title field shown under each name.
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  // Phase 1 utilization UX: make the display intent explicit instead of
  // treating hours as a secondary on/off decoration.
  const [displayMode, setDisplayMode] = useState<"both" | "utilization" | "hours">("both");
  // Capacity lens: keep the existing committed-utilization model intact, but
  // let managers flip the same grid to remaining bandwidth without changing
  // dates, filters, allocation rules, or the pending-project scope.
  const [capacityLens, setCapacityLens] = useState<"committed" | "bandwidth">("committed");
  const [taskSort, setTaskSort] = useState<"project" | "oldest" | "newest">("project");
  const [taskSearch, setTaskSearch] = useState("");
  const [detailTab, setDetailTab] = useState<"workload" | "timeline" | "pipeline">("workload");
  const [workloadScope, setWorkloadScope] = useState<"active" | "historical">("active");
  const [detailWeekIndex, setDetailWeekIndex] = useState(0);
  const [selectedCell, setSelectedCell] = useState<{ personId: string; dateStr: string } | null>(null);
  const [scenarioTaskId, setScenarioTaskId] = useState<string | null>(null);
  const [scenarioStart, setScenarioStart] = useState("");
  const [scenarioDue, setScenarioDue] = useState("");
  const [scenarioAssigneeId, setScenarioAssigneeId] = useState<string | null>(null);
  const [preserveScenarioDuration, setPreserveScenarioDuration] = useState(true);
  const [showOtherRoleCandidates, setShowOtherRoleCandidates] = useState(false);
  const [showScenarioDetails, setShowScenarioDetails] = useState(false);
  const [showAllRisks, setShowAllRisks] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedUtilView[]>([]);
  const [activeViewId, setActiveViewId] = useState("system:all");
  const [showSaveView, setShowSaveView] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");

  useEffect(() => {
    if (!scenarioTaskId) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [scenarioTaskId]);

  function savedViewsStorageKey() {
    return `tempo.utilization.savedViews.${me?.id ?? "anonymous"}`;
  }

  function persistSavedViews(next: SavedUtilView[]) {
    setSavedViews(next);
    if (me?.id) localStorage.setItem(savedViewsStorageKey(), JSON.stringify(next));
  }

  function applyViewConfig(view: SavedUtilView) {
    setPersonFilter(view.personIds ? new Set(view.personIds) : null);
    setRoleFilter(view.roleFilter);
    setProjectFilter(view.projectIds);
    setShowAllPeople(view.showAllPeople);
    setViewMode(view.viewMode);
    setDisplayMode(view.displayMode);
    if (view.planningPreset === "custom" && view.customStart && view.customEnd) {
      setRangeStart(parseLocalDate(view.customStart));
      setRangeEnd(parseLocalDate(view.customEnd));
      setPlanningPreset("custom");
    } else {
      applyPlanningPreset(view.planningPreset === "custom" ? "month" : view.planningPreset);
    }
  }

  function applyBuiltInView(id: string) {
    setActiveViewId(id);
    if (id === "system:me" && me?.id) {
      setPersonFilter(new Set([me.id]));
      setRoleFilter(null);
      setProjectFilter([]);
      setShowAllPeople(false);
      return;
    }
    if (id === "system:all") {
      setPersonFilter(null);
      setRoleFilter(null);
      setProjectFilter([]);
      setShowAllPeople(false);
    }
  }

  function saveCurrentView() {
    const name = saveViewName.trim();
    if (!name) return;
    const view: SavedUtilView = {
      id: `personal:${Date.now()}`,
      name,
      personIds: personFilter ? Array.from(personFilter) : null,
      roleFilter,
      projectIds: [...projectFilter],
      showAllPeople,
      planningPreset,
      customStart: planningPreset === "custom" ? toISO(rangeStart) : undefined,
      customEnd: planningPreset === "custom" ? toISO(rangeEnd) : undefined,
      viewMode,
      displayMode,
      isDefault: false,
    };
    persistSavedViews([...savedViews, view]);
    setActiveViewId(view.id);
    setSaveViewName("");
    setShowSaveView(false);
  }

  function setActiveViewAsDefault() {
    if (!activeViewId.startsWith("personal:")) return;
    persistSavedViews(savedViews.map((v) => ({ ...v, isDefault: v.id === activeViewId })));
  }

  function deleteActiveView() {
    if (!activeViewId.startsWith("personal:")) return;
    persistSavedViews(savedViews.filter((v) => v.id !== activeViewId));
    applyBuiltInView("system:all");
  }

  async function loadAll() {
    setLoading(true);
    const [{ data: p }, { data: ap }, { data: pr }, { data: pt }, { data: tk }, { data: av }, { data: hol }, { data: wts }, { data: ownHist }, { data: assHist }, { data: delHrs }, { data: settings }] = await Promise.all([
      supabase.from("people").select("id,name,daily_capacity_hours,is_active,job_title,tracks_time").eq("is_active", true).order("name"),
      supabase.from("people").select("id,name,daily_capacity_hours,is_active,job_title,tracks_time").order("name"),
      supabase.from("projects").select("id,name,owner_id,start_date,end_date,wbs_status,status,paused_at,resumed_at,project_type_id").eq("is_archived", false).eq("is_unsaved", false),
      supabase.from("project_types").select("id,name,sort_order").eq("is_active", true).order("sort_order"),
      supabase.from("tasks").select("id,project_id,parent_task_id,name,assignee_id,status,start_date,current_due_date,estimated_hours,is_archived,sort_order,work_type_id,created_at,created_by").eq("is_archived", false),
      supabase.from("person_availability").select("*"),
      supabase.from("holidays").select("*"),
      supabase.from("work_types").select("id,is_fixed_schedule"),
      supabase.from("project_owner_history").select("project_id,person_id,effective_from,effective_to"),
      supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to"),
      supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
      supabase.from("app_settings").select("historical_locking_enabled").eq("id", true).single(),
    ]);
    // Current production rule: people not expected to log time are outside
    // delivery capacity and therefore excluded from Utilization and scenario
    // assignee recommendations.
    const inCapacity = (x: PersonRow) => x.tracks_time !== false;
    setPeople(((p as PersonRow[]) ?? []).filter(inCapacity));
    setAllPeople(((ap as PersonRow[]) ?? []).filter(inCapacity));
    // New unsaved projects are intentionally hidden until their first Save.
    // Exclude both the temporary project rows and any draft tasks they contain
    // so abandoned work cannot affect capacity or scenario recommendations.
    const savedProjects = (pr as ProjectRow[]) ?? [];
    const savedProjectIds = new Set(savedProjects.map((x) => x.id));
    setProjects(savedProjects);
    setProjectTypes((pt as { id: string; name: string; sort_order: number | null }[]) ?? []);
    setTasks(((tk as TaskRow[]) ?? []).filter((t) => savedProjectIds.has(t.project_id)));
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

  useEffect(() => {
    if (!me?.id) return;
    try {
      const raw = localStorage.getItem(savedViewsStorageKey());
      const parsed = raw ? JSON.parse(raw) as SavedUtilView[] : [];
      setSavedViews(parsed);
      const defaultView = parsed.find((v) => v.isDefault);
      if (defaultView) {
        setActiveViewId(defaultView.id);
        applyViewConfig(defaultView);
      }
    } catch {
      setSavedViews([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

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
  function mondayOf(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    return addDays(d, dow === 0 ? -6 : 1 - dow);
  }
  function applyPlanningPreset(preset: "month" | "this_week" | "next_week" | "next_2_weeks") {
    const now = new Date();
    if (preset === "month") {
      setRangeStart(new Date(now.getFullYear(), now.getMonth(), 1));
      setRangeEnd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    } else {
      const thisMonday = mondayOf(now);
      const start = preset === "this_week" ? thisMonday : addDays(thisMonday, 7);
      const end = preset === "next_2_weeks" ? addDays(start, 13) : addDays(start, 6);
      setRangeStart(start);
      setRangeEnd(end);
    }
    setPlanningPreset(preset);
  }
  function shiftRange(direction: -1 | 1) {
    const spanDays = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    setRangeStart((s) => addDays(s, direction * spanDays));
    setRangeEnd((e) => addDays(e, direction * spanDays));
    setPlanningPreset("custom");
  }
  function resetToCurrentMonth() {
    applyPlanningPreset("month");
  }
  function setRangeStartFromInput(dateStr: string) {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split("-").map(Number);
    const chosen = new Date(y, (m ?? 1) - 1, d ?? 1);
    if (chosen <= rangeEnd) {
      setRangeStart(chosen);
      setPlanningPreset("custom");
    }
  }
  function setRangeEndFromInput(dateStr: string) {
    if (!dateStr) return;
    const [y, m, d] = dateStr.split("-").map(Number);
    const chosen = new Date(y, (m ?? 1) - 1, d ?? 1);
    if (chosen >= rangeStart) {
      setRangeEnd(chosen);
      setPlanningPreset("custom");
    }
  }
  const isAtEarliestAnchor = rangeStart <= EARLIEST_ANCHOR;

  // Daily view keeps the selected range exactly as chosen. Weekly planning,
  // Timeline and Pipeline use true ISO-style calendar weeks: Monday–Sunday.
  const dayChunks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) dayChunks.push(days.slice(i, i + 7));

  const weeks: Date[][] = [];
  const firstWeekStart = startOfWeek(rangeStart);
  const lastWeekStart = startOfWeek(rangeEnd);
  for (let ws = new Date(firstWeekStart); ws <= lastWeekStart; ws = addDays(ws, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(ws, i)));
  }

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
    remainingHours: number;
    remainingPct: number;
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
      remainingHours: availableHours - plannedHours,
      remainingPct: availableHours > 0 ? ((availableHours - plannedHours) / availableHours) * 100 : 0,
      peakPct,
      overloadedDays,
      workingDaysCount,
    };
  }
  function weekSum(week: Date[], getValue: (dateStr: string) => number): number {
    return week.reduce((sum, d) => sum + getValue(toISO(d)), 0);
  }

  const summaryDays = (() => {
    const forward = days.filter((d) => toISO(d) >= today);
    return forward.length > 0 ? forward : days;
  })();

  const teamPlanningSummary = (() => {
    let plannedHours = 0;
    let capacityHours = 0;
    let availableCapacityHours = 0;
    let overloadedMembers = 0;

    visiblePeople.forEach((person) => {
      let personOverloaded = false;
      summaryDays.forEach((d) => {
        const dateStr = toISO(d);
        const dow = d.getDay();
        if (dayBlocked(person.id, dateStr, dow)) return;
        const av = availabilityFor(person.id, dateStr);
        const capacity = dailyCapacityFor(person, av?.status === "half_day");
        const planned = valueForDate(person, dateStr);
        capacityHours += capacity;
        plannedHours += planned;
        availableCapacityHours += Math.max(0, capacity - planned);
        if (capacity > 0 && planned / capacity > 1) personOverloaded = true;
      });
      if (personOverloaded) overloadedMembers++;
    });

    return {
      plannedHours,
      capacityHours,
      utilizationPct: capacityHours > 0 ? (plannedHours / capacityHours) * 100 : 0,
      availableCapacityHours,
      netBandwidthHours: capacityHours - plannedHours,
      bandwidthPct: capacityHours > 0 ? ((capacityHours - plannedHours) / capacityHours) * 100 : 0,
      overloadedMembers,
    };
  })();

  const teamProjectTypeMix = projectTypes.map((type) => {
    let hours = 0;
    visiblePeople.forEach((person) => {
      openTasksFor(person.id).forEach((task) => {
        const project = projects.find((p) => p.id === task.project_id);
        if (project?.project_type_id !== type.id) return;
        hours += summaryDays.reduce((sum, d) => sum + taskValueForDate(person, task, toISO(d)), 0);
      });
      ownedProjectsFor(person.id).forEach((project) => {
        if (project.project_type_id !== type.id) return;
        hours += summaryDays.reduce((sum, d) => sum + pmValueForDate(person, project.id, toISO(d)), 0);
      });
    });
    return { ...type, hours };
  }).filter((x) => x.hours > 0);
  const teamProjectTypeTotal = teamProjectTypeMix.reduce((sum, x) => sum + x.hours, 0);

  const capacityRisks = visiblePeople.flatMap((person) =>
    summaryDays.flatMap((d) => {
      const dateStr = toISO(d);
      const dow = d.getDay();
      if (dayBlocked(person.id, dateStr, dow)) return [];
      const av = availabilityFor(person.id, dateStr);
      const capacity = dailyCapacityFor(person, av?.status === "half_day");
      const allocated = valueForDate(person, dateStr);
      if (capacity <= 0 || allocated <= capacity) return [];
      const taskHours = openTasksFor(person.id).reduce((sum, task) => sum + taskValueForDate(person, task, dateStr), 0);
      const pmHours = ownedProjectsFor(person.id).reduce((sum, project) => sum + pmValueForDate(person, project.id, dateStr), 0);
      return [{
        person,
        dateStr,
        capacity,
        allocated,
        overHours: allocated - capacity,
        pct: (allocated / capacity) * 100,
        taskHours,
        pmHours,
      }];
    })
  ).sort((a, b) => b.overHours - a.overHours || b.pct - a.pct);

  const topCapacityRisks = capacityRisks.slice(0, 5);
  const displayedCapacityRisks = showAllRisks ? topCapacityRisks : topCapacityRisks.slice(0, 3);

  const columnCount = viewMode === "daily" ? days.length : weeks.length;

  const detailPerson = detailPersonId ? allPeople.find((p) => p.id === detailPersonId) ?? people.find((p) => p.id === detailPersonId) : null;
  const detailTasks = detailPerson ? orderedTasksFor(detailPerson.id) : [];
  const detailActiveTasks = detailTasks.filter((t) => isOpenTask(t));
  const detailHistoricalTasks = detailTasks.filter((t) => !isOpenTask(t));
  const detailWorkloadTasks = workloadScope === "active" ? detailActiveTasks : detailHistoricalTasks;
  const detailOwnedProjects = detailPerson ? ownedProjectsFor(detailPerson.id) : [];
  const detailWeekStats = detailPerson ? weeks.map((week) => ({ week, stats: weekStatsForPerson(detailPerson, week) })) : [];
  const safeDetailWeekIndex = Math.min(detailWeekIndex, Math.max(detailWeekStats.length - 1, 0));
  const detailWeek = detailWeekStats[safeDetailWeekIndex]?.week ?? [];
  const detailSelectedWeekStats = detailWeekStats[safeDetailWeekIndex]?.stats ?? null;
  const detailProjectIds = detailPerson ? Array.from(new Set(detailWorkloadTasks.map((t) => t.project_id))) : [];

  const detailPeriodKind: "historical" | "current" | "forecast" = (() => {
    if (!detailWeek.length) return "forecast";
    const start = toISO(detailWeek[0]);
    const end = toISO(detailWeek[detailWeek.length - 1]);
    if (end < today) return "historical";
    if (start > today) return "forecast";
    return "current";
  })();

  const selectedWeekTaskHours = detailPerson
    ? detailTasks.reduce((sum, task) => sum + weekSum(detailWeek, (dateStr) => taskValueForDate(detailPerson, task, dateStr)), 0)
    : 0;
  const selectedWeekPmHours = detailPerson
    ? detailOwnedProjects.reduce((sum, project) => sum + weekSum(detailWeek, (dateStr) => pmValueForDate(detailPerson, project.id, dateStr)), 0)
    : 0;

  const projectTypeMix = projectTypes.map((type) => {
    let taskHours = 0;
    let pmHours = 0;
    if (detailPerson) {
      detailTasks.forEach((task) => {
        const project = projects.find((p) => p.id === task.project_id);
        if (project?.project_type_id !== type.id) return;
        taskHours += weekSum(detailWeek, (dateStr) => taskValueForDate(detailPerson, task, dateStr));
      });
      detailOwnedProjects.forEach((project) => {
        if (project.project_type_id !== type.id) return;
        pmHours += weekSum(detailWeek, (dateStr) => pmValueForDate(detailPerson, project.id, dateStr));
      });
    }
    return { ...type, taskHours, pmHours, totalHours: taskHours + pmHours };
  }).filter((x) => x.totalHours > 0);
  const projectTypeMixTotal = projectTypeMix.reduce((sum, x) => sum + x.totalHours, 0);
  const selectedPeriodEffortTotal = selectedWeekTaskHours + selectedWeekPmHours;

  const detailDayStats = detailPerson
    ? detailWeek.map((d) => {
        const dateStr = toISO(d);
        const dow = d.getDay();
        const blocked = dayBlocked(detailPerson.id, dateStr, dow);
        const av = availabilityFor(detailPerson.id, dateStr);
        const workingCapacity = dailyCapacityFor(detailPerson, av?.status === "half_day");
        const capacity = blocked ? 0 : workingCapacity;
        const allocated = valueForDate(detailPerson, dateStr);
        const pct = capacity > 0 ? (allocated / capacity) * 100 : allocated > 0 ? 999 : 0;
        return { dateStr, allocated, capacity, pct, tier: tierOf(pct), availability: av, blocked };
      })
    : [];

  const pipelineRows = (() => {
    if (!detailPerson || !detailSelectedWeekStats) return [] as Array<{ task: TaskRow; entry: WorkloadEntry; weekHours: number; cumulativeHours: number; cumulativePct: number }>;
    let cumulativeHours = 0;
    return [...detailTasks]
      .map((task) => ({
        task,
        entry: workloadEntryFor(task, detailPerson.id),
        weekHours: weekSum(detailWeek, (dateStr) => taskValueForDate(detailPerson, task, dateStr)),
      }))
      .filter((row) => row.weekHours > 0)
      .sort((a, b) => {
        const ae = a.entry.date ?? "9999-12-31";
        const be = b.entry.date ?? "9999-12-31";
        return ae.localeCompare(be) || a.task.name.localeCompare(b.task.name);
      })
      .map((row) => {
        cumulativeHours += row.weekHours;
        return {
          ...row,
          cumulativeHours,
          cumulativePct: detailSelectedWeekStats.availableHours > 0 ? (cumulativeHours / detailSelectedWeekStats.availableHours) * 100 : 0,
        };
      });
  })();

  const scenarioTask = scenarioTaskId ? tasks.find((t) => t.id === scenarioTaskId) ?? null : null;
  const scenarioPerson = scenarioTask?.assignee_id ? allPeople.find((p) => p.id === scenarioTask.assignee_id) ?? people.find((p) => p.id === scenarioTask.assignee_id) ?? null : null;
  const scenarioTargetPerson = scenarioAssigneeId ? allPeople.find((p) => p.id === scenarioAssigneeId) ?? people.find((p) => p.id === scenarioAssigneeId) ?? null : scenarioPerson;
  const scenarioProject = scenarioTask ? projects.find((p) => p.id === scenarioTask.project_id) ?? null : null;
  const scenarioPreferredRole = scenarioPerson?.job_title ?? null;

  function scenarioWorkingDaysBetween(person: PersonRow, startStr: string, dueStr: string): string[] {
    const result: string[] = [];
    for (let d = parseLocalDate(startStr); d <= parseLocalDate(dueStr); d = addDays(d, 1)) {
      const dateStr = toISO(d);
      if (!dayBlocked(person.id, dateStr, d.getDay())) result.push(dateStr);
    }
    return result;
  }

  const scenarioPlottedDuration = scenarioTask && scenarioPerson
    ? Math.max(1, scenarioWorkingDaysBetween(
        scenarioPerson,
        scenarioTask.start_date ?? scenarioTask.current_due_date,
        scenarioTask.current_due_date
      ).length)
    : 1;

  function scenarioDueFromStart(startStr: string, person: PersonRow, workingDays: number): string {
    let count = 0;
    let d = parseLocalDate(startStr);
    for (let safety = 0; safety < 120; safety++) {
      const dateStr = toISO(d);
      if (!dayBlocked(person.id, dateStr, d.getDay())) {
        count++;
        if (count >= Math.max(1, workingDays)) return dateStr;
      }
      d = addDays(d, 1);
    }
    return startStr;
  }

  function scenarioWindowForPerson(person: PersonRow, startStr: string) {
    if (!scenarioTask) return null;
    const dueStr = scenarioDueFromStart(startStr, person, scenarioPlottedDuration);
    const workDays = scenarioWorkingDaysBetween(person, startStr, dueStr);
    if (!workDays.length) return null;
    const scopedHours = Number(scenarioTask.estimated_hours ?? 0);
    // Keep scenario recommendations aligned with current WBS Forecasted:
    // don't START a task in a tiny capacity sliver (<1h free), unless the
    // task itself is smaller than 1h. Other work stays where it is currently
    // plotted; only this selected task is removed/relaid for the preview.
    const startDateStr = workDays[0];
    const startAv = availabilityFor(person.id, startDateStr);
    const startCapacity = dailyCapacityFor(person, startAv?.status === "half_day");
    const startCurrent = engine.totalFor(person.id, startDateStr);
    const startExistingTaskHours = engine.taskHoursOnDate(person.id, scenarioTask as UtilTaskRow, startDateStr);
    const startBaseWithoutTask = Math.max(0, startCurrent - startExistingTaskHours);
    const startFreeHours = Math.max(0, startCapacity - startBaseWithoutTask);
    const minStartFreeHours = Math.min(1, scopedHours);
    if (minStartFreeHours > 0 && startFreeHours + 1e-9 < minStartFreeHours) return null;

    const addedPerDay = workDays.length > 0 ? scopedHours / workDays.length : 0;
    let peakPct = 0;
    let overloadedDays = 0;
    let totalFreeBefore = 0;
    const rows = workDays.map((dateStr) => {
      const av = availabilityFor(person.id, dateStr);
      const capacity = dailyCapacityFor(person, av?.status === "half_day");
      const current = engine.totalFor(person.id, dateStr);
      const existingTaskHours = engine.taskHoursOnDate(person.id, scenarioTask as UtilTaskRow, dateStr);
      const baseWithoutTask = Math.max(0, current - existingTaskHours);
      const projected = baseWithoutTask + addedPerDay;
      const pct = capacity > 0 ? (projected / capacity) * 100 : projected > 0 ? 999 : 0;
      peakPct = Math.max(peakPct, pct);
      if (pct > 100) overloadedDays++;
      totalFreeBefore += Math.max(0, capacity - baseWithoutTask);
      return { dateStr, capacity, current: baseWithoutTask, projected, pct };
    });
    return { startStr, dueStr, peakPct, overloadedDays, totalFreeBefore, rows };
  }

  const scenarioForecast = scenarioTargetPerson
    ? Array.from({ length: 14 }, (_, i) => addDays(parseLocalDate(today), i)).map((d) => {
        const dateStr = toISO(d);
        const blocked = dayBlocked(scenarioTargetPerson.id, dateStr, d.getDay());
        const av = availabilityFor(scenarioTargetPerson.id, dateStr);
        const capacity = blocked ? 0 : dailyCapacityFor(scenarioTargetPerson, av?.status === "half_day");
        const allocated = engine.totalFor(scenarioTargetPerson.id, dateStr);
        const pct = capacity > 0 ? (allocated / capacity) * 100 : allocated > 0 ? 999 : 0;
        return { dateStr, blocked, capacity, allocated, pct, free: Math.max(0, capacity - allocated) };
      })
    : [];

  function bestScenarioWindowsFor(person: PersonRow) {
    const windows = Array.from({ length: 14 }, (_, i) => addDays(parseLocalDate(today), i))
      .filter((d) => !dayBlocked(person.id, toISO(d), d.getDay()))
      .map((d) => scenarioWindowForPerson(person, toISO(d)))
      .filter((w): w is NonNullable<typeof w> => !!w);
    return windows.sort((a, b) =>
      a.overloadedDays - b.overloadedDays ||
      a.peakPct - b.peakPct ||
      a.startStr.localeCompare(b.startStr)
    ).slice(0, 3);
  }

  const selectedScenarioWindows = scenarioTargetPerson ? bestScenarioWindowsFor(scenarioTargetPerson) : [];
  const sameRoleScenarioCandidates = scenarioPerson
    ? people
        .filter((p) => p.job_title === scenarioPreferredRole)
        .map((person) => ({ person, best: bestScenarioWindowsFor(person)[0] ?? null }))
        .sort((a, b) => {
          if (!a.best && !b.best) return a.person.name.localeCompare(b.person.name);
          if (!a.best) return 1;
          if (!b.best) return -1;
          return a.best.overloadedDays - b.best.overloadedDays || a.best.peakPct - b.best.peakPct || a.person.name.localeCompare(b.person.name);
        })
    : [];
  const otherRoleScenarioCandidates = scenarioPerson
    ? people
        .filter((p) => p.job_title !== scenarioPreferredRole)
        .map((person) => ({ person, best: bestScenarioWindowsFor(person)[0] ?? null }))
        .sort((a, b) => {
          if (!a.best && !b.best) return a.person.name.localeCompare(b.person.name);
          if (!a.best) return 1;
          if (!b.best) return -1;
          return a.best.overloadedDays - b.best.overloadedDays || a.best.peakPct - b.best.peakPct || a.person.name.localeCompare(b.person.name);
        })
    : [];

  const scenarioAssigneeHistory = useMemo(() => {
    if (!scenarioTask || !scenarioAssigneeId || assigneeHistory.length === 0) return assigneeHistory;
    const yesterday = toISO(addDays(parseLocalDate(today), -1));
    const preserved = assigneeHistory.flatMap((h) => {
      if (h.task_id !== scenarioTask.id) return [h];
      if (h.effective_to && h.effective_to < today) return [h];
      if (h.effective_from >= today) return [];
      return [{ ...h, effective_to: yesterday }];
    });
    preserved.push({
      task_id: scenarioTask.id,
      person_id: scenarioAssigneeId,
      effective_from: today,
      effective_to: null,
    });
    return preserved;
  }, [scenarioTask, scenarioAssigneeId, assigneeHistory, today]);

  const scenarioEngine = useMemo(() => {
    if (!scenarioTask || !scenarioStart || !scenarioDue) return null;
    const proposedAssignee = scenarioAssigneeId ?? scenarioTask.assignee_id;
    const patchedTasks = engineTasks.map((t) => t.id === scenarioTask.id
      ? { ...t, start_date: scenarioStart, current_due_date: scenarioDue, assignee_id: proposedAssignee }
      : t
    );
    return createAllocationEngine({
      tasks: patchedTasks as UtilTaskRow[],
      projects: engineProjects,
      holidays: holidaySet,
      availability,
      assigneeHistory: scenarioAssigneeHistory,
      ownerHistory,
      todayStr: today,
      deletedHours: projectFilterSet ? [] : deletedHours,
    });
  }, [scenarioTask, scenarioStart, scenarioDue, scenarioAssigneeId, engineTasks, engineProjects, holidaySet, availability, scenarioAssigneeHistory, ownerHistory, today, projectFilterSet, deletedHours]);

  const scenarioImpact = (() => {
    if (!scenarioTask || !scenarioPerson || !scenarioTargetPerson || !scenarioEngine || !scenarioStart || !scenarioDue) return null;
    const oldDue = scenarioTask.current_due_date;
    const latest = [oldDue, scenarioDue, today].sort().slice(-1)[0];
    const impactDays: Date[] = [];
    for (let d = parseLocalDate(today); d <= parseLocalDate(latest); d = addDays(d, 1)) impactDays.push(new Date(d));

    const affectedPeople = scenarioPerson.id === scenarioTargetPerson.id
      ? [scenarioPerson]
      : [scenarioPerson, scenarioTargetPerson];

    const peopleImpact = affectedPeople.map((person) => {
      const workingRows = impactDays.map((d) => {
        const dateStr = toISO(d);
        const dow = d.getDay();
        if (dayBlocked(person.id, dateStr, dow)) return null;
        const av = availabilityFor(person.id, dateStr);
        const capacity = dailyCapacityFor(person, av?.status === "half_day");
        const current = engine.totalFor(person.id, dateStr);
        const proposed = scenarioEngine.totalFor(person.id, dateStr);
        return {
          person,
          dateStr,
          capacity,
          current,
          proposed,
          currentPct: capacity > 0 ? (current / capacity) * 100 : current > 0 ? 999 : 0,
          proposedPct: capacity > 0 ? (proposed / capacity) * 100 : proposed > 0 ? 999 : 0,
          delta: proposed - current,
        };
      }).filter((r): r is NonNullable<typeof r> => !!r);

      return {
        person,
        currentPeak: workingRows.reduce((m, r) => Math.max(m, r.currentPct), 0),
        proposedPeak: workingRows.reduce((m, r) => Math.max(m, r.proposedPct), 0),
        currentOverDays: workingRows.filter((r) => r.currentPct > 100).length,
        proposedOverDays: workingRows.filter((r) => r.proposedPct > 100).length,
        netHours: workingRows.reduce((sum, r) => sum + r.delta, 0),
        rows: workingRows.filter((r) => Math.abs(r.delta) > 0.001),
      };
    });

    const rows = peopleImpact.flatMap((p) => p.rows).sort((a, b) => a.dateStr.localeCompare(b.dateStr) || a.person.name.localeCompare(b.person.name));
    return {
      people: peopleImpact,
      rows,
      currentPeak: peopleImpact.reduce((m, p) => Math.max(m, p.currentPeak), 0),
      proposedPeak: peopleImpact.reduce((m, p) => Math.max(m, p.proposedPeak), 0),
      currentOverDays: peopleImpact.reduce((sum, p) => sum + p.currentOverDays, 0),
      proposedOverDays: peopleImpact.reduce((sum, p) => sum + p.proposedOverDays, 0),
      isReassignment: scenarioPerson.id !== scenarioTargetPerson.id,
    };
  })();

  const selectedPerson = selectedCell ? allPeople.find((p) => p.id === selectedCell.personId) ?? people.find((p) => p.id === selectedCell.personId) : null;
  const selectedAvailability = selectedCell && selectedPerson ? availabilityFor(selectedPerson.id, selectedCell.dateStr) : undefined;
  const selectedCapacity = selectedCell && selectedPerson ? dailyCapacityFor(selectedPerson, selectedAvailability?.status === "half_day") : 0;
  const selectedAllocated = selectedCell && selectedPerson ? valueForDate(selectedPerson, selectedCell.dateStr) : 0;
  const selectedPct = selectedCapacity > 0 ? (selectedAllocated / selectedCapacity) * 100 : selectedAllocated > 0 ? 999 : 0;
  const selectedContributions = selectedCell && selectedPerson
    ? [
        ...orderedTasksFor(selectedPerson.id)
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
      ].sort((a, b) => (a.entry.date ?? "9999-12-31").localeCompare(b.entry.date ?? "9999-12-31") || b.hours - a.hours)
    : [];

  let selectedCumulativeHours = 0;
  const selectedContributionRows = selectedContributions.map((row) => {
    const before = selectedCumulativeHours;
    selectedCumulativeHours += row.hours;
    return {
      ...row,
      cumulativeHours: selectedCumulativeHours,
      isOverageDriver: selectedCapacity > 0 && before <= selectedCapacity && selectedCumulativeHours > selectedCapacity,
    };
  });

  return (
    <div>
      <div style={{ marginBottom: 12, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 280, flex: "1 1 520px" }}>
          <h1 style={{ marginBottom: 4 }}>Utilization</h1>
          <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
            View scoped task effort across your team to plan capacity and identify potential overloads. Utilization is based on planned/scoped hours and does not reflect actual time worked.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", paddingTop: 2 }}>
          <span style={{ fontSize: 9.5, fontWeight: 600, color: "var(--muted)", letterSpacing: ".03em" }}>VIEW</span>
          <select
            value={activeViewId}
            onChange={(e) => {
              const id = e.target.value;
              if (id.startsWith("personal:")) {
                const view = savedViews.find((v) => v.id === id);
                if (view) {
                  setActiveViewId(id);
                  applyViewConfig(view);
                }
              } else {
                applyBuiltInView(id);
              }
            }}
            style={{ minWidth: 170, height: 32, fontSize: 11, fontWeight: 500, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px", background: "var(--surface)" }}
          >
            <optgroup label="Built-in views">
              <option value="system:me">My View</option>
              <option value="system:all">All Team</option>
            </optgroup>
            {savedViews.length > 0 && (
              <optgroup label="My saved views">
                {savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}{view.isDefault ? " · Default" : ""}</option>)}
              </optgroup>
            )}
          </select>

          {activeViewId.startsWith("personal:") && !savedViews.find((view) => view.id === activeViewId)?.isDefault && (
            <button onClick={setActiveViewAsDefault} style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--accent)", fontSize: 10, fontWeight: 600, height: 32, padding: "0 9px", cursor: "pointer" }}>Set as default</button>
          )}
          {activeViewId.startsWith("personal:") && (
            <button onClick={deleteActiveView} style={{ border: "none", background: "transparent", color: "var(--danger)", fontSize: 10, fontWeight: 600, cursor: "pointer", padding: "0 4px" }}>Delete</button>
          )}

          {showSaveView ? (
            <>
              <input
                autoFocus
                value={saveViewName}
                onChange={(e) => setSaveViewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveCurrentView(); if (e.key === "Escape") setShowSaveView(false); }}
                placeholder="View name"
                style={{ width: 150, height: 32, fontSize: 11, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px" }}
              />
              <button onClick={saveCurrentView} disabled={!saveViewName.trim()} style={{ border: "none", borderRadius: 8, background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 600, height: 32, padding: "0 10px", cursor: saveViewName.trim() ? "pointer" : "default", opacity: saveViewName.trim() ? 1 : .5 }}>Save</button>
              <button onClick={() => { setShowSaveView(false); setSaveViewName(""); }} style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 10, cursor: "pointer" }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setShowSaveView(true)} style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 10.5, fontWeight: 600, cursor: "pointer", padding: "0 4px" }}>Save view</button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", letterSpacing: ".03em" }}>PLANNING PERIOD</span>
            <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--hover-bg)", borderRadius: 999 }}>
              {([
                ["this_week", "This week"],
                ["next_week", "Next week"],
                ["next_2_weeks", "Next 2 weeks"],
                ["month", "This month"],
                ["custom", "Custom"],
              ] as const).map(([preset, label]) => (
                <button
                  key={preset}
                  onClick={() => {
                    if (preset === "custom") setPlanningPreset("custom");
                    else applyPlanningPreset(preset);
                  }}
                  style={{
                    border: "none",
                    borderRadius: 999,
                    padding: "6px 10px",
                    background: planningPreset === preset ? "var(--surface)" : "transparent",
                    boxShadow: planningPreset === preset ? "0 2px 7px rgba(15,35,65,.09)" : "none",
                    color: planningPreset === preset ? "var(--accent)" : "var(--muted)",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)" }} />
            <button onClick={() => shiftRange(-1)} className="planner-nav-btn" disabled={isAtEarliestAnchor} title={isAtEarliestAnchor ? "Can't go earlier than Jan 2026" : "Previous"} style={isAtEarliestAnchor ? { opacity: 0.4, cursor: "default" } : undefined}>
              <ChevronLeft size={14} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", minWidth: 165 }}>
              {days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} –{" "}
              {days[days.length - 1].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <button onClick={() => shiftRange(1)} className="planner-nav-btn" title="Next"><ChevronRight size={14} /></button>
            {planningPreset === "custom" && (
              <>
                <div style={{ width: 1, height: 18, background: "var(--border)" }} />
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                  From
                  <input type="date" min="2026-01-01" value={toISO(rangeStart)} onChange={(e) => setRangeStartFromInput(e.target.value)} style={{ fontSize: 11, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 7px" }} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
                  To
                  <input type="date" min="2026-01-01" value={toISO(rangeEnd)} onChange={(e) => setRangeEndFromInput(e.target.value)} style={{ fontSize: 11, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 7px" }} />
                </label>
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", width: "100%" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 9.5, fontWeight: 600, color: "var(--muted)" }}>
              Capacity View
              <select value={capacityLens} onChange={(e) => setCapacityLens(e.target.value as "committed" | "bandwidth")} style={{ minWidth: 152, height: 32, fontSize: 11, fontWeight: 500, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px", background: "var(--surface)" }}>
                <option value="committed">Committed</option>
                <option value="bandwidth">Available Bandwidth</option>
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 9.5, fontWeight: 600, color: "var(--muted)" }}>
              Time View
              <select value={viewMode} onChange={(e) => setViewMode(e.target.value as "daily" | "weekly")} style={{ minWidth: 104, height: 32, fontSize: 11, fontWeight: 500, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px", background: "var(--surface)" }}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 9.5, fontWeight: 600, color: "var(--muted)" }}>
              Display
              <select value={displayMode} onChange={(e) => setDisplayMode(e.target.value as "both" | "utilization" | "hours")} style={{ minWidth: 170, height: 32, fontSize: 11, fontWeight: 500, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: 8, padding: "0 8px", background: "var(--surface)" }}>
                <option value="both">Both (Utilization & Hours)</option>
                <option value="utilization">Utilization only</option>
                <option value="hours">Hours only</option>
              </select>
            </label>

            <div style={{ width: 1, height: 34, background: "var(--border)", margin: "0 2px" }} />

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 9.5, fontWeight: 600, color: "var(--muted)" }}>Team Members</span>
              <UtilPersonFilterButton people={scopedPeople} selected={personFilter} open={personFilterOpen} setOpen={setPersonFilterOpen} search={personFilterSearch} setSearch={setPersonFilterSearch} onChange={setPersonFilter} allLabel="All active team members" />
            </div>

            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 9.5, fontWeight: 600, color: "var(--muted)" }}>Advanced Filters</span>
              <button
                onClick={() => setAdvancedFiltersOpen((v) => !v)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)", color: "var(--navy)", fontSize: 11, fontWeight: 500, padding: "0 8px", cursor: "pointer" }}
              >
                Advanced Filters
                {(projectFilter.length > 0 || includePending || showAllPeople) && (
                  <span style={{ minWidth: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--accent)", color: "#fff", fontSize: 9, fontWeight: 700 }}>
                    {(projectFilter.length > 0 ? 1 : 0) + (includePending ? 1 : 0) + (showAllPeople ? 1 : 0)}
                  </span>
                )}
              </button>

              {advancedFiltersOpen && (
                <div className="card" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, width: 310, padding: 12, boxShadow: "0 8px 24px rgba(15,35,65,.14)" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)", marginBottom: 10 }}>Advanced Filters</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--muted)", marginBottom: 5 }}>Projects</div>
                      <MultiSelectFilter options={projects.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name))} selected={projectFilter} onChange={setProjectFilter} noun="projects" singular="Project" />
                    </div>
                    <label title="Draft and Awaiting Baseline Approval projects are excluded by default" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--navy)", cursor: "pointer" }}>
                      <input type="checkbox" checked={includePending} onChange={(e) => toggleIncludePending(e.target.checked)} />
                      Include pending projects
                    </label>
                    <label title="Inactive team members are hidden by default but retained for historical analysis" style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--navy)", cursor: "pointer" }}>
                      <input type="checkbox" checked={showAllPeople} onChange={(e) => setShowAllPeople(e.target.checked)} />
                      Show inactive team members
                    </label>
                  </div>
                </div>
              )}
            </div>

            {roleFilter && (
              <button
                onClick={() => setRoleFilter(null)}
                title="This saved view filters by role. Click to clear."
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--navy)", fontSize: 10.5, fontWeight: 600, cursor: "pointer", padding: "4px 9px", borderRadius: 999 }}
              >
                Role: {roleFilter} ×
              </button>
            )}
            {(personFilter !== null || projectFilter.length > 0 || includePending || showAllPeople || roleFilter !== null) && (
              <button
                onClick={() => {
                  setPersonFilter(null);
                  setProjectFilter([]);
                  toggleIncludePending(false);
                  setShowAllPeople(false);
                  setRoleFilter(null);
                }}
                title="Reset team member and advanced filters only"
                style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--accent)", fontSize: 10.5, fontWeight: 600, cursor: "pointer", padding: "7px 4px" }}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 10 }}>
        <div className="card" style={{ padding: "12px 14px", borderRadius: 16, background: "var(--surface)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", color: "var(--muted)", marginBottom: 5 }}>{capacityLens === "committed" ? "TEAM UTILIZATION" : "TEAM BANDWIDTH"}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            {capacityLens === "committed" ? (
              <>
                <span style={{ fontSize: 23, fontWeight: 600, color: tierOf(teamPlanningSummary.utilizationPct).fg }}>{displayPct(teamPlanningSummary.utilizationPct)}%</span>
                <span style={{ fontSize: 9.5, color: "var(--muted)" }}>{teamPlanningSummary.plannedHours.toFixed(1)}h / {teamPlanningSummary.capacityHours.toFixed(1)}h</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 23, fontWeight: 600, color: teamPlanningSummary.netBandwidthHours < 0 ? "var(--danger)" : "#059669" }}>{teamPlanningSummary.netBandwidthHours.toFixed(1)}h</span>
                <span style={{ fontSize: 9.5, color: teamPlanningSummary.bandwidthPct < 0 ? "var(--danger)" : "var(--muted)" }}>{teamPlanningSummary.bandwidthPct < 0 ? `${displayPct(Math.abs(teamPlanningSummary.bandwidthPct))}% over capacity` : `${displayPct(teamPlanningSummary.bandwidthPct)}% available`}</span>
              </>
            )}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 4 }}>{summaryDays.length ? `${summaryDays[0].toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${summaryDays[summaryDays.length-1].toLocaleDateString("en-US",{month:"short",day:"numeric"})}` : "Selected period"}</div>
        </div>

        <div className="card" style={{ padding: "12px 14px", borderRadius: 16, background: "var(--surface)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", color: "var(--muted)", marginBottom: 5 }}>{capacityLens === "committed" ? "AVAILABLE CAPACITY" : "COMMITTED HOURS"}</div>
          <div style={{ fontSize: 23, fontWeight: 600, color: capacityLens === "committed" ? "#059669" : "var(--navy)" }}>{capacityLens === "committed" ? `${teamPlanningSummary.availableCapacityHours.toFixed(1)}h` : `${teamPlanningSummary.plannedHours.toFixed(1)}h`}</div>
          <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 4 }}>{capacityLens === "committed" ? "Remaining positive capacity in the planning period" : `of ${teamPlanningSummary.capacityHours.toFixed(1)}h total capacity`}</div>
        </div>

        <div className="card" style={{ padding: "12px 14px", borderRadius: 16, background: "var(--surface)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", color: "var(--muted)", marginBottom: 5 }}>OVERALLOCATED MEMBERS</div>
          <div style={{ fontSize: 23, fontWeight: 600, color: teamPlanningSummary.overloadedMembers > 0 ? "var(--danger)" : "#059669" }}>{teamPlanningSummary.overloadedMembers}</div>
          <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 4 }}>Members with at least one day above 100%</div>
        </div>

        <div className="card" style={{ padding: "10px 12px", borderRadius: 16, background: "var(--hover-bg)", borderColor: "transparent" }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".04em", color: "var(--muted)", marginBottom: 6 }}>PROJECT TYPE MIX</div>
          {teamProjectTypeMix.length === 0 ? (
            <div style={{ fontSize: 10, color: "var(--muted)" }}>No typed project effort in this period.</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                title={teamProjectTypeMix.map((mix) => `${mix.name} ${mix.hours.toFixed(1)}h`).join(" · ")}
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: (() => {
                    let acc = 0;
                    const parts = teamProjectTypeMix.map((mix, mi) => {
                      const tone = PROJECT_TYPE_TONES[mi % PROJECT_TYPE_TONES.length];
                      const start = acc;
                      acc += teamProjectTypeTotal > 0 ? (mix.hours / teamProjectTypeTotal) * 100 : 0;
                      return `${tone.dot} ${start}% ${acc}%`;
                    });
                    return `conic-gradient(${parts.join(", ")})`;
                  })(),
                  position: "relative",
                }}
              >
                <div style={{ position: "absolute", inset: 8, borderRadius: "50%", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 600, color: "var(--navy)" }}>
                  {teamProjectTypeTotal.toFixed(1)}h
                </div>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                {teamProjectTypeMix.map((mix, mi) => {
                  const tone = PROJECT_TYPE_TONES[mi % PROJECT_TYPE_TONES.length];
                  const share = teamProjectTypeTotal > 0 ? Math.round((mix.hours / teamProjectTypeTotal) * 100) : 0;
                  return (
                    <div key={mix.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: mi === teamProjectTypeMix.length - 1 ? 0 : 5 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 10.5, fontWeight: 600, color: "var(--navy)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone.dot, flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mix.name}</span>
                      </span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: tone.fg, whiteSpace: "nowrap" }}>{share}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: "8px 10px", marginBottom: 8, borderRadius: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <AlertTriangle size={13} style={{ color: topCapacityRisks.length ? "var(--danger)" : "#059669" }} />
            <span style={{ fontSize: 10.8, fontWeight: 600, color: "var(--navy)" }}>Needs Attention</span>
            <span style={{ fontSize: 9.5, fontWeight: 600, color: topCapacityRisks.length ? "var(--danger)" : "#059669", padding: "3px 7px", borderRadius: 999, background: topCapacityRisks.length ? "rgba(239,68,68,.07)" : "rgba(16,185,129,.08)" }}>
              {capacityRisks.length} risk{capacityRisks.length === 1 ? "" : "s"}
            </span>
          </div>

          <div style={{ width: 1, height: 18, background: "var(--border)" }} />

          {topCapacityRisks.length === 0 ? (
            <span style={{ fontSize: 10.5, color: "#059669", fontWeight: 500 }}>No daily capacity risks in this planning period.</span>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0, flex: 1 }}>
              {displayedCapacityRisks.map((risk) => (
                <button
                  key={`${risk.person.id}-${risk.dateStr}`}
                  onClick={() => {
                    setDetailPersonId(null);
                    setSelectedCell({ personId: risk.person.id, dateStr: risk.dateStr });
                  }}
                  title={`${risk.person.name} · ${parseLocalDate(risk.dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${displayPct(risk.pct)}% · +${risk.overHours.toFixed(1)}h`}
                  style={{ border: "1px solid rgba(239,68,68,.18)", borderRadius: 999, background: "rgba(239,68,68,.04)", color: "var(--navy)", padding: "4px 8px", fontSize: 9.8, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  <strong style={{ fontWeight: 600 }}>{risk.person.name}</strong>
                  <span style={{ color: "var(--danger)", marginLeft: 5 }}>{displayPct(risk.pct)}%</span>
                </button>
              ))}
            </div>
          )}

          {topCapacityRisks.length > 3 && (
            <button onClick={() => setShowAllRisks((v) => !v)} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--accent)", fontSize: 9.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              {showAllRisks ? "Show less" : "View all"}
            </button>
          )}
        </div>
      </div>

      <div ref={utilScrollRef} className="card" style={{ padding: 0, overflowX: "auto", overflowY: "visible" }}>
        <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--surface)" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>{capacityLens === "committed" ? "UTILIZATION" : "AVAILABLE BANDWIDTH"}</span>
          <details style={{ position: "relative" }}>
            <summary style={{ listStyle: "none", cursor: "pointer", fontSize: 9.5, fontWeight: 600, color: "var(--accent)" }}>Legend</summary>
            <div className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 40, width: 330, padding: 10, boxShadow: "0 8px 24px rgba(15,35,65,.14)" }}>
              {capacityLens === "committed" ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {UTIL_LEGEND.map(({ pct, label, tone }) => {
                    const Icon = LEGEND_ICON_BY_LABEL[label] ?? Minus;
                    return (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 9.5 }}>
                        <span className={`status-pill ${tone}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon size={10} />{pct}</span>
                        <span style={{ color: "var(--muted)" }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ display: "grid", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: "rgba(16,185,129,.45)" }} /><span style={{ color: "var(--muted)" }}>Capacity available</span></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9.5 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: "rgba(239,68,68,.45)" }} /><span style={{ color: "var(--muted)" }}>Over capacity</span></div>
                  <span style={{ fontSize: 9.5, color: "var(--muted)" }}>Hours and % use the same committed allocation model.</span>
                </div>
              )}
            </div>
          </details>
        </div>
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
                  ? dayChunks.map((week, wi) => (
                      <th
                        key={wi}
                        colSpan={week.length}
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
                        <div style={{ fontWeight: 600 }}>Week {isoWeekNumber(week[0])}</div>
                        <div style={{ marginTop: 2, fontSize: 9.5, color: "var(--muted)", fontWeight: 600 }}>
                          {week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {week[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
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
                            setDetailTab("workload");
                            setWorkloadScope("active");
                            const currentWeekIndex = weeks.findIndex((week) => week.some((wd) => toISO(wd) === today));
                            setDetailWeekIndex(currentWeekIndex >= 0 ? currentWeekIndex : 0);
                            setSelectedCell(null);
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <span
                              title="Open member utilization details"
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: "50%",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: isOpen ? "rgba(59,130,246,.12)" : "var(--surface)",
                                border: "1px solid var(--border)",
                                color: "var(--accent)",
                                flexShrink: 0,
                              }}
                            >
                              <Plus size={12} strokeWidth={2.4} />
                            </span>
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
                              const remaining = capacity - value;
                              const remainingPct = capacity > 0 ? (remaining / capacity) * 100 : 0;
                              const bandwidthOver = remaining < 0;
                              return (
                                <td
                                  key={i}
                                  title={capacityLens === "committed" ? `${tier.label} · ${value.toFixed(1)}h allocated / ${capacity.toFixed(1)}h capacity` : bandwidthOver ? `Over capacity by ${Math.abs(remaining).toFixed(1)}h · ${value.toFixed(1)}h committed / ${capacity.toFixed(1)}h capacity` : `${remaining.toFixed(1)}h available · ${displayPct(remainingPct)}% bandwidth · ${value.toFixed(1)}h committed`}
                                  onClick={() => {
                                    setDetailPersonId(null);
                                    setSelectedCell({ personId: person.id, dateStr });
                                  }}
                                  role="button"
                                  style={{
                                    ...rollupCellStyle(i),
                                    background: capacityLens === "committed" ? tier.bg : bandwidthOver ? "rgba(239,68,68,.08)" : remaining === capacity ? "var(--hover-bg)" : "rgba(16,185,129,.08)",
                                    color: capacityLens === "committed" ? tier.fg : bandwidthOver ? "var(--danger)" : "#047857",
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    outline: selectedCell?.personId === person.id && selectedCell?.dateStr === dateStr ? "2px solid var(--accent)" : undefined,
                                    outlineOffset: -2,
                                  }}
                                >
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    {capacityLens === "committed" ? <Icon size={13} /> : bandwidthOver ? <AlertTriangle size={13} /> : <Circle size={13} />}
                                    {displayMode !== "hours" && (
                                      <span>
                                        {capacityLens === "committed" ? (tier.key === "unallocated" ? "–" : `${displayPct(pct)}%`) : bandwidthOver ? `-${displayPct(Math.abs(remainingPct))}%` : `${displayPct(remainingPct)}%`}
                                        {av?.status === "half_day" && <span style={{ fontSize: 9, marginLeft: 2 }}>½</span>}
                                      </span>
                                    )}
                                    {displayMode !== "utilization" && (
                                      <span style={{ fontSize: displayMode === "hours" ? 11 : 9, fontWeight: displayMode === "hours" ? 700 : 500, opacity: displayMode === "hours" ? 1 : 0.78 }}>
                                        {capacityLens === "committed" ? `${value.toFixed(1)}h` : bandwidthOver ? `${Math.abs(remaining).toFixed(1)}h over` : `${remaining.toFixed(1)}h free`}
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
                              const bandwidthOver = stats.remainingHours < 0;
                              const title =
                                stats.workingDaysCount === 0
                                  ? "No working days this week"
                                  : capacityLens === "committed"
                                  ? `${displayPct(stats.avgPct)}% ${tier.label} · Planned ${stats.plannedHours.toFixed(1)}h / ${stats.availableHours.toFixed(1)}h · Peak day ${displayPct(stats.peakPct)}% · Overloaded days: ${stats.overloadedDays}`
                                  : bandwidthOver
                                  ? `Over capacity by ${Math.abs(stats.remainingHours).toFixed(1)}h · ${stats.plannedHours.toFixed(1)}h committed / ${stats.availableHours.toFixed(1)}h capacity`
                                  : `${stats.remainingHours.toFixed(1)}h available · ${displayPct(stats.remainingPct)}% bandwidth · ${stats.plannedHours.toFixed(1)}h committed`;
                              return (
                                <td
                                  key={wi}
                                  style={{
                                    ...rollupWeekCellStyle(wi),
                                    background: stats.workingDaysCount === 0 ? undefined : capacityLens === "committed" ? tier.bg : bandwidthOver ? "rgba(239,68,68,.08)" : "rgba(16,185,129,.08)",
                                    color: stats.workingDaysCount === 0 ? "var(--muted)" : capacityLens === "committed" ? tier.fg : bandwidthOver ? "var(--danger)" : "#047857",
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                  }}
                                  title={title}
                                >
                                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                    {capacityLens === "committed" ? <Icon size={13} /> : bandwidthOver ? <AlertTriangle size={13} /> : <Circle size={13} />}
                                    {displayMode !== "hours" && <span>{stats.workingDaysCount === 0 ? "–" : capacityLens === "committed" ? `${displayPct(stats.avgPct)}%` : bandwidthOver ? `-${displayPct(Math.abs(stats.remainingPct))}%` : `${displayPct(stats.remainingPct)}%`}</span>}
                                    {displayMode !== "utilization" && (
                                      <span style={{ fontSize: displayMode === "hours" ? 11 : 9, fontWeight: displayMode === "hours" ? 700 : 500, opacity: displayMode === "hours" ? 1 : 0.78 }}>
                                        {capacityLens === "committed" ? `${stats.plannedHours.toFixed(1)}h${displayMode === "both" ? ` / ${stats.availableHours.toFixed(1)}h` : ""}` : bandwidthOver ? `${Math.abs(stats.remainingHours).toFixed(1)}h over` : `${stats.remainingHours.toFixed(1)}h free`}
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


      {selectedCell && selectedPerson && !detailPerson && (
        <aside
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 38,
            width: "min(46vw, 720px)",
            minWidth: 560,
            overflowY: "auto",
            background: "var(--surface)",
            borderLeft: "1px solid var(--border)",
            borderRadius: "10px 0 0 10px",
            boxShadow: "-18px 0 48px rgba(15,35,65,.16)",
          }}
        >
          <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, position: "sticky", top: 0, background: "var(--surface)", zIndex: 2 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>{selectedPerson.name}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--navy)" }}>
                {parseLocalDate(selectedCell.dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>Daily allocation</div>
            </div>
            <button onClick={() => setSelectedCell(null)} title="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", padding: 4 }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ padding: "18px 20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              {selectedPct > 100 ? <AlertTriangle size={19} style={{ color: "var(--danger)" }} /> : <Gauge size={19} style={{ color: "var(--accent)" }} />}
              <span style={{ fontSize: 30, lineHeight: 1, fontWeight: 600, color: selectedPct > 100 ? "var(--danger)" : tierOf(selectedPct).fg }}>
                {displayPct(selectedPct)}%
              </span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{selectedAllocated.toFixed(1)}h allocated / {selectedCapacity.toFixed(1)}h capacity</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 9, marginBottom: 18 }}>
              <div style={{ padding: 11, border: "1px solid var(--border)", borderRadius: 10, textAlign: "center", background: "var(--hover-bg)" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--navy)" }}>{selectedCapacity.toFixed(1)}h</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>Capacity</div>
              </div>
              <div style={{ padding: 11, border: "1px solid var(--border)", borderRadius: 10, textAlign: "center", background: "var(--hover-bg)" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--navy)" }}>{selectedAllocated.toFixed(1)}h</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>Allocated</div>
              </div>
              <div style={{ padding: 11, border: "1px solid var(--border)", borderRadius: 10, textAlign: "center", background: selectedAllocated > selectedCapacity ? "rgba(239,68,68,.06)" : "rgba(16,185,129,.06)" }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: selectedAllocated > selectedCapacity ? "var(--danger)" : "#059669" }}>
                  {selectedAllocated > selectedCapacity ? "+" : ""}{(selectedAllocated - selectedCapacity).toFixed(1)}h
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{selectedAllocated > selectedCapacity ? "Over" : "Remaining"}</div>
              </div>
            </div>

            {selectedAllocated > selectedCapacity && selectedContributionRows.some((r) => r.isOverageDriver) && (
              <div style={{ marginBottom: 16, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,.16)", background: "rgba(239,68,68,.035)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertTriangle size={15} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>Daily overage driver identified</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.4 }}>
                    The highlighted contribution is the point where this day's cumulative planned allocation first exceeds available capacity. This is a planning attribution, not a judgment that the task itself is unnecessary.
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)" }}>Work assigned this day</div>
              <button
                onClick={() => {
                  setDetailPersonId(selectedPerson.id);
                  setDetailTab("timeline");
                  const clickedWeek = weeks.findIndex((week) => week.some((wd) => toISO(wd) === selectedCell.dateStr));
                  if (clickedWeek >= 0) setDetailWeekIndex(clickedWeek);
                }}
                style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 10.5, fontWeight: 600, cursor: "pointer" }}
              >
                Open full view
              </button>
            </div>

            {selectedContributionRows.length === 0 ? (
              <div style={{ padding: 16, border: "1px dashed var(--border)", borderRadius: 10, color: "var(--muted)", fontSize: 11.5 }}>No scoped work contributes to this day.</div>
            ) : (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(210px,1fr) 125px 70px 105px 105px", gap: 10, padding: "9px 10px", background: "var(--hover-bg)", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)" }}>Task / Project</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>Date Assigned</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textAlign: "right" }}>Hours</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>Driver</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>Action</div>
                </div>
                {selectedContributionRows.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(210px,1fr) 125px 70px 105px 105px",
                      gap: 10,
                      alignItems: "center",
                      padding: "10px",
                      borderBottom: "1px solid var(--border)",
                      background: r.isOverageDriver ? "rgba(239,68,68,.04)" : "var(--surface)",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{r.projectName}</div>
                    </div>
                    <div title={r.entry.estimated ? "Estimated from historical task order" : "Date this work entered the person's workload"} style={{ textAlign: "center", fontSize: 11, color: r.entry.estimated ? "var(--muted)" : "var(--accent)", fontWeight: 600, whiteSpace: "nowrap" }}>
                      {formatWorkloadDate(r.entry)}
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{r.hours.toFixed(1)}h</div>
                    <div style={{ textAlign: "center" }}>
                      {r.isOverageDriver ? (
                        <span style={{ display: "inline-flex", padding: "4px 7px", borderRadius: 999, background: "rgba(239,68,68,.09)", color: "var(--danger)", fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap" }}>Overage driver</span>
                      ) : (
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>—</span>
                      )}
                    </div>
                    <div style={{ textAlign: "center" }}>
                      {r.kind === "task" ? (
                        <button
                          onClick={() => {
                            const task = tasks.find((t) => t.id === r.id);
                            if (!task) return;
                            setScenarioTaskId(task.id);
                            setScenarioStart(task.start_date ?? task.current_due_date);
                            setScenarioDue(task.current_due_date);
                            setScenarioAssigneeId(task.assignee_id);
                          }}
                          style={{ border: "1px solid rgba(59,130,246,.16)", background: "rgba(59,130,246,.07)", color: "var(--accent)", borderRadius: 999, padding: "5px 8px", fontSize: 9.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          Rebalance
                        </button>
                      ) : (
                        <span style={{ fontSize: 9.5, color: "var(--muted)" }}>PM overhead</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      {scenarioTask && scenarioPerson && scenarioTargetPerson && scenarioProject && (
        <>
          <div
            onClick={() => { setScenarioTaskId(null); setScenarioAssigneeId(null); setShowScenarioDetails(false); setShowOtherRoleCandidates(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 48, background: "rgba(15,35,65,.28)" }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 49,
              width: "min(94vw, 1120px)",
              maxWidth: "calc(100vw - 28px)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "10px 0 0 10px",
              boxShadow: "0 24px 64px rgba(15,35,65,.24)",
              overflowY: "auto",
            }}
          >
            <div style={{ padding: "16px 18px 13px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                  <Sparkles size={15} style={{ color: "var(--accent)" }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", letterSpacing: ".04em" }}>SCENARIO PREVIEW</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "var(--navy)" }}>{scenarioTask.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {scenarioProject.name} · {scenarioPerson.name}{scenarioTargetPerson.id !== scenarioPerson.id ? ` → ${scenarioTargetPerson.name}` : ""}
                </div>
              </div>
              <button onClick={() => { setScenarioTaskId(null); setScenarioAssigneeId(null); setShowScenarioDetails(false); setShowOtherRoleCandidates(false); }} style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer" }}><X size={17} /></button>
            </div>

            <div style={{ padding: 18 }}>
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(59,130,246,.06)", border: "1px solid rgba(59,130,246,.12)", fontSize: 10, color: "var(--text-secondary)", lineHeight: 1.45, marginBottom: 14 }}>
                Preview only. This does not change the WBS, task list, baseline, assignee history, or audit trail.
              </div>

              <section style={{ border: "1px solid rgba(59,130,246,.14)", borderRadius: 12, background: "rgba(59,130,246,.045)", padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
                  <span style={{ width: 23, height: 23, borderRadius: "50%", background: "var(--accent)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>1</span>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>Current plotted schedule</div>
                    <div style={{ fontSize: 9.3, color: "var(--muted)", marginTop: 1 }}>Read-only reference from the current WBS.</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr 28px 1fr .72fr .72fr", gap: 8, alignItems: "end" }}>
                  <label style={{ fontSize: 9.5, color: "var(--muted)" }}>
                    Plotted Assignee
                    <div style={{ width: "100%", marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", fontSize: 11, fontWeight: 600, color: "var(--navy)", background: "rgba(255,255,255,.72)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {scenarioPerson.name}
                    </div>
                  </label>
                  <label style={{ fontSize: 9.5, color: "var(--muted)" }}>
                    Plotted Start
                    <div style={{ width: "100%", marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", fontSize: 11, color: "var(--navy)", background: "rgba(255,255,255,.72)" }}>
                      {parseLocalDate(scenarioTask.start_date ?? scenarioTask.current_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </label>
                  <ArrowRight size={15} style={{ color: "var(--muted)", marginBottom: 10 }} />
                  <label style={{ fontSize: 9.5, color: "var(--muted)" }}>
                    Plotted Due
                    <div style={{ width: "100%", marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", fontSize: 11, color: "var(--navy)", background: "rgba(255,255,255,.72)" }}>
                      {parseLocalDate(scenarioTask.current_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  </label>
                  <div>
                    <div style={{ fontSize: 9.5, color: "var(--muted)" }}>Duration</div>
                    <div style={{ marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", background: "rgba(255,255,255,.72)" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--navy)" }}>{scenarioPlottedDuration} day{scenarioPlottedDuration === 1 ? "" : "s"}</div>
                      <div style={{ fontSize: 7.8, color: "var(--muted)", marginTop: 1 }}>working days</div>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9.5, color: "var(--muted)" }}>Scoped Hours</div>
                    <div style={{ marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", background: "rgba(255,255,255,.72)", fontSize: 11, fontWeight: 600, color: "var(--navy)" }}>{Number(scenarioTask.estimated_hours ?? 0).toFixed(1)}h</div>
                  </div>
                </div>
                {scenarioPreferredRole && (
                  <div style={{ marginTop: 8, fontSize: 8.8, color: "var(--muted)" }}>Preferred role: <strong style={{ color: "var(--navy)", fontWeight: 600 }}>{scenarioPreferredRole}</strong></div>
                )}
              </section>

              <section style={{ border: "1px solid rgba(59,130,246,.18)", borderRadius: 12, background: "rgba(219,234,254,.48)", padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
                  <span style={{ width: 23, height: 23, borderRadius: "50%", background: "#3b82f6", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>2</span>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>Planning scenario</div>
                    <div style={{ fontSize: 9.3, color: "var(--muted)", marginTop: 1 }}>Adjust assignee and/or dates to test an alternative.</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 28px 1fr", gap: 8, alignItems: "end" }}>
                  <label style={{ fontSize: 9.5, color: "var(--muted)" }}>
                    Scenario Assignee
                    <select
                      value={scenarioAssigneeId ?? scenarioTask.assignee_id ?? ""}
                      onChange={(e) => {
                        const id = e.target.value || null;
                        setScenarioAssigneeId(id);
                        const nextPerson = id ? people.find((p) => p.id === id) ?? null : scenarioPerson;
                        if (preserveScenarioDuration && nextPerson && scenarioStart) {
                          setScenarioDue(scenarioDueFromStart(scenarioStart, nextPerson, scenarioPlottedDuration));
                        }
                      }}
                      style={{ width: "100%", marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", fontSize: 11, color: "var(--navy)", background: "var(--surface)" }}
                    >
                      <optgroup label={scenarioPreferredRole ? `Same role · ${scenarioPreferredRole}` : "Same role"}>
                        {sameRoleScenarioCandidates.map(({ person }) => (
                          <option key={person.id} value={person.id}>{person.name}{person.job_title ? ` · ${person.job_title}` : ""}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Other roles">
                        {otherRoleScenarioCandidates.map(({ person }) => (
                          <option key={person.id} value={person.id}>{person.name}{person.job_title ? ` · ${person.job_title}` : ""}</option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label style={{ fontSize: 9.5, color: "var(--muted)" }}>
                    Scenario Start
                    <input
                      type="date"
                      value={scenarioStart}
                      min={today}
                      onChange={(e) => {
                        const nextStart = e.target.value;
                        setScenarioStart(nextStart);
                        if (preserveScenarioDuration && scenarioTargetPerson && nextStart) {
                          setScenarioDue(scenarioDueFromStart(nextStart, scenarioTargetPerson, scenarioPlottedDuration));
                        }
                      }}
                      style={{ width: "100%", marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", fontSize: 11, color: "var(--navy)" }}
                    />
                  </label>
                  <ArrowRight size={15} style={{ color: "var(--muted)", marginBottom: 10 }} />
                  <label style={{ fontSize: 9.5, color: "var(--muted)" }}>
                    Scenario Due
                    <input
                      type="date"
                      value={scenarioDue}
                      min={scenarioStart || today}
                      disabled={preserveScenarioDuration}
                      onChange={(e) => setScenarioDue(e.target.value)}
                      style={{ width: "100%", marginTop: 4, border: "1px solid var(--border)", borderRadius: 9, padding: "8px 9px", fontSize: 11, color: "var(--navy)", background: preserveScenarioDuration ? "var(--hover-bg)" : "var(--surface)", opacity: preserveScenarioDuration ? .82 : 1 }}
                    />
                  </label>
                </div>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 9, fontSize: 9.3, color: "var(--muted)", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={preserveScenarioDuration}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setPreserveScenarioDuration(checked);
                      if (checked && scenarioTargetPerson && scenarioStart) {
                        setScenarioDue(scenarioDueFromStart(scenarioStart, scenarioTargetPerson, scenarioPlottedDuration));
                      }
                    }}
                  />
                  Preserve plotted duration ({scenarioPlottedDuration} working day{scenarioPlottedDuration === 1 ? "" : "s"})
                </label>

                <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,.20)", background: "rgba(255,247,237,.72)", color: "#9a6700", fontSize: 8.9, lineHeight: 1.4 }}>
                  Dependency dates are not recalculated in this preview. WBS remains authoritative and may shift dates where task dependencies apply.
                </div>

                {scenarioTargetPerson && (
                  <div style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid rgba(59,130,246,.14)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--navy)" }}>2-week capacity forecast · {scenarioTargetPerson.name}</div>
                        <div style={{ fontSize: 8.8, color: "var(--muted)", marginTop: 1 }}>Existing utilization before applying this scenario.</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(14, minmax(58px,1fr))", gap: 5 }}>
                      {scenarioForecast.map((day) => {
                        const tone = day.blocked ? null : tierOf(day.pct);
                        return (
                          <div key={day.dateStr} title={day.blocked ? day.blocked : `${day.allocated.toFixed(1)}h allocated · ${day.free.toFixed(1)}h free`} style={{ padding: "6px 4px", borderRadius: 8, border: "1px solid var(--border)", textAlign: "center", background: day.blocked ? "var(--hover-bg)" : tone?.bg }}>
                            <div style={{ fontSize: 8, color: "var(--muted)" }}>{parseLocalDate(day.dateStr).toLocaleDateString("en-US",{weekday:"short"})}</div>
                            <div style={{ fontSize: 9.2, fontWeight: 600, color: "var(--navy)", marginTop: 1 }}>{parseLocalDate(day.dateStr).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                            <div style={{ fontSize: 9.5, fontWeight: 600, color: day.blocked ? "var(--muted)" : tone?.fg, marginTop: 2 }}>{day.blocked ? "Off" : `${displayPct(day.pct)}%`}</div>
                            <div style={{ fontSize: 7.7, color: "var(--muted)", marginTop: 1 }}>{day.blocked ? "—" : `${day.free.toFixed(1)}h free`}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedScenarioWindows.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--navy)", marginBottom: 7 }}>Suggested windows</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 7 }}>
                      {selectedScenarioWindows.map((window, wi) => (
                        <div key={window.startStr} style={{ padding: 10, borderRadius: 9, border: "1px solid var(--border)", background: wi === 0 ? "rgba(16,185,129,.07)" : wi === 1 ? "rgba(59,130,246,.04)" : "rgba(245,158,11,.05)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                            <span style={{ width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: wi === 0 ? "rgba(16,185,129,.12)" : wi === 1 ? "rgba(59,130,246,.10)" : "rgba(245,158,11,.12)", color: wi === 0 ? "#059669" : wi === 1 ? "#2563eb" : "#d97706" }}>
                              {wi === 0 ? <CheckCircle2 size={12} /> : wi === 1 ? <TrendingUp size={12} /> : <Gauge size={12} />}
                            </span>
                            <div style={{ fontSize: 8.5, fontWeight: 600, color: wi === 0 ? "#059669" : wi === 1 ? "#2563eb" : "#b45309" }}>{wi === 0 ? "BEST CAPACITY FIT" : wi === 1 ? "NEXT BEST" : "ALTERNATIVE"}</div>
                          </div>
                          <div style={{ fontSize: 10.4, fontWeight: 600, color: "var(--navy)" }}>{parseLocalDate(window.startStr).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – {parseLocalDate(window.dueStr).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                          <div style={{ fontSize: 8.5, color: "var(--muted)", marginTop: 3 }}>Projected peak <strong style={{ color: tierOf(window.peakPct).fg }}>{displayPct(window.peakPct)}%</strong> · {window.overloadedDays} overload day{window.overloadedDays === 1 ? "" : "s"}</div>
                          <button onClick={() => { setScenarioStart(window.startStr); setScenarioDue(window.dueStr); }} style={{ marginTop: 7, width: "100%", border: "1px solid rgba(59,130,246,.22)", borderRadius: 7, background: "var(--surface)", color: "var(--accent)", fontSize: 8.8, fontWeight: 600, padding: "5px 6px", cursor: "pointer" }}>Use dates</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 13, paddingTop: 12, borderTop: "1px solid rgba(59,130,246,.14)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                    <div>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--navy)" }}>Recommended assignees</div>
                      <div style={{ fontSize: 8.8, color: "var(--muted)", marginTop: 1 }}>Same-role candidates are prioritized; each recommendation uses that person's best 2-week window.</div>
                    </div>
                    {otherRoleScenarioCandidates.length > 0 && (
                      <button onClick={() => setShowOtherRoleCandidates((v) => !v)} style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 8.8, fontWeight: 600, cursor: "pointer" }}>
                        {showOtherRoleCandidates ? "Hide other roles" : "View other roles"}
                      </button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 7 }}>
                    {[...sameRoleScenarioCandidates.slice(0, 3), ...(showOtherRoleCandidates ? otherRoleScenarioCandidates.slice(0, 3) : [])].map(({ person, best }) => {
                      const sameRole = person.job_title === scenarioPreferredRole;
                      return (
                        <div key={person.id} style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 10, background: sameRole ? "rgba(236,253,245,.72)" : "rgba(255,255,255,.76)" }}>
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ minWidth: 0, display: "flex", gap: 7, alignItems: "center" }}>
                              <span style={{ width: 24, height: 24, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: sameRole ? "rgba(16,185,129,.10)" : "rgba(59,130,246,.08)", color: sameRole ? "#059669" : "#2563eb", flex: "0 0 auto" }}>
                                {sameRole ? <CheckCircle2 size={13} /> : <Sparkles size={13} />}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 9.8, fontWeight: 600, color: "var(--navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{person.name}</div>
                                <div style={{ fontSize: 8.2, color: "var(--muted)", marginTop: 1 }}>{person.job_title ?? "No role"}</div>
                              </div>
                            </div>
                            <span style={{ padding: "3px 6px", borderRadius: 999, fontSize: 7.7, fontWeight: 600, background: sameRole ? "rgba(16,185,129,.10)" : "rgba(100,116,139,.10)", color: sameRole ? "#047857" : "var(--muted)", whiteSpace: "nowrap" }}>{sameRole ? "Same role" : "Other role"}</span>
                          </div>
                          {best ? (
                            <>
                              <div style={{ marginTop: 8, fontSize: 8.4, color: "var(--muted)" }}>Best window</div>
                              <div style={{ marginTop: 2, fontSize: 10.2, fontWeight: 600, color: "var(--navy)" }}>{parseLocalDate(best.startStr).toLocaleDateString("en-US",{month:"short",day:"numeric"})} – {parseLocalDate(best.dueStr).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                              <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 8.4 }}>
                                <span style={{ color: "var(--muted)" }}>Projected peak</span>
                                <strong style={{ color: tierOf(best.peakPct).fg }}>{displayPct(best.peakPct)}%</strong>
                              </div>
                              <div style={{ marginTop: 2, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 8.4 }}>
                                <span style={{ color: "var(--muted)" }}>Overload days</span>
                                <strong style={{ color: best.overloadedDays ? "var(--danger)" : "#059669" }}>{best.overloadedDays}</strong>
                              </div>
                            </>
                          ) : (
                            <div style={{ marginTop: 12, fontSize: 8.5, color: "var(--muted)" }}>No viable 2-week window.</div>
                          )}
                          <button
                            disabled={!best}
                            onClick={() => {
                              if (!best) return;
                              setScenarioAssigneeId(person.id);
                              setScenarioStart(best.startStr);
                              setScenarioDue(best.dueStr);
                            }}
                            style={{ marginTop: 8, width: "100%", border: "1px solid rgba(59,130,246,.22)", borderRadius: 7, background: "var(--surface)", color: "var(--accent)", fontSize: 8.6, fontWeight: 600, padding: "5px 6px", cursor: best ? "pointer" : "default", opacity: best ? 1 : .45 }}
                          >
                            Use assignee & dates
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section style={{ border: "1px solid rgba(245,158,11,.16)", borderRadius: 12, background: "rgba(255,247,237,.68)", padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
                  <span style={{ width: 23, height: 23, borderRadius: "50%", background: "#f59e0b", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>3</span>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>Utilization impact</div>
                    <div style={{ fontSize: 9.3, color: "var(--muted)", marginTop: 1 }}>Compare current vs scenario impact for affected people.</div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: scenarioImpact?.people.length === 2 ? "1fr 1fr" : "1fr", gap: 10 }}>
                  {(scenarioImpact?.people ?? []).map((impact) => {
                    const improved = impact.proposedOverDays < impact.currentOverDays || impact.proposedPeak < impact.currentPeak;
                    const worsened = impact.proposedOverDays > impact.currentOverDays || impact.proposedPeak > impact.currentPeak;
                    return (
                      <div key={impact.person.id} style={{ padding: 12, border: `1px solid ${worsened ? "rgba(239,68,68,.18)" : improved ? "rgba(16,185,129,.18)" : "var(--border)"}`, borderRadius: 10, background: worsened ? "rgba(254,242,242,.78)" : improved ? "rgba(236,253,245,.82)" : "rgba(255,255,255,.75)" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--navy)", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{impact.person.name}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 24px 1fr", alignItems: "center", gap: 5 }}>
                          <div>
                            <div style={{ fontSize: 8.8, color: "var(--muted)" }}>Current peak</div>
                            <div style={{ fontSize: 19, fontWeight: 600, color: tierOf(impact.currentPeak).fg }}>{displayPct(impact.currentPeak)}%</div>
                          </div>
                          <ArrowRight size={13} style={{ color: "var(--muted)" }} />
                          <div>
                            <div style={{ fontSize: 8.8, color: "var(--muted)" }}>Scenario</div>
                            <div style={{ fontSize: 19, fontWeight: 600, color: tierOf(impact.proposedPeak).fg }}>{displayPct(impact.proposedPeak)}%</div>
                          </div>
                        </div>
                        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr auto", gap: 6, fontSize: 9.3 }}>
                          <span style={{ color: "var(--muted)" }}>Overloaded days</span>
                          <span style={{ fontWeight: 600, color: impact.proposedOverDays > impact.currentOverDays ? "var(--danger)" : impact.proposedOverDays < impact.currentOverDays ? "#059669" : "var(--muted)" }}>{impact.currentOverDays} → {impact.proposedOverDays}</span>
                          <span style={{ color: "var(--muted)" }}>{impact.netHours < 0 ? "Hours released" : impact.netHours > 0 ? "Hours added" : "Hours shifted"}</span>
                          <span style={{ fontWeight: 600, color: impact.netHours > 0 ? "var(--danger)" : impact.netHours < 0 ? "#059669" : "var(--muted)" }}>{Math.abs(impact.netHours).toFixed(1)}h</span>
                        </div>
                        {(improved || worsened) && (
                          <div style={{ marginTop: 9, padding: "7px 8px", borderRadius: 8, background: worsened ? "rgba(245,158,11,.10)" : "rgba(16,185,129,.10)", color: worsened ? "#b7791f" : "#047857", fontSize: 9.2, lineHeight: 1.35 }}>
                            {worsened
                              ? `Scenario adds ${Math.max(0, impact.proposedOverDays - impact.currentOverDays)} overloaded day${Math.max(0, impact.proposedOverDays - impact.currentOverDays) === 1 ? "" : "s"}.`
                              : `Scenario resolves ${Math.max(0, impact.currentOverDays - impact.proposedOverDays)} overloaded day${Math.max(0, impact.currentOverDays - impact.proposedOverDays) === 1 ? "" : "s"}.`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section style={{ border: "1px solid rgba(59,130,246,.13)", borderRadius: 12, background: "rgba(248,250,252,.92)", padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ width: 23, height: 23, borderRadius: "50%", background: "#3b82f6", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>4</span>
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>Daily capacity impact</div>
                    <div style={{ fontSize: 9.3, color: "var(--muted)", marginTop: 1 }}>Visual comparison of current plan vs scenario.</div>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", fontSize: 8.8, color: "var(--muted)" }}>
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#bfdbfe" }} />Current</span>
                    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3b82f6" }} />Scenario</span>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: scenarioImpact?.people.length === 2 ? "1fr 1fr" : "1fr", gap: 10 }}>
                  {(scenarioImpact?.people ?? []).map((impact) => {
                    const rows = impact.rows.slice(0, 7);
                    const maxPct = Math.max(100, ...rows.flatMap((r) => [r.currentPct, r.proposedPct]));
                    return (
                      <div key={impact.person.id} style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--navy)", marginBottom: 9 }}>{impact.person.name}</div>
                        {rows.length === 0 ? (
                          <div style={{ fontSize: 9.3, color: "var(--muted)", padding: "18px 0", textAlign: "center" }}>No daily change in this scenario.</div>
                        ) : (
                          <div style={{ height: 126, display: "flex", alignItems: "flex-end", gap: 8, paddingTop: 8, position: "relative" }}>
                            <div style={{ position: "absolute", left: 0, right: 0, bottom: `${Math.min(100, (100 / maxPct) * 100)}%`, borderTop: "1px dashed rgba(239,68,68,.42)", pointerEvents: "none" }}>
                              <span style={{ position: "absolute", right: 0, top: -11, fontSize: 7.8, color: "var(--danger)", background: "var(--surface)", paddingLeft: 4 }}>100%</span>
                            </div>
                            {rows.map((row) => (
                              <div key={row.dateStr} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                                <div style={{ flex: 1, width: "100%", display: "flex", gap: 2, alignItems: "flex-end", justifyContent: "center" }}>
                                  <div title={`Current ${displayPct(row.currentPct)}%`} style={{ width: "38%", maxWidth: 18, height: `${Math.max(3, Math.min(100, (row.currentPct / maxPct) * 100))}%`, borderRadius: "4px 4px 1px 1px", background: "#bfdbfe" }} />
                                  <div title={`Scenario ${displayPct(row.proposedPct)}%`} style={{ width: "38%", maxWidth: 18, height: `${Math.max(3, Math.min(100, (row.proposedPct / maxPct) * 100))}%`, borderRadius: "4px 4px 1px 1px", background: row.proposedPct > 100 ? "#ef4444" : row.proposedPct >= 80 ? "#f59e0b" : "#3b82f6" }} />
                                </div>
                                <div style={{ fontSize: 7.8, color: "var(--muted)", marginTop: 4, whiteSpace: "nowrap" }}>{parseLocalDate(row.dateStr).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {scenarioImpact && scenarioImpact.rows.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
                      <div>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--navy)" }}>Affected days</div>
                        <div style={{ fontSize: 8.5, color: "var(--muted)", marginTop: 1 }}>Dates where utilization changes under this scenario.</div>
                      </div>
                    </div>
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 90px 90px 90px 130px", gap: 8, padding: "7px 9px", background: "var(--hover-bg)", borderBottom: "1px solid var(--border)", fontSize: 8.2, fontWeight: 600, color: "var(--muted)" }}>
                        <span>Date</span><span>Person</span><span style={{ textAlign: "right" }}>Current</span><span style={{ textAlign: "right" }}>Scenario</span><span style={{ textAlign: "right" }}>Change</span><span>Status</span>
                      </div>
                      {scenarioImpact.rows.slice(0, 20).map((row) => {
                        const deltaPct = row.proposedPct - row.currentPct;
                        const status = row.currentPct > 100 && row.proposedPct <= 100 ? "Overload resolved" : row.currentPct <= 100 && row.proposedPct > 100 ? "New overload" : deltaPct < 0 ? "Improved" : deltaPct > 0 ? "Increased" : "No change";
                        const good = status === "Overload resolved" || status === "Improved";
                        const bad = status === "New overload" || status === "Increased";
                        return (
                          <div key={`${row.person.id}-${row.dateStr}`} style={{ display: "grid", gridTemplateColumns: "110px 1fr 90px 90px 90px 130px", gap: 8, alignItems: "center", padding: "7px 9px", borderBottom: "1px solid var(--border)", fontSize: 8.8 }}>
                            <span style={{ color: "var(--navy)", fontWeight: 600 }}>{parseLocalDate(row.dateStr).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>
                            <span style={{ color: "var(--navy)" }}>{row.person.name}</span>
                            <span style={{ textAlign: "right", color: tierOf(row.currentPct).fg, fontWeight: 600 }}>{displayPct(row.currentPct)}%</span>
                            <span style={{ textAlign: "right", color: tierOf(row.proposedPct).fg, fontWeight: 600 }}>{displayPct(row.proposedPct)}%</span>
                            <span style={{ textAlign: "right", color: deltaPct > 0 ? "var(--danger)" : deltaPct < 0 ? "#059669" : "var(--muted)", fontWeight: 600 }}>{deltaPct > 0 ? "+" : ""}{displayPct(deltaPct)}%</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: bad ? "var(--danger)" : good ? "#059669" : "var(--muted)", fontWeight: 600 }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: bad ? "var(--danger)" : good ? "#10b981" : "#94a3b8" }} />
                              {status}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>

              <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(99,102,241,.06)", border: "1px solid rgba(99,102,241,.10)", fontSize: 9.5, color: "var(--muted)", lineHeight: 1.45 }}>
                This is a simulation only. Schedule and reassignment scenarios affect today forward and do not rewrite historical allocation. Dependency-aware cascading and Apply to WBS remain disabled until the preview logic is validated.
              </div>
            </div>
          </aside>
        </>
      )}

      {detailPerson && (
        <>
          <div
            onClick={() => { setDetailPersonId(null); setSelectedCell(null); }}
            style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(15, 35, 65, 0.20)" }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 40,
              width: "min(80vw, 1480px)",
              minWidth: "760px",
              background: "var(--surface)",
              boxShadow: "-22px 0 56px rgba(15, 35, 65, 0.18)",
              borderRadius: "10px 0 0 10px",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "16px 20px 13px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--navy)", marginBottom: 2 }}>{detailPerson.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{detailPerson.job_title ?? "Team member"}</div>
              </div>
              <button onClick={() => { setDetailPersonId(null); setSelectedCell(null); }} title="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", padding: 3 }}><X size={18} /></button>
            </div>

            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, minHeight: 58, background: "var(--surface)" }}>
              <div style={{ display: "inline-flex", gap: 4, padding: 4, background: "var(--hover-bg)", borderRadius: 999 }}>
                {([
                  ["workload", "Workload"],
                  ["timeline", "Timeline"],
                  ["pipeline", "Pipeline Sequence"],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => { setDetailTab(tab); setSelectedCell(null); }}
                    style={{
                      padding: "8px 14px",
                      border: "none",
                      borderRadius: 999,
                      background: detailTab === tab ? "var(--surface)" : "transparent",
                      color: detailTab === tab ? "var(--accent)" : "var(--muted)",
                      boxShadow: detailTab === tab ? "0 2px 8px rgba(15,35,65,.10)" : "none",
                      fontSize: 11.5,
                      fontWeight: detailTab === tab ? 800 : 650,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ position: "relative" }}>
                  <Search size={13} style={{ position: "absolute", left: 11, top: 9, color: "var(--muted)" }} />
                  <input value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="Search projects or tasks…" style={{ width: 240, fontSize: 11, padding: "7px 12px 7px 31px", border: "1px solid var(--border)", borderRadius: 999, color: "var(--navy)", background: "var(--surface)" }} />
                </div>
                {detailTab === "workload" && (
                  <select value={taskSort} onChange={(e) => setTaskSort(e.target.value as "project" | "oldest" | "newest")} style={{ fontSize: 11, fontWeight: 650, color: "var(--navy)", border: "1px solid var(--border)", borderRadius: 999, padding: "7px 30px 7px 12px", background: "var(--surface)" }}>
                    <option value="project">Project (A–Z)</option>
                    <option value="oldest">Added oldest</option>
                    <option value="newest">Added newest</option>
                  </select>
                )}
              </div>
            </div>

            {detailTab !== "workload" && (
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--hover-bg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", color: "var(--muted)" }}>
                    {detailTab === "timeline" ? "SELECT WEEK TO VIEW" : "SELECT WEEK FOR PIPELINE IMPACT"}
                  </div>
                  <span style={{
                    fontSize: 9.5,
                    fontWeight: 600,
                    padding: "4px 9px",
                    borderRadius: 999,
                    background: detailPeriodKind === "historical" ? "rgba(100,116,139,.12)" : detailPeriodKind === "current" ? "rgba(20,184,166,.12)" : "rgba(59,130,246,.12)",
                    color: detailPeriodKind === "historical" ? "var(--muted)" : detailPeriodKind === "current" ? "var(--success)" : "var(--accent)"
                  }}>
                    {detailPeriodKind === "historical" ? "Historical" : detailPeriodKind === "current" ? "Current week" : "Forecast"}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 205px 245px", gap: 12, alignItems: "stretch" }}>
                  <div style={{ display: "flex", gap: 9, overflowX: "auto", paddingBottom: 2 }}>
                    {detailWeekStats.map(({ week, stats }, wi) => {
                      const tier = tierOf(stats.avgPct);
                      const active = wi === safeDetailWeekIndex;
                      return (
                        <button
                          key={wi}
                          onClick={() => { setDetailWeekIndex(wi); setSelectedCell(null); }}
                          style={{
                            minWidth: 158,
                            textAlign: "left",
                            padding: "9px 11px",
                            border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                            borderRadius: 10,
                            background: tier.bg,
                            cursor: "pointer",
                            boxShadow: active ? "0 3px 10px rgba(15,35,65,.08)" : "none",
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", marginBottom: 2 }}>Week {isoWeekNumber(week[0])}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>
                            {week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {week[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 20, fontWeight: 600, color: tier.fg }}>{displayPct(stats.avgPct)}%</span>
                            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{stats.plannedHours.toFixed(1)}h / {stats.availableHours.toFixed(1)}h</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {detailSelectedWeekStats && (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: "10px 12px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: ".03em", marginBottom: 8 }}>EFFORT MIX</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          title={`Task ${selectedWeekTaskHours.toFixed(1)}h · PM ${selectedWeekPmHours.toFixed(1)}h`}
                          style={{
                            width: 58,
                            height: 58,
                            borderRadius: "50%",
                            flexShrink: 0,
                            background: selectedPeriodEffortTotal > 0
                              ? `conic-gradient(#2563eb 0 ${(selectedWeekTaskHours / selectedPeriodEffortTotal) * 100}%, #8b5cf6 ${(selectedWeekTaskHours / selectedPeriodEffortTotal) * 100}% 100%)`
                              : "var(--hover-bg)",
                            position: "relative",
                          }}
                        >
                          <div style={{ position: "absolute", inset: 9, borderRadius: "50%", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>
                            {selectedPeriodEffortTotal.toFixed(1)}h
                          </div>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--navy)", fontWeight: 600 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#2563eb" }} />Task</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)", whiteSpace: "nowrap" }}>
                              {selectedPeriodEffortTotal > 0 ? Math.round((selectedWeekTaskHours / selectedPeriodEffortTotal) * 100) : 0}% · {selectedWeekTaskHours.toFixed(1)}h
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--navy)", fontWeight: 600 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#8b5cf6" }} />PM</span>
                            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)", whiteSpace: "nowrap" }}>
                              {selectedPeriodEffortTotal > 0 ? Math.round((selectedWeekPmHours / selectedPeriodEffortTotal) * 100) : 0}% · {selectedWeekPmHours.toFixed(1)}h
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {detailSelectedWeekStats && (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: "10px 12px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: ".03em", marginBottom: 8 }}>PROJECT TYPE MIX</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                          title={projectTypeMix.map((mix) => `${mix.name} ${mix.totalHours.toFixed(1)}h`).join(" · ")}
                          style={{
                            width: 66,
                            height: 66,
                            borderRadius: "50%",
                            flexShrink: 0,
                            background: projectTypeMixTotal > 0
                              ? (() => {
                                  let acc = 0;
                                  const parts = projectTypeMix.map((mix, mi) => {
                                    const tone = PROJECT_TYPE_TONES[mi % PROJECT_TYPE_TONES.length];
                                    const start = acc;
                                    acc += (mix.totalHours / projectTypeMixTotal) * 100;
                                    return `${tone.dot} ${start}% ${acc}%`;
                                  });
                                  return `conic-gradient(${parts.join(", ")})`;
                                })()
                              : "var(--hover-bg)",
                            position: "relative",
                          }}
                        >
                          <div style={{ position: "absolute", inset: 10, borderRadius: "50%", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>
                            {projectTypeMixTotal.toFixed(1)}h
                          </div>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          {projectTypeMix.length === 0 ? (
                            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>No typed effort</div>
                          ) : projectTypeMix.map((mix, mi) => {
                            const tone = PROJECT_TYPE_TONES[mi % PROJECT_TYPE_TONES.length];
                            const share = projectTypeMixTotal > 0 ? Math.round((mix.totalHours / projectTypeMixTotal) * 100) : 0;
                            return (
                              <div key={mix.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: mi === projectTypeMix.length - 1 ? 0 : 5 }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: 11.5, color: "var(--navy)", fontWeight: 600 }}>
                                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: tone.dot, flexShrink: 0 }} />
                                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mix.name}</span>
                                </span>
                                <span style={{ fontSize: 11.5, fontWeight: 600, color: tone.fg, whiteSpace: "nowrap" }}>{share}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: selectedCell?.personId === detailPerson.id && detailTab === "timeline" ? "minmax(0, 1fr) 330px" : "1fr" }}>
              <div style={{ minWidth: 0, overflow: "auto", padding: "16px 20px 22px" }}>

                {detailTab === "workload" && (
                  <div style={{ maxWidth: "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14, marginBottom: 14 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--navy)" }}>{workloadScope === "active" ? "Active scoped workload" : "Completed / historical workload"}</div>
                        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                          {workloadScope === "active" ? "Work that can still consume future capacity." : "Completed and cancelled work retained for historical reference."}
                        </div>
                      </div>
                      <div style={{ display: "inline-flex", gap: 3, padding: 3, background: "var(--hover-bg)", borderRadius: 999 }}>
                        <button onClick={() => setWorkloadScope("active")} style={{ border: "none", borderRadius: 999, padding: "7px 12px", background: workloadScope === "active" ? "var(--surface)" : "transparent", boxShadow: workloadScope === "active" ? "0 2px 7px rgba(15,35,65,.09)" : "none", color: workloadScope === "active" ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Active ({detailActiveTasks.length})</button>
                        <button onClick={() => setWorkloadScope("historical")} style={{ border: "none", borderRadius: 999, padding: "7px 12px", background: workloadScope === "historical" ? "var(--surface)" : "transparent", boxShadow: workloadScope === "historical" ? "0 2px 7px rgba(15,35,65,.09)" : "none", color: workloadScope === "historical" ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Historical ({detailHistoricalTasks.length})</button>
                      </div>
                    </div>

                    {detailProjectIds.length === 0 ? (
                      <div style={{ padding: 18, border: "1px dashed var(--border)", borderRadius: 10, color: "var(--muted)", fontSize: 13 }}>No scoped tasks found for this person.</div>
                    ) : detailProjectIds.map((projectId) => {
                      const project = projects.find((p) => p.id === projectId);
                      const pTasks = detailWorkloadTasks.filter((t) => t.project_id === projectId);
                      const projectType = projectTypes.find((type) => type.id === project?.project_type_id);
                      const totalHours = pTasks.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0);
                      const entries = pTasks.map((t) => workloadEntryFor(t, detailPerson.id)).filter((e) => e.date);
                      const earliest = entries.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
                      return (
                        <div key={projectId} style={{ border: "1px solid var(--border)", borderRadius: 10, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(15,35,65,.04)", background: "var(--surface)" }}>
                          <div style={{ padding: "10px 12px", background: "var(--hover-bg)", display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 130px 170px", gap: 16, alignItems: "center" }}>
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>{project?.name ?? "Unknown project"}</div>
                                {projectType && <span style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 7px", borderRadius: 999, background: "rgba(59,130,246,.09)", color: "var(--accent)" }}>{projectType.name}</span>}
                              </div>
                              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{pTasks.length} task{pTasks.length === 1 ? "" : "s"} · {workloadScope === "active" ? "Planning" : "Historical"}</div>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 2 }}>Scoped</div>
                              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--navy)" }}>{totalHours.toFixed(1)}h</div>
                            </div>
                            <div style={{ textAlign: "center" }}>
                              <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 2 }}>First Added</div>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>{earliest ? formatWorkloadDate(earliest) : "—"}</div>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 130px 125px 165px 165px", columnGap: 18, alignItems: "center", padding: "8px 12px", background: "rgba(15,35,65,.025)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Task</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>Status</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>Scoped Hours</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>Date Assigned</div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "center" }}>Week Coverage</div>
                          </div>
                          {pTasks.map((t) => {
                            const entry = workloadEntryFor(t, detailPerson.id);
                            const tone = taskStatusTone(t.status);
                            return (
                              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 130px 125px 165px 165px", columnGap: 18, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.name}>{t.name}</div>
                                <div style={{ textAlign: "center" }}><span style={{ display: "inline-flex", padding: "4px 7px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>{t.status ?? "—"}</span></div>
                                <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>{(t.estimated_hours ?? 0).toFixed(1)}h</div>
                                <div title={entry.estimated ? "Estimated from historical task order" : "Date this task entered this person's workload"} style={{ textAlign: "center", fontSize: 12, color: entry.estimated ? "var(--muted)" : "var(--accent)", fontWeight: 650, whiteSpace: "nowrap" }}>{formatWorkloadDate(entry)}</div>
                                <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                                  {t.start_date ? parseLocalDate(t.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"} – {t.current_due_date ? parseLocalDate(t.current_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {detailTasks.some((t) => workloadEntryFor(t, detailPerson.id).estimated) && (
                      <div style={{ display: "flex", gap: 7, marginTop: 12, padding: 10, borderRadius: 10, background: "var(--hover-bg)", fontSize: 11.5, color: "var(--muted)" }}>
                        <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                        Dates prefixed with ~ are historical estimates reconstructed from the previous task ordering before exact task creation timestamps were introduced.
                      </div>
                    )}
                  </div>
                )}

                {detailTab === "timeline" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--navy)" }}>Weekly timeline</div>
                        <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                          {detailWeek.length ? `Week ${isoWeekNumber(detailWeek[0])} · ${detailWeek[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${detailWeek[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        <button className="planner-nav-btn" disabled={safeDetailWeekIndex === 0} onClick={() => { setDetailWeekIndex(Math.max(0, safeDetailWeekIndex - 1)); setSelectedCell(null); }}><ChevronLeft size={13} /></button>
                        <button className="planner-nav-btn" disabled={safeDetailWeekIndex >= detailWeekStats.length - 1} onClick={() => { setDetailWeekIndex(Math.min(detailWeekStats.length - 1, safeDetailWeekIndex + 1)); setSelectedCell(null); }}><ChevronRight size={13} /></button>
                      </div>
                    </div>

                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ background: "var(--hover-bg)" }}>
                            <th style={{ textAlign: "left", padding: "9px 10px", borderBottom: "1px solid var(--border)", minWidth: 230 }}>Task</th>
                            <th style={{ textAlign: "center", padding: "9px 8px", borderBottom: "1px solid var(--border)", width: 115 }}>Status</th>
                            <th style={{ textAlign: "center", padding: "9px 8px", borderBottom: "1px solid var(--border)", width: 125 }}>Date Assigned</th>
                            {detailDayStats.map((ds) => {
                              const blockedLabel = ds.blocked === "holiday" ? "Holiday" : ds.blocked === "weekend" || ds.blocked === "off" ? "Off" : null;
                              return (
                                <th key={ds.dateStr} style={{ textAlign: "center", padding: "8px 5px", borderBottom: "1px solid var(--border)", minWidth: 76, background: blockedLabel ? "var(--hover-bg)" : ds.tier.bg }}>
                                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>{WEEKDAY_LABEL[parseLocalDate(ds.dateStr).getDay()]} {parseLocalDate(ds.dateStr).getDate()}</div>
                                  {blockedLabel ? (
                                    <>
                                      <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{blockedLabel}</div>
                                      <div style={{ fontSize: 10.5, fontWeight: 600, color: ds.allocated > 0 ? "var(--danger)" : "var(--muted)", opacity: .85 }}>
                                        {ds.allocated > 0 ? `${ds.allocated.toFixed(1)}h plotted` : "0.0h"}
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div style={{ marginTop: 3, fontSize: 13.5, fontWeight: 600, color: ds.tier.fg }}>{ds.capacity > 0 ? `${displayPct(ds.pct)}%` : "—"}</div>
                                      <div style={{ fontSize: 10.5, fontWeight: 600, color: ds.tier.fg, opacity: .8 }}>{ds.allocated.toFixed(1)}h / {ds.capacity.toFixed(1)}h</div>
                                    </>
                                  )}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from(new Set(detailTasks
                            .filter((t) => detailWeek.some((d) => taskValueForDate(detailPerson, t, toISO(d)) > 0))
                            .map((t) => t.project_id)))
                            .map((projectId) => {
                              const project = projects.find((p) => p.id === projectId);
                              const projectType = projectTypes.find((pt) => pt.id === project?.project_type_id);
                              const pTasks = detailTasks.filter((t) => t.project_id === projectId && detailWeek.some((d) => taskValueForDate(detailPerson, t, toISO(d)) > 0));
                              return (
                                <Fragment key={projectId}>
                                  <tr style={{ background: "rgba(15,35,65,.035)" }}>
                                    <td colSpan={3 + detailDayStats.length} style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>{project?.name ?? "Unknown project"}</span>
                                        {projectType && <span style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 7px", borderRadius: 999, background: "rgba(59,130,246,.09)", color: "var(--accent)" }}>{projectType.name}</span>}
                                      </div>
                                    </td>
                                  </tr>
                                  {pTasks.map((t) => {
                                    const entry = workloadEntryFor(t, detailPerson.id);
                                    const tone = taskStatusTone(t.status);
                                    return (
                                      <tr key={t.id}>
                                        <td style={{ padding: "8px 10px 8px 18px", borderBottom: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 12.5 }}>{t.name}</td>
                                        <td style={{ padding: "8px", borderBottom: "1px solid var(--border)", textAlign: "center" }}><span style={{ display: "inline-flex", padding: "4px 7px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>{t.status ?? "—"}</span></td>
                                        <td title={entry.estimated ? "Estimated from historical task order" : "Date this task entered this person's workload"} style={{ padding: "8px", borderBottom: "1px solid var(--border)", textAlign: "center", color: entry.estimated ? "var(--muted)" : "var(--accent)", fontWeight: 600, whiteSpace: "nowrap", fontSize: 12 }}>{formatWorkloadDate(entry)}</td>
                                        {detailDayStats.map((ds) => {
                                          const value = taskValueForDate(detailPerson, t, ds.dateStr);
                                          return (
                                            <td
                                              key={ds.dateStr}
                                              onClick={() => setSelectedCell({ personId: detailPerson.id, dateStr: ds.dateStr })}
                                              style={{ textAlign: "center", padding: "8px 5px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: selectedCell?.personId === detailPerson.id && selectedCell?.dateStr === ds.dateStr ? "rgba(59,130,246,.08)" : undefined, color: value > 0 ? "var(--navy)" : "var(--muted)", fontWeight: value > 0 ? 700 : 500 }}
                                            >
                                              {value > 0 ? `${value.toFixed(1)}h` : "–"}
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {detailTab === "pipeline" && (
                  <div style={{ maxWidth: "none" }}>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--navy)" }}>Pipeline sequence</div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3 }}>
                        Work contributing to the selected period, shown in the order it entered {detailPerson.name}'s workload. Completed work remains available in historical periods but is excluded from future planning once it no longer consumes capacity.
                      </div>
                    </div>
                    {detailSelectedWeekStats && (
                      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                        <div style={{ padding: "10px 13px", border: "1px solid var(--border)", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>Selected week capacity</div><div style={{ fontSize: 15, fontWeight: 600, color: "var(--navy)" }}>{detailSelectedWeekStats.availableHours.toFixed(1)}h</div></div>
                        <div style={{ padding: "10px 13px", border: "1px solid var(--border)", borderRadius: 10 }}><div style={{ fontSize: 11, color: "var(--muted)" }}>Planned this week</div><div style={{ fontSize: 15, fontWeight: 600, color: "var(--navy)" }}>{detailSelectedWeekStats.plannedHours.toFixed(1)}h</div></div>
                      </div>
                    )}
                    {pipelineRows.length === 0 ? (
                      <div style={{ padding: 18, border: "1px dashed var(--border)", borderRadius: 10, color: "var(--muted)", fontSize: 12.5 }}>No scoped tasks contribute hours to the selected period.</div>
                    ) : (
                      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "56px minmax(240px,1fr) 120px 105px 130px 150px 125px", gap: 10, padding: "8px 12px", background: "var(--hover-bg)", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Seq.</div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Task</div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Status</div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "right" }}>Scoped Hours</div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Date Assigned</div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Week Coverage</div><div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textAlign: "right" }}>Selected Impact</div>
                        </div>
                        {pipelineRows.map((row, idx) => {
                          const project = projects.find((p) => p.id === row.task.project_id);
                          const crossed = row.cumulativePct > 100 && (idx === 0 || pipelineRows[idx - 1].cumulativePct <= 100);
                          const tone = taskStatusTone(row.task.status);
                          return (
                            <div key={row.task.id} style={{ display: "grid", gridTemplateColumns: "56px minmax(240px,1fr) 120px 105px 130px 150px 125px", gap: 10, padding: "10px 12px", alignItems: "center", borderBottom: "1px solid var(--border)", background: crossed ? "rgba(210,55,55,.045)" : "var(--surface)" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: crossed ? "var(--danger)" : "var(--accent)" }} /><span style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)" }}>{idx + 1}</span></div>
                              <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.task.name}</div><div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{project?.name ?? "No project"}</div>{crossed && <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: "var(--danger)" }}>First task taking selected-week task allocation above capacity.</div>}</div>
                              <div><span style={{ display: "inline-flex", padding: "4px 7px", borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>{row.task.status ?? "—"}</span></div>
                              <div style={{ textAlign: "right", fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>{(row.task.estimated_hours ?? 0).toFixed(1)}h</div>
                              <div title={row.entry.estimated ? "Estimated from historical task order" : undefined} style={{ fontSize: 12, fontWeight: 600, color: row.entry.estimated ? "var(--muted)" : "var(--accent)", whiteSpace: "nowrap" }}>{formatWorkloadDate(row.entry)}</div>
                              <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{row.task.start_date ? parseLocalDate(row.task.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"} – {row.task.current_due_date ? parseLocalDate(row.task.current_due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</div>
                              <div style={{ textAlign: "right" }}><div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>+{row.weekHours.toFixed(1)}h</div><div style={{ fontSize: 11, color: row.cumulativePct > 100 ? "var(--danger)" : "var(--muted)", marginTop: 2 }}>{displayPct(row.cumulativePct)}% cumulative</div></div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 7, marginTop: 10, padding: 10, borderRadius: 10, background: "var(--hover-bg)", fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}><Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />Pipeline sequence is based on task allocation for the selected week. PM overhead is shown separately in Capacity Mix and is attributed to each project's project type; it is not used to decide which task first pushed task allocation over capacity.</div>
                  </div>
                )}
              </div>

              {selectedCell?.personId === detailPerson.id && selectedPerson && detailTab === "timeline" && (
                <div style={{ borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>{parseLocalDate(selectedCell.dateStr).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>Selected utilization day</div>
                    </div>
                    <button onClick={() => setSelectedCell(null)} title="Close day details" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}><X size={14} /></button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
                    {selectedPct > 100 ? <AlertTriangle size={15} style={{ color: "var(--danger)" }} /> : <Gauge size={15} style={{ color: "var(--accent)" }} />}
                    <span style={{ fontSize: 22, fontWeight: 600, color: selectedPct > 100 ? "var(--danger)" : "var(--navy)" }}>{displayPct(selectedPct)}%</span>
                    <span style={{ fontSize: 9.5, color: "var(--muted)" }}>{selectedAllocated.toFixed(1)}h / {selectedCapacity.toFixed(1)}h</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 14 }}>
                    <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", textAlign: "center" }}><div style={{ fontSize: 12, fontWeight: 600 }}>{selectedCapacity.toFixed(1)}h</div><div style={{ fontSize: 9, color: "var(--muted)" }}>Capacity</div></div>
                    <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", textAlign: "center" }}><div style={{ fontSize: 12, fontWeight: 600 }}>{selectedAllocated.toFixed(1)}h</div><div style={{ fontSize: 9, color: "var(--muted)" }}>Allocated</div></div>
                    <div style={{ padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", textAlign: "center" }}><div style={{ fontSize: 12, fontWeight: 600, color: selectedAllocated > selectedCapacity ? "var(--danger)" : "var(--success)" }}>{selectedAllocated > selectedCapacity ? "+" : ""}{(selectedAllocated - selectedCapacity).toFixed(1)}h</div><div style={{ fontSize: 9, color: "var(--muted)" }}>{selectedAllocated > selectedCapacity ? "Over" : "Remaining"}</div></div>
                  </div>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)", marginBottom: 6 }}>Work contributing to this day</div>
                  {selectedContributions.map((r, i) => (
                    <div key={r.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i + 1}. {r.label}</div>
                          <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{r.projectName}</div>
                          <div style={{ fontSize: 9.5, color: "var(--accent)", marginTop: 2 }}>Added {formatWorkloadDate(r.entry)}</div>
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 600 }}>{r.hours.toFixed(1)}h</div>
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
