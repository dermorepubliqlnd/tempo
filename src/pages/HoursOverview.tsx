import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon, Download, ArrowDown, ArrowUp } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useSearchParams } from "react-router-dom";
import { buildHolidaySet } from "../lib/workingDays";
import { expectedHoursForDay } from "../lib/dailyAllocation";
import { loggedHoursTier, LOGGED_HOURS_LEGEND } from "../lib/loggedHoursBands";
import { TASK_STATUS_GROUPED, statusGroupOf } from "../lib/notionOptions";
import { ownTimeLogStatusFor, TIME_LOG_STATUS_LABEL, TIME_LOG_STATUS_TONE, formatHours, type TimeLogStatus } from "../lib/timeTracking";
import { timingOf, timingRank } from "../lib/taskTiming";
import { toCsv } from "../lib/csv";
import { formatDate } from "../lib/formatDate";
import Modal from "../components/Modal";
import DataTable from "../components/DataTable";
import { useTableViews } from "../lib/useTableViews";
import { sortRows, type ColumnDef, type GroupOption, type SortOption } from "../lib/tableTypes";
// Same shared allocation engine Utilization.tsx and WbsPlanning.tsx's
// Utilization snapshot use -- see src/lib/dailyAllocation.ts. Before this,
// "Scoped" here was a thinner, drifting copy: no PM overhead, no Time Off,
// no ownership/assignee history, no deletion archive, and a holiday-blind
// day spread. It could not agree with Utilization for anyone who owns a
// project or has a day off.
import {
  createAllocationEngine,
  parentTaskIdsOf,
  type AssigneeHistoryRow,
  type OwnerHistoryRow,
  type UtilProjectRow,
  type UtilTaskRow,
} from "../lib/dailyAllocation";
import UtilPersonFilterButton from "../components/UtilPersonFilterButton";

// Scoped vs Logged (2026-08-25, consolidated same day). Originally shipped
// alongside a separate "Work Schedule" page (Logged tab + Scoped tab).
// Sandra pointed out the overlap was worse than it looked: "Scoped" was
// already a thinner copy of what Utilization.tsx computes (Utilization
// adds PM overhead + ownership-history + archived-hours on top of the
// same per-task spread math), and Work Schedule's two single-metric tabs
// were just this page's Day view pulled apart. Utilization stays
// untouched as the person-level capacity-% view. This page absorbed
// Work Schedule entirely and became the two things nothing else covers:
// a day-by-day Scoped-vs-Logged breakdown per task (this Day view, now
// built like Utilization's expandable person->task rows instead of a flat
// grid), and a whole-task planned-vs-actual comparison (Per task view).
//
// Key behavior Sandra called out explicitly: logged hours are bucketed by
// the literal date they were logged on, independent of the task's scoped
// window. A task scoped for 3 days that someone actually works on 2 days
// later still shows "– / {logged}h" on that later date -- scoped and
// logged are computed independently per day, then just displayed together.

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
  is_archived: boolean;
  owner_id: string | null;
  start_date: string | null;
  end_date: string | null;
  wbs_status: string | null;
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
  // Phase 67 (2026-09-23): sequential Task ID, see supabase/phase67_migration.sql.
  task_number: number;
  // Phase 71 (2026-09-23, Sandra: "add task due date and timing in the
  // per tasks view") -- feeds timingOf()/lib/taskTiming.ts, same fields
  // Projects.tsx's Tasks list already fetches for its own Timing column.
  submitted_on: string | null;
  validated_completion_date: string | null;
  actual_completion_date: string | null;
}
interface TimeEntryRow {
  id: string;
  // 2026-09-22: null on a non-project entry (Meeting/Admin/Coaching/etc.
  // logged via the Activity Type picker instead of a task) -- see
  // activity_type below.
  task_id: string | null;
  activity_type_id: string | null;
  activity_type?: { id: string; name: string } | null;
  person_id: string;
  started_at: string;
  duration_minutes: number | null;
  status: "running" | "pending_confirm" | "confirmed" | "pending_approval" | "approved" | "rejected";
  // 2026-09-23: needed for the Per Task view's time-log breakdown modal
  // (Sandra: "clicking on logged hours shows the breakdown of all time
  // logs") -- Timer vs Manual vs Legacy pill, same as Projects.tsx's own
  // Time Spent modal.
  source: "timer" | "manual" | "legacy";
}
interface HolidayRow {
  id: string;
  date: string;
  name: string;
  category: "legal_ph" | "local" | "internal";
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

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
// Per Task view (DataTable) default column order -- Task ID first per
// Sandra's ask (2026-09-23: "put the task ID as the first column").
const TASK_HOUR_COLUMN_ORDER = ["task_number", "owner", "project", "name", "status", "current_due_date", "timing", "timeLogStatus", "scoped", "logged", "variance"];

const WEEKDAY_LABEL = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const CELL_W = 74;
const LABEL_W = 240;

// Export to Excel buttons (2026-09-23, Sandra) -- same CSV-via-toCsv()
// pattern as MaterialsOutput.tsx's "Export to Excel" button (a real .csv,
// not .xlsx -- Excel opens it natively, no new dependency needed).
const exportBtnStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--navy)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "5px 10px",
  background: "var(--surface)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Daily Activity color coding (2026-09-18, Sandra: "just show the actual
// hours logged daily... color code based on a 7.5 shift, lower be green
// higher be red"; refined 2026-09-23, phase64, into loggedHoursBands.ts's
// 6-tier scale -- see that file for why).

export default function HoursOverview() {
  const { person: me } = useSession();
  const [searchParams] = useSearchParams();
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [ownerHistory, setOwnerHistory] = useState<OwnerHistoryRow[]>([]);
  const [assigneeHistory, setAssigneeHistory] = useState<AssigneeHistoryRow[]>([]);
  const [deletedHours, setDeletedHours] = useState<DeletedHourRow[]>([]);
  // Every person, active or not -- used ONLY to resolve a name in the
  // Per-task view. `people` (active-only) drives the Day grid's rows, so a
  // deactivated person's logged time used to render as owner "Unassigned"
  // there, actively mislabelling real work.
  const [allPeople, setAllPeople] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"grid" | "task">("grid");
  const [expanded, setExpanded] = useState<string[]>([]);

  // 2026-09-03 (Sandra: default to the current month, with date filters
  // instead of a week-count picker -- same change as Utilization.tsx).
  const [rangeStart, setRangeStart] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [rangeEnd, setRangeEnd] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  });
  // 2026-08-26 (Sandra: "allow selection of person to show similar to the
  // utilization snap shot") -- same reusable searchable multi-select
  // already used by WbsPlanning.tsx's Utilization snapshot panel.
  const [personFilter, setPersonFilter] = useState<Set<string> | null>(null);
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
  // Role filter (2026-09-18, Sandra: "add role at the bottom of the name
  // and filter by roles also same as utilization") -- same job_title field
  // and pattern as Utilization.tsx's role filter.
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  // 2026-09-03 (Sandra: retain deactivated people's data, but let me
  // choose active-only vs show-all in the view). Deactivated people's
  // logged/scoped hours were never deleted -- this only controls
  // whether their row/name is DISPLAYED here, same "nothing is ever
  // silently lost, only hidden by default" convention as everywhere
  // else in the app.
  const [showAllPeople, setShowAllPeople] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [{ data: p }, { data: ap }, { data: pr }, { data: tk }, { data: te }, { data: hol }, { data: av }, { data: ownHist }, { data: assHist }, { data: delHrs }, { data: settings }] =
      await Promise.all([
        supabase.from("people").select("id,name,daily_capacity_hours,is_active,job_title").eq("is_active", true).order("name"),
        supabase.from("people").select("id,name,daily_capacity_hours,is_active,job_title").order("name"),
        supabase.from("projects").select("id,name,is_archived,owner_id,start_date,end_date,wbs_status").eq("is_archived", false),
        supabase
          .from("tasks")
          .select("id,project_id,parent_task_id,name,assignee_id,status,start_date,current_due_date,estimated_hours,is_archived,task_number,submitted_on,validated_completion_date,actual_completion_date")
          .eq("is_archived", false),
        supabase
          .from("time_entries")
          .select("id,task_id,activity_type_id,person_id,started_at,duration_minutes,status,source,activity_type:non_project_activity_types ( id, name )")
          .in("status", ["confirmed", "approved"])
          .eq("is_archived", false),
        supabase.from("holidays").select("*"),
        supabase.from("person_availability").select("person_id,date,status"),
        supabase.from("project_owner_history").select("project_id,person_id,effective_from,effective_to"),
        supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to"),
        supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
        supabase.from("app_settings").select("historical_locking_enabled").eq("id", true).single(),
      ]);
    setPeople((p as PersonRow[]) ?? []);
    setAllPeople((ap as PersonRow[]) ?? []);
    setProjects((pr as ProjectRow[]) ?? []);
    setTasks((tk as TaskRow[]) ?? []);
    setTimeEntries(((te as unknown as TimeEntryRow[]) ?? []));
    setHolidays((hol as HolidayRow[]) ?? []);
    setAvailability((av as AvailabilityRow[]) ?? []);
    // Same global off-switch Utilization.tsx honours (app_settings
    // .historical_locking_enabled): while off, history is ignored and
    // attribution falls back to each row's CURRENT owner/assignee. Reading
    // it here too is what keeps the two pages attributing a transferred
    // task/project to the SAME person on the same past date.
    const historicalLockingEnabled = (settings as { historical_locking_enabled?: boolean } | null)?.historical_locking_enabled ?? false;
    setOwnerHistory(historicalLockingEnabled ? (ownHist as OwnerHistoryRow[]) ?? [] : []);
    setAssigneeHistory(historicalLockingEnabled ? (assHist as AssigneeHistoryRow[]) ?? [] : []);
    setDeletedHours((delHrs as DeletedHourRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

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

  // Same paging/reset/date-filter helpers as Utilization.tsx -- see that
  // file's comment for the reasoning (page by the range's own width, not
  // an unrelated fixed week count).
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
  // Utilization snapshot panel and Utilization.tsx's main grid). Today is
  // the first column in this grid by design (weekOffset 0 anchors to
  // today), so it's the one most likely to sit out of view at a narrower
  // viewport/zoom with no visible cue that there's more to scroll to.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = gridScrollRef.current;
    if (!el) return;
    const todayIso = toISO(todayRaw);
    const idx = days.findIndex((d) => toISO(d) === todayIso);
    if (idx === -1) return;
    const targetLeft = LABEL_W + idx * CELL_W;
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
    if (targetLeft >= viewStart && targetLeft + CELL_W <= viewEnd) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const desired = targetLeft - el.clientWidth / 2 - LABEL_W / 2 + CELL_W / 2;
    el.scrollLeft = Math.max(0, Math.min(desired, maxScroll));
  }, [days]);

  const scopedPeople = showAllPeople ? allPeople : people;
  const roleOptions = useMemo(
    () => Array.from(new Set(allPeople.map((p) => p.job_title).filter((r): r is string => !!r))).sort((a, b) => a.localeCompare(b)),
    [allPeople]
  );
  const visiblePeople = scopedPeople
    .filter((p) => !personFilter || personFilter.has(p.id))
    .filter((p) => !roleFilter || p.job_title === roleFilter);

  const holidayByDate = useMemo(() => {
    const m = new Map<string, HolidayRow>();
    holidays.forEach((h) => m.set(h.date, h));
    return m;
  }, [holidays]);

  const parentTaskIds = useMemo(() => parentTaskIdsOf(tasks), [tasks]);
  const holidaySet = useMemo(() => buildHolidaySet(holidays.map((h) => h.date)), [holidays]);
  const today = useMemo(() => toISO(new Date()), []);

  // The one shared allocation engine (identical construction to
  // Utilization.tsx's). Scoped = exactly what the Utilization page counts
  // as a person's planned hours on that day: open leaf tasks spread over
  // real working days, plus PM overhead for every project they own, plus
  // any archived hours from permanently-deleted work.
  const engine = useMemo(
    () =>
      createAllocationEngine({
        tasks: tasks as UtilTaskRow[],
        projects: projects as UtilProjectRow[],
        holidays: holidaySet,
        availability,
        assigneeHistory,
        ownerHistory,
        todayStr: today,
        deletedHours,
      }),
    [tasks, projects, holidaySet, availability, assigneeHistory, ownerHistory, today, deletedHours]
  );

  function isOffDay(personId: string, dateStr: string): boolean {
    return availability.some((a) => a.person_id === personId && a.date === dateStr && a.status === "off");
  }

  // 2026-09-23 (dynamic expected hours): full status lookup, not just
  // the off/not-off boolean above -- needed to tell a half-day (reduced
  // expected hours) apart from a regular day when banding logged hours.
  function availabilityStatusFor(personId: string, dateStr: string): "off" | "half_day" | undefined {
    return availability.find((a) => a.person_id === personId && a.date === dateStr)?.status;
  }

  // Scoped side: every non-parent task currently assigned to this person,
  // open or Done -- mirrors Utilization.tsx's own openTasksFor, fixed
  // 2026-09-03 (Sandra: a Done task's real historical hours must still
  // have a sub-row to explain them, not just vanish from the breakdown
  // the moment it's completed; scopedHoursFor below already reads the
  // shared engine's date-gated value, so a Done task's row here correctly
  // shows its real past hours and 0 from today forward).
  function scopedOpenTasksFor(personId: string): TaskRow[] {
    return tasks.filter((t) => t.assignee_id === personId && !parentTaskIds.has(t.id));
  }
  function ownedProjectsFor(personId: string): ProjectRow[] {
    return projects.filter((p) => p.owner_id === personId);
  }
  // 2026-08-31: now includes PM overhead and the deletion archive, so this
  // number is the SAME number Utilization.tsx prints for the same person on
  // the same day. Both extras get their own visible sub-row in the expanded
  // breakdown below, so the difference from the raw task sum is explained on
  // screen rather than unexplained.
  function scopedPersonTotalFor(personId: string, dateStr: string): number {
    return engine.totalFor(personId, dateStr);
  }
  // Logged side: every confirmed/approved entry this person has, bucketed
  // by the literal date it was logged on -- deliberately NOT filtered to
  // the task's scoped window or current assignment/status, so time logged
  // outside a task's plan (or after reassignment/completion) still shows.
  function loggedPersonTotalFor(personId: string, dateStr: string): number {
    return timeEntries
      .filter((e) => e.person_id === personId && e.started_at.slice(0, 10) === dateStr)
      .reduce((sum, e) => sum + (e.duration_minutes ?? 0) / 60, 0);
  }
  // 2026-09-22: item.taskId is either a real task id, or a synthetic
  // "np:<activity_type_id>" key for a non-project sub-row (see
  // combinedSubItemsFor below) -- route to the matching entries either way.
  function loggedHoursFor(personId: string, taskId: string, dateStr: string): number {
    const npId = taskId.startsWith("np:") ? taskId.slice(3) : null;
    return timeEntries
      .filter((e) =>
        e.person_id === personId &&
        e.started_at.slice(0, 10) === dateStr &&
        (npId ? e.activity_type_id === npId : e.task_id === taskId)
      )
      .reduce((sum, e) => sum + (e.duration_minutes ?? 0) / 60, 0);
  }
  // 2026-08-26 bugfix, UPDATED 2026-09-03: originally made to agree with
  // scopedPersonTotalFor once a task went Done (both used to zero out
  // completed tasks unconditionally). That blanket zeroing was itself
  // fixed 2026-09-03 (Sandra: zeroing a Done task erases real historical
  // utilization) -- the shared engine's taskHoursOnDate now only zeroes a
  // Done task from TODAY forward, so this cell and scopedPersonTotalFor
  // still agree (both call the same engine), but a Done task's PAST days
  // correctly show real hours again instead of always reading "–".
  function scopedHoursFor(personId: string, taskId: string, dateStr: string): number {
    const t = tasks.find((x) => x.id === taskId && x.assignee_id === personId);
    if (!t) return 0;
    if (parentTaskIds.has(t.id)) return 0;
    return engine.taskHoursOnDate(personId, t as UtilTaskRow, dateStr);
  }

  // Combined per-task breakdown for a person's expand row: union of their
  // open scoped-eligible tasks AND any task they've logged time against
  // (even if reassigned, completed, or archived since) -- otherwise a
  // logged entry on a task that no longer meets the "scoped" filter would
  // just vanish from the breakdown instead of showing up as "– / Xh".
  function combinedSubItemsFor(personId: string): { taskId: string; label: string; project?: string }[] {
    const byId = new Map<string, { taskId: string; label: string; project?: string }>();
    scopedOpenTasksFor(personId).forEach((t) => {
      const proj = projects.find((p) => p.id === t.project_id);
      byId.set(t.id, { taskId: t.id, label: t.name, project: proj?.name });
    });
    timeEntries
      .filter((e) => e.person_id === personId)
      .forEach((e) => {
        // 2026-09-22: a non-project entry (task_id null, activity_type_id
        // set) used to fall through to the task lookup below, which always
        // missed and mislabeled every one of them "Deleted/archived task"
        // -- bucket these separately, by activity type, instead.
        if (e.activity_type_id) {
          const key = `np:${e.activity_type_id}`;
          if (byId.has(key)) return;
          byId.set(key, { taskId: key, label: e.activity_type?.name ?? "Non-project", project: "Non-project" });
          return;
        }
        if (!e.task_id || byId.has(e.task_id)) return;
        const t = tasks.find((x) => x.id === e.task_id);
        const proj = t ? projects.find((p) => p.id === t.project_id) : undefined;
        byId.set(e.task_id, { taskId: e.task_id, label: t?.name ?? "Deleted/archived task", project: proj?.name });
      });
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  // Per-task flat comparison (whole-task totals, not windowed to the
  // visible date range) -- unchanged from the original Overview build.
  const taskRows = useMemo(() => {
    return tasks
      .filter((t) => !parentTaskIds.has(t.id))
      .map((t) => {
        const proj = projects.find((p) => p.id === t.project_id);
        // Resolve against ALL people, not just active ones -- a deactivated
        // assignee used to fall through to "Unassigned" here, which reads as
        // orphaned work when it is actually assigned (just to someone who
        // has left/been deactivated).
        const owner = allPeople.find((p) => p.id === t.assignee_id);
        const scoped = t.estimated_hours ?? 0;
        const logged = timeEntries.filter((e) => e.task_id === t.id).reduce((sum, e) => sum + (e.duration_minutes ?? 0) / 60, 0);
        return {
          id: t.id,
          name: t.name,
          taskNumber: t.task_number,
          projectId: t.project_id,
          project: proj?.name ?? "—",
          ownerId: t.assignee_id,
          owner: owner ? (owner.is_active ? owner.name : `${owner.name} (inactive)`) : "Unassigned",
          status: t.status,
          dueDate: t.current_due_date,
          timing: timingOf(t, statusGroupOf(TASK_STATUS_GROUPED, t.status)),
          timeLogStatus: ownTimeLogStatusFor(timeEntries, t.id),
          scoped,
          logged,
          variance: logged - scoped,
        };
      })
      .filter((r) => r.scoped > 0 || r.logged > 0);
  }, [tasks, projects, allPeople, timeEntries, parentTaskIds]);

  // 2026-08-26 (Sandra: "allow grouping and filtering by person and by
  // project") -- both single-select dropdowns; kept simple (one active
  // filter/group at a time) rather than the Day view's multi-select
  // UtilPersonFilterButton, since this table is a flat list where a
  // single active group/filter reads more clearly than a checklist.
  const [taskFilterPersonId, setTaskFilterPersonId] = useState<string>("");
  const [taskFilterProjectId, setTaskFilterProjectId] = useState<string>("");
  // 2026-09-23 (Sandra: "allow search for task ID") -- matches either the
  // task's name or its "T-0007" id, case-insensitively, substring or
  // exact-number.
  const [taskSearch, setTaskSearch] = useState("");
  // 2026-09-23 (Sandra: "clicking on logged hours shows the breakdown of
  // all time logs") -- same modal pattern as Projects.tsx's Spent Hrs
  // cell (setHoursBreakdownTaskId), just scoped to THIS view's own rows
  // (leaf tasks only, own entries -- no parent/child rollup here).
  const [breakdownTaskId, setBreakdownTaskId] = useState<string | null>(null);

  const filteredTaskRows = useMemo(() => {
    return taskRows.filter(
      (r) => (!taskFilterPersonId || r.ownerId === taskFilterPersonId) && (!taskFilterProjectId || r.projectId === taskFilterProjectId)
    );
  }, [taskRows, taskFilterPersonId, taskFilterProjectId]);

  const searchedTaskRows = useMemo(() => {
    const q = taskSearch.trim().toLowerCase();
    if (!q) return filteredTaskRows;
    return filteredTaskRows.filter((r) => {
      const idStr = `T-${String(r.taskNumber).padStart(4, "0")}`.toLowerCase();
      return r.name.toLowerCase().includes(q) || idStr.includes(q) || String(r.taskNumber).includes(q);
    });
  }, [filteredTaskRows, taskSearch]);

  // 2026-09-23 (Sandra: "allow rearranging of columns and resizing") --
  // reuses the same DataTable/useTableViews machinery Projects.tsx uses
  // for the Tasks/Projects lists (drag a header to reorder, drag its
  // right edge to resize, both persisted per-person via person_table_
  // views) instead of hand-rolling a second copy of that logic. This view
  // keeps its own simple Sort by/Group by/Team Member/Project selects
  // (below) rather than pulling in ViewSettingsMenu/ViewFilterPills --
  // those add board/timeline/status-filter machinery this flat, single-
  // table view doesn't need; they just write into the same `sorts`/
  // `groupBy` fields on the view DataTable already reads.
  const taskHourViews = useTableViews("hours_overview_per_task", me?.id, {
    viewType: "table",
    columnOrder: TASK_HOUR_COLUMN_ORDER,
    // Phase 71 (2026-09-23): Due/Timing columns added -- bump so anyone
    // who already saved a column order from this view's first release
    // (run #436/437) picks up the two new columns instead of never
    // seeing them, same convention as Projects.tsx's TASK_COLUMN_ORDER
    // version bumps.
    columnOrderVersion: 1,
    hiddenColumns: [],
    columnWidths: {},
    groupBy: null,
    hiddenGroups: [],
    color: "neutral",
    showCount: false,
    sorts: [{ key: "variance", direction: "desc" }],
  });

  const taskHourSortOptions: SortOption<TaskHourRowData>[] = [
    { key: "variance", label: "Variance (largest first)", getValue: (r) => Math.abs(r.variance) },
    { key: "scoped", label: "Scoped hours", getValue: (r) => r.scoped },
    { key: "logged", label: "Logged hours", getValue: (r) => r.logged },
    { key: "name", label: "Task name", getValue: (r) => r.name },
    { key: "current_due_date", label: "Due date", getValue: (r) => (r.dueDate ? new Date(r.dueDate).getTime() : null) },
    { key: "timing", label: "Timing", getValue: (r) => timingRank(r.timing.label) },
  ];

  const taskHourGroupOptions: GroupOption<TaskHourRowData>[] = [
    { key: "person", label: "Team Member", getGroup: (r) => r.owner },
    { key: "project", label: "Project", getGroup: (r) => r.project },
  ];

  const taskHourColumns: ColumnDef<TaskHourRowData>[] = [
    {
      key: "task_number",
      label: "Task ID",
      defaultWidth: 90,
      maxWidth: 110,
      alwaysVisible: true,
      render: (r) => <span style={{ color: "var(--text-secondary)", fontSize: 11.5 }}>T-{String(r.taskNumber).padStart(4, "0")}</span>,
    },
    { key: "owner", label: "Team Member", defaultWidth: 150, render: (r) => <span style={{ color: "var(--text-secondary)" }}>{r.owner}</span> },
    { key: "project", label: "Project", defaultWidth: 150, render: (r) => <span style={{ color: "var(--text-secondary)" }}>{r.project}</span> },
    { key: "name", label: "Task", defaultWidth: 220, render: (r) => <span>{r.name}</span> },
    {
      key: "status",
      label: "Status",
      defaultWidth: 110,
      render: (r) =>
        r.status ? (
          <span className={`status-pill ${taskStatusTone(statusGroupOf(TASK_STATUS_GROUPED, r.status))}`} style={{ fontSize: 11 }}>
            {r.status}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "current_due_date",
      label: "Due",
      defaultWidth: 100,
      render: (r) => <span style={{ color: "var(--text-secondary)", fontSize: 11.5 }}>{formatDate(r.dueDate)}</span>,
    },
    {
      key: "timing",
      label: "Timing",
      defaultWidth: 110,
      render: (r) => <span className={`status-pill ${r.timing.tone}`} style={{ fontSize: 11 }}>{r.timing.label}</span>,
    },
    {
      key: "timeLogStatus",
      label: <span title="Whether every logged time entry for this task has been confirmed/approved, or is still pending">Time Log Status</span>,
      plainLabel: "Time Log Status",
      defaultWidth: 130,
      render: (r) => (
        <span className={`status-pill ${TIME_LOG_STATUS_TONE[r.timeLogStatus]}`} style={{ fontSize: 11 }}>
          {TIME_LOG_STATUS_LABEL[r.timeLogStatus]}
        </span>
      ),
    },
    {
      key: "scoped",
      label: "Scoped",
      defaultWidth: 90,
      render: (r) => <div style={{ textAlign: "right" }}>{r.scoped.toFixed(2)}h</div>,
    },
    {
      key: "logged",
      label: "Logged",
      defaultWidth: 90,
      alwaysVisible: true,
      render: (r) => (
        <div style={{ textAlign: "right" }}>
          <button
            onClick={() => setBreakdownTaskId(r.id)}
            title="See the individual time logs behind this total"
            disabled={r.logged === 0}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              color: r.logged > 0 ? "var(--accent)" : "inherit",
              cursor: r.logged > 0 ? "pointer" : "default",
              textDecoration: r.logged > 0 ? "underline" : "none",
              textDecorationColor: r.logged > 0 ? "var(--border)" : undefined,
              textUnderlineOffset: 2,
            }}
          >
            {r.logged.toFixed(2)}h
          </button>
        </div>
      ),
    },
    {
      key: "variance",
      label: "Variance",
      defaultWidth: 100,
      render: (r) => {
        const varColor = r.variance > 0.05 ? "var(--danger-text)" : r.variance < -0.05 ? "var(--warning-text)" : "var(--success-text)";
        return (
          <div style={{ textAlign: "right", fontWeight: 600, color: varColor }}>
            {r.variance > 0 ? "+" : ""}
            {r.variance.toFixed(2)}h
          </div>
        );
      },
    },
  ];

  const sortedTaskRows = useMemo(
    () => sortRows(searchedTaskRows, taskHourViews.activeView.sorts, taskHourSortOptions),
    [searchedTaskRows, taskHourViews.activeView.sorts]
  );

  const taskTotals = useMemo(
    () => searchedTaskRows.reduce((acc, r) => ({ scoped: acc.scoped + r.scoped, logged: acc.logged + r.logged }), { scoped: 0, logged: 0 }),
    [searchedTaskRows]
  );

  // Export to Excel (2026-09-23, Sandra) -- exports exactly what's on
  // screen: respects the active Sort by/Group by/Team Member/Project/
  // search filters (built from sortedTaskRows, same rows the table
  // renders), grouping just adds a section label column rather than
  // changing which rows are included.
  function exportTaskCsv() {
    const rows = sortedTaskRows.map((r) => [
      r.owner,
      r.project,
      r.name,
      `T-${String(r.taskNumber).padStart(4, "0")}`,
      r.status ?? "—",
      formatDate(r.dueDate),
      r.timing.label,
      TIME_LOG_STATUS_LABEL[r.timeLogStatus],
      r.scoped.toFixed(2),
      r.logged.toFixed(2),
      r.variance.toFixed(2),
    ]);
    const csv = toCsv(["Team Member", "Project", "Task", "Task ID", "Status", "Due", "Timing", "Time Log Status", "Scoped (h)", "Logged (h)", "Variance (h)"], rows);
    downloadCsv(csv, `productivity_per_task_${toISO(new Date())}.csv`);
  }

  // One row per visible team member x date in the currently selected
  // range/filters, Scoped + Logged both included (Daily Activity's cells
  // only show Logged, but Scoped is already computed either way and is
  // more useful to have in the export than to leave out).
  function exportDailyCsv() {
    const rows: (string | number)[][] = [];
    for (const person of visiblePeople) {
      for (const d of days) {
        const dateStr = toISO(d);
        const scoped = scopedPersonTotalFor(person.id, dateStr);
        const logged = loggedPersonTotalFor(person.id, dateStr);
        if (scoped <= 0 && logged <= 0) continue;
        rows.push([person.name, dateStr, scoped.toFixed(2), logged.toFixed(2)]);
      }
    }
    const csv = toCsv(["Team Member", "Date", "Scoped (h)", "Logged (h)"], rows);
    downloadCsv(csv, `daily_activity_${toISO(rangeStart)}_to_${toISO(rangeEnd)}.csv`);
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
      padding: "5px 3px",
      textAlign: "center",
      borderBottom: "1px solid var(--border)",
      borderLeft: i % 7 === 0 ? "1px solid var(--border)" : undefined,
    };
  }

  if (loading) return <p style={{ padding: 20, color: "var(--muted)" }}>Loading…</p>;

  return (
    <div>
      <h1>Productivity</h1>

      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        <button
          onClick={() => setView("grid")}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: view === "grid" ? "var(--navy)" : "var(--surface)",
            color: view === "grid" ? "#fff" : "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          Daily Activity
        </button>
        <button
          onClick={() => setView("task")}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: view === "task" ? "var(--navy)" : "var(--surface)",
            color: view === "task" ? "#fff" : "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          Per task
        </button>
      </div>

      {view === "grid" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            {/* 2026-09-03 (Sandra: default to the current month, with date
                filters instead of a week-count picker -- same change as
                Utilization.tsx). Prev/Next now shift by the current
                range's own span, "This month" resets to the calendar
                month, and From/To date inputs let her pick any range. */}
            <button
              onClick={() => shiftRange(-1)}
              className="planner-nav-btn"
              disabled={isAtEarliestAnchor}
              title={isAtEarliestAnchor ? "Can't go earlier than Jan 2026" : "Previous range"}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={resetToCurrentMonth}
              style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              This month
            </button>
            <button onClick={() => shiftRange(1)} className="planner-nav-btn">
              <ChevronRight size={14} />
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
              From
              <input
                type="date"
                value={toISO(rangeStart)}
                onChange={(e) => setRangeStartFromInput(e.target.value)}
                style={{ fontSize: 12, padding: "3px 6px" }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-secondary)" }}>
              To
              <input
                type="date"
                value={toISO(rangeEnd)}
                onChange={(e) => setRangeEndFromInput(e.target.value)}
                style={{ fontSize: 12, padding: "3px 6px" }}
              />
            </label>
            <UtilPersonFilterButton
              people={scopedPeople}
              selected={personFilter}
              open={personFilterOpen}
              setOpen={setPersonFilterOpen}
              search={personFilterSearch}
              setSearch={setPersonFilterSearch}
              onChange={setPersonFilter}
            />
            <select
              value={showAllPeople ? "all" : "active"}
              onChange={(e) => setShowAllPeople(e.target.value === "all")}
              title="Deactivated team members' past hours are always kept -- this only controls whether they're shown here"
              style={{ fontSize: 12, padding: "4px 6px" }}
            >
              <option value="active">Active team members only</option>
              <option value="all">Show all (incl. deactivated)</option>
            </select>
            {roleOptions.length > 0 && (
              <select
                value={roleFilter ?? "__all__"}
                onChange={(e) => setRoleFilter(e.target.value === "__all__" ? null : e.target.value)}
                title="Filter by role"
                style={{ fontSize: 12, padding: "4px 6px" }}
              >
                <option value="__all__">All roles</option>
                {roleOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            <button onClick={exportDailyCsv} style={{ ...exportBtnStyle, marginLeft: "auto" }}>
              <Download size={13} /> Export to Excel
            </button>
          </div>

          <div ref={gridScrollRef} style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            <table style={{ borderCollapse: "collapse", width: "max-content" }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, zIndex: 2, background: "var(--surface)", width: LABEL_W, minWidth: LABEL_W, borderBottom: "1px solid var(--border)" }} />
                  {weeks.map((week, wi) => (
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
                      Week of {week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </th>
                  ))}
                </tr>
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
              </thead>
              <tbody>
                {visiblePeople.length === 0 ? (
                  <tr>
                    <td colSpan={1 + days.length} style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>
                      {personFilter && personFilter.size === 0
                        ? "No team members selected."
                        : roleFilter
                        ? `No team members with the role "${roleFilter}".`
                        : showAllPeople
                        ? "No team members found."
                        : "No active team members found."}
                    </td>
                  </tr>
                ) : (
                  <Fragment>
                    {visiblePeople.map((person) => {
                      const isExpanded = expanded.includes(person.id);
                      const items = combinedSubItemsFor(person.id);
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
                              onClick={() => setExpanded((prev) => (isExpanded ? prev.filter((id) => id !== person.id) : [...prev, person.id]))}
                            >
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                {isExpanded ? <ChevronDown size={12} /> : <ChevronRightIcon size={12} />}
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
                            {days.map((d, i) => {
                              const dateStr = toISO(d);
                              const dow = d.getDay();
                              const weekend = dow === 0 || dow === 6;
                              const isHoliday = holidayByDate.has(dateStr);
                              const off = isOffDay(person.id, dateStr);
                              const scoped = scopedPersonTotalFor(person.id, dateStr);
                              const logged = loggedPersonTotalFor(person.id, dateStr);
                              // 2026-08-31: holiday / Time Off days are now
                              // labelled the same way Utilization.tsx labels
                              // them, instead of silently reading as a normal
                              // empty day -- the two pages disagreed about a
                              // person's availability on exactly these days.
                              // (Logged time still wins if any exists: someone
                              // really did work, and hiding that was the other
                              // half of the same inconsistency.)
                              if (scoped === 0 && logged === 0 && !weekend && (isHoliday || off)) {
                                return (
                                  <td
                                    key={i}
                                    title={isHoliday ? holidayByDate.get(dateStr)?.name : "Time Off"}
                                    style={{ ...rollupCellStyle(i), background: isHoliday ? "#eef1f5" : "#f1f2f4", color: "var(--muted)", fontSize: 11, fontWeight: 600 }}
                                  >
                                    {isHoliday ? "Holiday" : "Off"}
                                  </td>
                                );
                              }
                              // Daily Activity (2026-09-18, Sandra): show
                              // only the actual logged hours here, color
                              // coded against this person's ACTUAL
                              // expected hours for the day -- a regular
                              // 7.5h day, an approved half-day (reduced),
                              // or 0 on a full-day time off/holiday
                              // (2026-09-23 dynamic-expected-hours fix;
                              // see loggedHoursTier/expectedHoursForDay).
                              const avStatus = availabilityStatusFor(person.id, dateStr);
                              const expectedHours = isHoliday ? 0 : expectedHoursForDay(person, avStatus);
                              const colors = loggedHoursTier(logged, expectedHours);
                              const hasValue = logged > 0;
                              const bg = !hasValue ? (weekend || isHoliday ? "var(--hover-bg)" : undefined) : colors.bg;
                              return (
                                <td key={i} title={avStatus === "half_day" ? "Approved half-day" : undefined} style={{ ...rollupCellStyle(i), background: bg, color: colors.fg, fontSize: 11.5, fontWeight: 600 }}>
                                  {hasValue ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                                      {logged.toFixed(2)}h
                                      {/* 2026-09-23 (Sandra: "show an arrow down after the number if it's
                                          very low, arrow up for significantly above -- visual cue for why
                                          it's colored the way it is") -- Very Low is blue and Significantly
                                          Above is red now (see loggedHoursBands.ts's "red only for high,
                                          blue for low" revision), but the arrows are kept as an extra
                                          at-a-glance cue on both ends regardless of color. */}
                                      {colors.key === "very_low" && <ArrowDown size={10} />}
                                      {colors.key === "excessive" && <ArrowUp size={10} />}
                                    </span>
                                  ) : (
                                    "–"
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                          {isExpanded &&
                            (items.length === 0 ? (
                              <tr>
                                <td
                                  colSpan={1 + days.length}
                                  style={{ padding: "5px 13px 5px 35px", fontSize: 11, color: "var(--muted)", fontStyle: "italic", borderBottom: "1px solid var(--border)" }}
                                >
                                  No logged hours yet.
                                </td>
                              </tr>
                            ) : (
                              items.map((item) => (
                                <tr key={`${person.id}-${item.taskId}`}>
                                  <td
                                    title={item.project ? `${item.label} — ${item.project}` : item.label}
                                    style={{
                                      position: "sticky",
                                      left: 0,
                                      zIndex: 1,
                                      background: "var(--surface)",
                                      padding: "5px 13px 5px 35px",
                                      fontSize: 11,
                                      color: "var(--text-secondary)",
                                      borderBottom: "1px solid var(--border)",
                                      whiteSpace: "nowrap",
                                      maxWidth: LABEL_W,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {item.label}
                                    {item.project && <span style={{ fontSize: 9.5, fontWeight: 600, color: "var(--muted)", marginLeft: 6 }}>{item.project}</span>}
                                  </td>
                                  {days.map((d, i) => {
                                    const dateStr = toISO(d);
                                    const logged = loggedHoursFor(person.id, item.taskId, dateStr);
                                    return (
                                      <td key={i} style={subCellStyle(i)}>
                                        {logged > 0 ? <span style={{ fontSize: 10.5, color: "var(--navy)" }}>{logged.toFixed(2)}h</span> : null}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))
                            ))}
                        </Fragment>
                      );
                    })}
                    <tr>
                      <td
                        style={{
                          position: "sticky",
                          left: 0,
                          zIndex: 1,
                          background: "var(--surface)",
                          padding: "8px 13px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--muted)",
                          borderTop: "1px solid var(--border)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Total
                      </td>
                      {days.map((d, i) => {
                        const dateStr = toISO(d);
                        const logged = visiblePeople.reduce((sum, p) => sum + loggedPersonTotalFor(p.id, dateStr), 0);
                        return (
                          <td key={i} style={{ ...rollupCellStyle(i), borderTop: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>
                            {logged > 0 ? `${logged.toFixed(2)}h` : "–"}
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                )}
              </tbody>
            </table>
          </div>
          {/* 2026-08-26 (Sandra: "can the guide text at the bottom of
              this page show the color coding instead of just text") --
              actual swatches matching the real colors, instead of naming
              them in prose. */}
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: "var(--muted)" }}>
            {LOGGED_HOURS_LEGEND.map(({ range, label, tone }) => (
              <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span className={`status-pill ${tone}`} style={{ fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>
                  {range}
                </span>
                {label}
              </span>
            ))}
            <span>Logged hours always show on the day they were actually worked, even outside a task's scoped window. A 7.5h shift (±1h) is the reference for “Within expected.”</span>
          </div>
        </>
      ) : (
        <>
          {/* 2026-09-23 redesign (Sandra): ported this table onto the
              shared DataTable component (same one Projects.tsx uses for
              Tasks/Projects) so columns can be dragged to reorder and
              resized -- Task ID/Group by/Sort by/filters stay as plain
              controls above it rather than pulling in the full
              ViewSettingsMenu (board/timeline/status-filter machinery
              this flat single-table view doesn't need). */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <input
              type="text"
              value={taskSearch}
              onChange={(e) => setTaskSearch(e.target.value)}
              placeholder="Search task name or ID (e.g. T-0042)"
              style={{ fontSize: 12, padding: "5px 8px", width: 210, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
            />
            <label style={{ fontSize: 12, color: "var(--muted)" }}>Sort by</label>
            <select
              value={taskHourViews.activeView.sorts[0]?.key ?? "variance"}
              onChange={(e) => taskHourViews.updateActiveView({ sorts: [{ key: e.target.value, direction: e.target.value === "name" ? "asc" : "desc" }] })}
              style={{ fontSize: 12, padding: "4px 6px" }}
            >
              {taskHourSortOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <label style={{ fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>Group by</label>
            <select
              value={taskHourViews.activeView.groupBy ?? "none"}
              onChange={(e) => taskHourViews.updateActiveView({ groupBy: e.target.value === "none" ? null : e.target.value })}
              style={{ fontSize: 12, padding: "4px 6px" }}
            >
              <option value="none">None</option>
              {taskHourGroupOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <label style={{ fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>Team Member</label>
            <select value={taskFilterPersonId} onChange={(e) => setTaskFilterPersonId(e.target.value)} style={{ fontSize: 12, padding: "4px 6px" }}>
              <option value="">All team members</option>
              {scopedPeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label style={{ fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>Project</label>
            <select value={taskFilterProjectId} onChange={(e) => setTaskFilterProjectId(e.target.value)} style={{ fontSize: 12, padding: "4px 6px" }}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button onClick={exportTaskCsv} disabled={sortedTaskRows.length === 0} style={{ ...exportBtnStyle, marginLeft: "auto" }}>
              <Download size={13} /> Export to Excel
            </button>
          </div>
          <div className="card" style={{ padding: 0 }}>
          <div className="data-table-dense">
            <DataTable
              columns={taskHourColumns}
              rows={sortedTaskRows}
              rowKey={(r) => r.id}
              view={taskHourViews.activeView}
              onViewChange={taskHourViews.updateActiveView}
              groupOptions={taskHourGroupOptions}
              sortOptions={taskHourSortOptions}
              emptyLabel="No tasks with Scoped or Logged hours yet."
              groupFooterRow={(colSpan, group) => {
                const groupScoped = group.rows.reduce((sum, r) => sum + r.scoped, 0);
                const groupLogged = group.rows.reduce((sum, r) => sum + r.logged, 0);
                return (
                  <>
                    <td colSpan={Math.max(colSpan - 3, 1)} style={{ padding: "6px 13px", fontSize: 11.5, fontWeight: 700, background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                      Subtotal <span style={{ fontWeight: 500, color: "var(--muted)" }}>({group.rows.length})</span>
                    </td>
                    <td style={{ padding: "6px 13px", textAlign: "right", fontSize: 11.5, fontWeight: 700, background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>{groupScoped.toFixed(2)}h</td>
                    <td style={{ padding: "6px 13px", textAlign: "right", fontSize: 11.5, fontWeight: 700, background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>{groupLogged.toFixed(2)}h</td>
                    <td style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }} />
                  </>
                );
              }}
              footerRow={(colSpan) => (
                <>
                  <td colSpan={Math.max(colSpan - 3, 1)} style={{ padding: "8px 13px", fontWeight: 600 }}>
                    Total
                  </td>
                  <td style={{ padding: "8px 13px", textAlign: "right", fontWeight: 600 }}>{taskTotals.scoped.toFixed(2)}h</td>
                  <td style={{ padding: "8px 13px", textAlign: "right", fontWeight: 600 }}>{taskTotals.logged.toFixed(2)}h</td>
                  <td style={{ padding: "8px 13px", textAlign: "right", fontWeight: 600 }}>
                    {(taskTotals.logged - taskTotals.scoped > 0 ? "+" : "") + (taskTotals.logged - taskTotals.scoped).toFixed(2)}h
                  </td>
                </>
              )}
            />
          </div>
          </div>
        </>
      )}

      {breakdownTaskId &&
        (() => {
          const row = taskRows.find((r) => r.id === breakdownTaskId);
          if (!row) return null;
          // 2026-09-23 (Sandra: "clicking on logged hours shows the
          // breakdown of all time logs") -- same shape as Projects.tsx's
          // Time Spent modal (grouped by person, entries in date order,
          // source pill per entry), just scoped to this one task's own
          // entries (this view has no parent/child rollup to combine).
          const entries = timeEntries
            .filter((e) => e.task_id === breakdownTaskId)
            .slice()
            .sort((a, b) => a.started_at.localeCompare(b.started_at));
          const byPerson = new Map<string, typeof entries>();
          for (const e of entries) {
            if (!byPerson.has(e.person_id)) byPerson.set(e.person_id, []);
            byPerson.get(e.person_id)!.push(e);
          }
          const total = entries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0) / 60;
          const sourceTone: Record<string, string> = { timer: "accent", manual: "neutral", legacy: "neutral" };
          const sourceLabel: Record<string, string> = { timer: "Timer", manual: "Manual", legacy: "Legacy" };
          return (
            <Modal title={`Time spent -- ${row.name}`} onClose={() => setBreakdownTaskId(null)}>
              {entries.length === 0 ? (
                <p style={{ fontSize: 12, color: "var(--muted)" }}>No confirmed time logged on this task yet.</p>
              ) : (
                <>
                  {Array.from(byPerson.entries()).map(([personId, personEntries]) => {
                    const personTotal = personEntries.reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0) / 60;
                    return (
                      <div key={personId} style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", borderBottom: "1px solid var(--border)", fontSize: 12.5, fontWeight: 600 }}>
                          <span>{allPeople.find((p) => p.id === personId)?.name ?? "Unknown"}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatHours(personTotal)}h</span>
                        </div>
                        {personEntries.map((e) => (
                          <div key={e.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 11.5, color: "var(--text-secondary)" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {formatDate(e.started_at)}
                              <span className={`status-pill ${sourceTone[e.source] ?? "neutral"}`} style={{ fontSize: 9.5, padding: "1px 5px" }}>
                                {sourceLabel[e.source] ?? e.source}
                              </span>
                            </span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatHours((e.duration_minutes ?? 0) / 60)}h</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 12.5, fontWeight: 700 }}>
                    <span>Total</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatHours(total)}h</span>
                  </div>
                </>
              )}
            </Modal>
          );
        })()}
    </div>
  );
}

type TaskHourRowData = {
  id: string;
  name: string;
  taskNumber: number;
  projectId: string;
  project: string;
  ownerId: string | null;
  owner: string;
  status: string | null;
  dueDate: string;
  timing: { label: string; tone: "success" | "warning" | "danger" | "neutral" };
  timeLogStatus: TimeLogStatus;
  scoped: number;
  logged: number;
  variance: number;
};


// Mirrors Projects.tsx's local statusTone (not exported from there) --
// same 4-bucket grouping (statusGroupOf/TASK_STATUS_GROUPED) so the pill
// color here matches Tasks/Projects exactly.
function taskStatusTone(group: "to_do" | "in_progress" | "complete" | "cancelled" | null): "success" | "warning" | "danger" | "neutral" {
  if (group === "complete") return "success";
  if (group === "in_progress") return "warning";
  if (group === "cancelled") return "danger";
  return "neutral";
}


