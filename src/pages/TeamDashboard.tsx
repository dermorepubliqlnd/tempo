// Team Dashboard -- L&D Executive Dashboard (phase126, 2026-09-30).
// Sandra's 10-part executive brief; built section by section. This pass:
//   Section 1 Portfolio Overview (Reporting Period)
//   Section 2 Executive Operating Summary (mixed time contexts)
// Three time contexts are deliberately NOT unified (see brief s.5):
//   * Reporting Period   -> project counts, scoped hours, logged hours
//   * Forward Horizon    -> planned utilization, available capacity, overallocated (next 2 weeks)
//   * Current state      -> overdue tasks (as of today); Missing Hours = this week
// All utilization / capacity numbers come from the shared allocation engine
// (lib/dailyAllocation.ts) so they can never disagree with the Utilization page.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  Folder,
  CheckCircle2,
  Activity,
  CircleDashed,
  PauseCircle,
  Clock3,
  Users,
  BatteryCharging,
  ClipboardList,
  Timer,
  UserX,
  AlertTriangle,
  Hourglass,
  CalendarRange,
  SlidersHorizontal,
  ChevronDown,
  X,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  ListChecks,
  ClipboardCheck,
  BadgeCheck,
  Flag,
  FileWarning,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { toISO, parseLocalDate, addDays, isWorkingDay, buildHolidaySet } from "../lib/workingDays";
import { createAllocationEngine, dailyCapacityHours, expectedHoursForDay, isOpenTask, type UtilTaskRow, type UtilProjectRow } from "../lib/dailyAllocation";
import { isOverdueSuppressed, type PauseProjectInfo } from "../lib/pause";
import { healthOf, type ProjectRow, type TaskRow } from "./Projects";
import { MonthlyBarChart } from "./Dashboard";
import Modal from "../components/Modal";
import { CATEGORY_TONE_ICON_COLOR } from "../lib/categoryIcons";

// ---------------------------------------------------------------- types
interface Person {
  id: string;
  name: string;
  daily_capacity_hours: number;
  job_title: string | null;
  tracks_time?: boolean | null;
}
interface Lookup {
  id: string;
  name: string;
  color?: string | null;
}
interface Avail {
  person_id: string;
  date: string;
  status: "off" | "half_day";
}
interface Entry {
  person_id: string;
  task_id: string | null;
  started_at: string;
  duration_minutes: number | null;
  status: string;
  is_archived: boolean | null;
}
type PeriodKey = "ytd" | "this_quarter" | "last_quarter" | "this_month" | "last_month" | "custom";
type PopMode = "all" | "role" | "members";
interface MoreFilters {
  owner: string[];
  source: string[];
  planningType: string[];
  projectType: string[];
  category: string[];
  status: string[];
}
const EMPTY_MORE: MoreFilters = { owner: [], source: [], planningType: [], projectType: [], category: [], status: [] };
const HORIZON_DAYS = 14; // "Next 2 weeks"
const PROJECT_STATUSES = ["Not Started", "In Progress", "Paused", "Completed", "Cancelled"];

// ---------------------------------------------------------------- dates
const fmtShort = (iso: string) => parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtLong = (iso: string) => parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function resolvePeriod(key: PeriodKey, custom: { start: string; end: string }, today: Date) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3);
  let s: Date, e: Date, label: string;
  switch (key) {
    case "this_quarter":
      s = new Date(y, q * 3, 1);
      e = new Date(y, q * 3 + 3, 0);
      label = `Q${q + 1} ${y}`;
      break;
    case "last_quarter": {
      const lq = q === 0 ? 3 : q - 1;
      const ly = q === 0 ? y - 1 : y;
      s = new Date(ly, lq * 3, 1);
      e = new Date(ly, lq * 3 + 3, 0);
      label = `Q${lq + 1} ${ly}`;
      break;
    }
    case "this_month":
      s = new Date(y, m, 1);
      e = new Date(y, m + 1, 0);
      label = s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      break;
    case "last_month":
      s = new Date(y, m - 1, 1);
      e = new Date(y, m, 0);
      label = s.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      break;
    case "custom":
      s = parseLocalDate(custom.start);
      e = parseLocalDate(custom.end);
      label = "Custom range";
      break;
    default:
      s = new Date(y, 0, 1);
      e = today;
      label = `YTD ${y}`;
  }
  const start = toISO(s);
  const end = toISO(e);
  // Comparison period: YTD compares to the same Jan 1 -> today window last
  // year; every other period compares to the immediately preceding window
  // of the same length.
  let prevStart: string, prevEnd: string, prevLabel: string;
  if (key === "ytd") {
    prevStart = toISO(new Date(y - 1, 0, 1));
    prevEnd = toISO(new Date(y - 1, today.getMonth(), today.getDate()));
    prevLabel = `vs ${y - 1}`;
  } else {
    const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
    prevEnd = toISO(addDays(s, -1));
    prevStart = toISO(addDays(s, -days));
    prevLabel = "vs prior period";
  }
  // YTD fallback comparison (Sandra 2026-09-30): until Tempo has a full
  // prior year, YTD cards compare quarter-to-date vs the same number of
  // days into last quarter. Switches to the year comparison automatically
  // once prior-year data exists.
  const qStartD = new Date(y, q * 3, 1);
  const lqStartD = new Date(y, q * 3 - 3, 1);
  const elapsed = Math.round((today.getTime() - qStartD.getTime()) / 86400000);
  const lqEndCap = new Date(y, q * 3, 0);
  const lqEndD = addDays(lqStartD, elapsed) > lqEndCap ? lqEndCap : addDays(lqStartD, elapsed);
  const qtd = { curStart: toISO(qStartD), curEnd: toISO(today), prevStart: toISO(lqStartD), prevEnd: toISO(lqEndD), label: "QTD vs last qtr" };
  return { start, end, label, prevStart, prevEnd, prevLabel, qtd };
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = parseLocalDate(start); toISO(d) <= end; d = addDays(d, 1)) out.push(toISO(d));
  return out;
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

const fmtH = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: h >= 100 ? 0 : 1 })}h`;
const pctOf = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

// ---------------------------------------------------------------- tones
const TONES = {
  blue: { bg: "#e5f0fe", fg: "#2f6fed" },
  green: { bg: "#e2f8ea", fg: "#16a34a" },
  indigo: { bg: "#e8ebfd", fg: "#4f5bd5" },
  slate: { bg: "#eef1f5", fg: "#64748b" },
  orange: { bg: "#fdf0e2", fg: "#ea7a16" },
  red: { bg: "#fde4e2", fg: "#dc2626" },
  purple: { bg: "#f0e8fd", fg: "#8b5cf6" },
  teal: { bg: "#dcf7f2", fg: "#0d9488" },
} as const;
type Tone = keyof typeof TONES;

// ================================================================= page
export default function TeamDashboard() {
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date>(new Date());
  const [people, setPeople] = useState<Person[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Avail[]>([]);
  const [ownerHistory, setOwnerHistory] = useState<{ project_id: string; person_id: string; effective_from: string; effective_to: string | null }[]>([]);
  const [assigneeHistory, setAssigneeHistory] = useState<{ task_id: string; person_id: string; effective_from: string; effective_to: string | null }[]>([]);
  const [deletedHours, setDeletedHours] = useState<{ person_id: string; date: string; hours: number }[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  // Needs Attention: pending approvals (current state)
  const [pendingTime, setPendingTime] = useState<{ id: string; person_id: string; task_id: string | null; created_at: string; entry_number?: number | null }[]>([]);
  const [pendingExt, setPendingExt] = useState<{ id: string; task_id: string; requested_by: string; created_at: string }[]>([]);
  const [pendingBaseline, setPendingBaseline] = useState<{ id: string; project_id: string; requested_at: string }[]>([]);
  const [pendingClosure, setPendingClosure] = useState<{ id: string; project_id: string; requested_at: string }[]>([]);
  // Site Settings > Time tracking start date (phase126c): expected hours are
  // only counted from this date, so pre-go-live months don't read as missing.
  const [trackingStart, setTrackingStart] = useState<string>("2026-08-03");
  const [lookups, setLookups] = useState<{ sources: Lookup[]; planningTypes: Lookup[]; projectTypes: Lookup[]; categories: Lookup[]; phases: Lookup[] }>({ sources: [], planningTypes: [], projectTypes: [], categories: [], phases: [] });

  // filters
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const todayIso = toISO(today);
  const [period, setPeriod] = useState<PeriodKey>("ytd");
  const [custom, setCustom] = useState({ start: `${today.getFullYear()}-01-01`, end: todayIso });
  const [popMode, setPopMode] = useState<PopMode>("all");
  const [popRoles, setPopRoles] = useState<string[]>([]);
  const [popMembers, setPopMembers] = useState<string[]>([]);
  const [more, setMore] = useState<MoreFilters>(EMPTY_MORE);

  const range = useMemo(() => resolvePeriod(period, custom, today), [period, custom, today]);

  async function load() {
    setLoading(true);
    // Time entries: finalized only, from the earliest date any KPI needs.
    const lastWeekStart = toISO(addDays(today, -((today.getDay() + 6) % 7) - 7));
    const earliest = [range.prevStart, range.start, range.qtd.prevStart, lastWeekStart].sort()[0];
    const [ptRes, peRes, pbRes, pcRes] = await Promise.all([
      supabase.from("time_entries").select("id,person_id,task_id,created_at,entry_number").eq("status", "pending_approval").eq("is_archived", false),
      supabase.from("extension_requests").select("id,task_id,requested_by,created_at").eq("status", "Pending"),
      supabase.from("project_baseline_requests").select("id,project_id,requested_at").eq("status", "pending"),
      supabase.from("project_closure_requests").select("id,project_id,requested_at").eq("status", "pending"),
    ]);
    setPendingTime((ptRes.data as typeof pendingTime) ?? []);
    setPendingExt((peRes.data as typeof pendingExt) ?? []);
    setPendingBaseline((pbRes.data as typeof pendingBaseline) ?? []);
    setPendingClosure((pcRes.data as typeof pendingClosure) ?? []);
    const [pe, pr, tk, hol, av, oh, ah, del, settings, src, pt, prt, cat, phs, te] = await Promise.all([
      supabase.from("people").select("id,name,daily_capacity_hours,job_title,tracks_time").eq("is_active", true).order("name"),
      supabase.from("projects").select("*").eq("is_archived", false),
      fetchAll<TaskRow>((f, t) => supabase.from("tasks").select("*").eq("is_archived", false).range(f, t)),
      supabase.from("holidays").select("date"),
      supabase.from("person_availability").select("person_id,date,status"),
      supabase.from("project_owner_history").select("project_id,person_id,effective_from,effective_to"),
      supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to"),
      supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
      supabase.from("app_settings").select("historical_locking_enabled,time_tracking_start_date").eq("id", true).single(),
      supabase.from("project_sources").select("id,name").order("sort_order"),
      supabase.from("project_planning_types").select("id,name,color").order("sort_order"),
      supabase.from("project_types").select("id,name,color").order("sort_order"),
      supabase.from("project_categories").select("id,name").order("sort_order"),
      supabase.from("project_phases").select("id,name,color").order("sort_order"),
      fetchAll<Entry>((f, t) =>
        supabase
          .from("time_entries")
          .select("person_id,task_id,started_at,duration_minutes,status,is_archived")
          .in("status", ["confirmed", "approved"])
          .eq("is_archived", false)
          .gte("started_at", parseLocalDate(earliest).toISOString())
          .order("started_at")
          .range(f, t)
      ),
    ]);
    const sd = settings.data as { historical_locking_enabled?: boolean; time_tracking_start_date?: string | null } | null;
    const hist = sd?.historical_locking_enabled ?? false;
    if (sd?.time_tracking_start_date) setTrackingStart(sd.time_tracking_start_date.slice(0, 10));
    setPeople((pe.data as Person[]) ?? []);
    setProjects((pr.data as ProjectRow[]) ?? []);
    setTasks(tk);
    setHolidays(((hol.data as { date: string }[]) ?? []).map((h) => h.date.slice(0, 10)));
    setAvailability(((av.data as Avail[]) ?? []).map((a) => ({ ...a, date: a.date.slice(0, 10) })));
    setOwnerHistory(hist ? (oh.data as typeof ownerHistory) ?? [] : []);
    setAssigneeHistory(hist ? (ah.data as typeof assigneeHistory) ?? [] : []);
    setDeletedHours((del.data as typeof deletedHours) ?? []);
    setLookups({
      sources: (src.data as Lookup[]) ?? [],
      planningTypes: (pt.data as Lookup[]) ?? [],
      projectTypes: (prt.data as Lookup[]) ?? [],
      categories: (cat.data as Lookup[]) ?? [],
      phases: (phs.data as Lookup[]) ?? [],
    });
    setEntries(te);
    setUpdatedAt(new Date());
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.prevStart]);

  // ---------------------------------------------------------- population
  const roles = useMemo(() => Array.from(new Set(people.map((p) => p.job_title).filter((r): r is string => !!r))).sort(), [people]);
  const popPeople = useMemo(() => {
    let base = people;
    if (popMode === "role" && popRoles.length) base = people.filter((p) => p.job_title && popRoles.includes(p.job_title));
    else if (popMode === "members" && popMembers.length) base = people.filter((p) => popMembers.includes(p.id));
    return base;
  }, [people, popMode, popRoles, popMembers]);
  const popIds = useMemo(() => new Set(popPeople.map((p) => p.id)), [popPeople]);
  // phase126d: people tagged "not expected to log time" (User management)
  // are left out of expected hours and Missing Hours only.
  const loggers = useMemo(() => popPeople.filter((p) => p.tracks_time !== false), [popPeople]);
  const popIsAll = popPeople.length === people.length;

  // ---------------------------------------------------------- project scope
  const holidaySet = useMemo(() => buildHolidaySet(holidays), [holidays]);
  const holidayDates = useMemo(() => new Set(holidays), [holidays]);
  const parentIds = useMemo(() => new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string)), [tasks]);
  const leafTasks = useMemo(() => tasks.filter((t) => !parentIds.has(t.id)), [tasks, parentIds]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const statusOf = (p: ProjectRow) => (p.wbs_status === "draft" ? "Not Started" : p.status ?? "Not Started");

  // Project-level More Filters only (Role is person-level -> handled by popPeople).
  const moreActive = (Object.keys(more) as (keyof MoreFilters)[]).some((k) => more[k].length > 0);
  // Projects passing More Filters + Population (a project belongs to the
  // population if its owner OR any leaf-task assignee is in it).
  const scopedProjects = useMemo(() => {
    const assigneesByProject = new Map<string, Set<string>>();
    for (const t of leafTasks) {
      if (!t.assignee_id) continue;
      if (!assigneesByProject.has(t.project_id)) assigneesByProject.set(t.project_id, new Set());
      assigneesByProject.get(t.project_id)!.add(t.assignee_id);
    }
    return projects.filter((p) => {
      if (more.owner.length && !more.owner.includes(p.owner_id ?? "")) return false;
      if (more.source.length && !more.source.includes(p.source_id ?? "")) return false;
      if (more.planningType.length && !more.planningType.includes(p.planning_type_id ?? "")) return false;
      if (more.projectType.length && !more.projectType.includes(p.project_type_id ?? "")) return false;
      if (more.category.length && !more.category.includes(p.category ?? "")) return false;
      if (more.status.length && !more.status.includes(statusOf(p))) return false;
      if (!popIsAll) {
        const inPop = (p.owner_id && popIds.has(p.owner_id)) || Array.from(assigneesByProject.get(p.id) ?? []).some((id) => popIds.has(id));
        if (!inPop) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, leafTasks, more, popIds, popIsAll]);
  const scopedProjectIds = useMemo(() => new Set(scopedProjects.map((p) => p.id)), [scopedProjects]);

  // ======================================================== SECTION 1
  const completionDateOf = (p: ProjectRow) => ((p as ProjectRow & { actual_close_date?: string | null }).actual_close_date ?? p.completed_at ?? p.end_date ?? "").slice(0, 10);
  function portfolioFor(start: string, end: string) {
    const completed: ProjectRow[] = [];
    const active: ProjectRow[] = [];
    const notStarted: ProjectRow[] = [];
    const paused: ProjectRow[] = [];
    for (const p of scopedProjects) {
      const s = statusOf(p);
      if (s === "Cancelled") continue;
      if (s === "Completed") {
        const cd = completionDateOf(p);
        if (cd && cd >= start && cd <= end) completed.push(p);
        continue;
      }
      // Open projects: relevant if they had started (or were planned to) by period end.
      if (p.start_date && p.start_date.slice(0, 10) > end) continue;
      if (s === "In Progress") active.push(p);
      else if (s === "Paused") paused.push(p);
      else notStarted.push(p);
    }
    const overdue = active.filter((p) => healthOf(p, tasks, holidayDates).label === "Overdue");
    return { total: completed.length + active.length + notStarted.length + paused.length, completed, active, notStarted, paused, overdue };
  }
  const portfolio = useMemo(() => portfolioFor(range.start, range.end), [scopedProjects, range, tasks, holidayDates]); // eslint-disable-line react-hooks/exhaustive-deps

  // ======================================================== SECTION 2
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
    [tasks, projects, holidaySet, availability, assigneeHistory, ownerHistory, todayIso, deletedHours]
  );
  const taskProject = useMemo(() => new Map(tasks.map((t) => [t.id, t.project_id])), [tasks]);
  const availStatus = useMemo(() => {
    const m = new Map<string, "off" | "half_day">();
    for (const a of availability) m.set(`${a.person_id}|${a.date}`, a.status);
    return m;
  }, [availability]);
  const capacityOn = (p: Person, d: string) => {
    if (!isWorkingDay(parseLocalDate(d), holidaySet)) return 0;
    const st = availStatus.get(`${p.id}|${d}`);
    if (st === "off") return 0;
    return dailyCapacityHours(p, st === "half_day");
  };

  // Forward horizon (next 2 weeks, today inclusive)
  const horizon = useMemo(() => {
    const days = eachDay(todayIso, toISO(addDays(today, HORIZON_DAYS - 1)));
    let planned = 0;
    let cap = 0;
    let available = 0;
    const over: { person: Person; days: number; peak: number }[] = [];
    const under: { person: Person; pct: number; planned: number; cap: number }[] = [];
    // phase126h: "not expected to log time" people are outside delivery capacity.
    for (const p of loggers) {
      let overDays = 0;
      let peak = 0;
      let pPlanned = 0;
      let pCap = 0;
      for (const d of days) {
        const c = capacityOn(p, d);
        const alloc = c > 0 ? (moreActive ? projectScopedAlloc(p.id, d) : engine.totalFor(p.id, d)) : 0;
        planned += alloc;
        cap += c;
        pPlanned += alloc;
        pCap += c;
        available += Math.max(0, c - alloc);
        const pct = c > 0 ? (alloc / c) * 100 : 0;
        if (pct > 100.5) overDays++;
        if (pct > peak) peak = pct;
      }
      if (overDays > 0) over.push({ person: p, days: overDays, peak });
      if (pCap > 0 && pPlanned / pCap < 0.5) under.push({ person: p, pct: (pPlanned / pCap) * 100, planned: pPlanned, cap: pCap });
    }
    return { planned, cap, available, util: cap > 0 ? (planned / cap) * 100 : 0, over, under, end: days[days.length - 1] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggers, engine, availStatus, holidaySet, todayIso, moreActive, scopedProjectIds]);

  // When project-level More Filters are on, planned load only counts those projects.
  function projectScopedAlloc(personId: string, d: string): number {
    const a = engine.allocationFor(personId, d);
    let sum = 0;
    a.taskHours.forEach((h, taskId) => {
      const pid = taskProject.get(taskId);
      if (pid && scopedProjectIds.has(pid)) sum += h;
    });
    a.pmHours.forEach((h, projectId) => {
      if (scopedProjectIds.has(projectId)) sum += h;
    });
    return sum;
  }

  // Scoped Hours in a window = leaf-task Scoped Hours spread across each
  // task's own working days (same engine spread as Utilization), counting
  // only the days that fall inside the window.
  function scopedHoursIn(start: string, end: string): number {
    let sum = 0;
    for (const t of leafTasks) {
      if (!t.assignee_id || !popIds.has(t.assignee_id) || !scopedProjectIds.has(t.project_id)) continue;
      if (!t.estimated_hours) continue;
      const ut = t as unknown as UtilTaskRow;
      const days = engine.taskDays(t.assignee_id, ut);
      if (!days.size) continue;
      let inWindow = 0;
      days.forEach((d) => {
        if (d >= start && d <= end) inWindow++;
      });
      sum += (Number(t.estimated_hours) * inWindow) / days.size;
    }
    return sum;
  }
  const scoped = useMemo(() => scopedHoursIn(range.start, range.end), [leafTasks, popIds, scopedProjectIds, engine, range]); // eslint-disable-line react-hooks/exhaustive-deps

  // Logged Hours = finalized (Confirmed/Approved, not archived) only.
  const entryDay = (e: Entry) => toISO(new Date(e.started_at)); // local date, never started_at.slice(0,10)
  // Logged hours only count from the Time tracking start date (Sep 1, 2026):
  // August + early-September logs were backfilled manually during the
  // mid-September migration and aren't reliable (Sandra 2026-09-30).
  function loggedIn(startRaw: string, end: string, personFilter?: Set<string>): number {
    const start = startRaw > trackingStart ? startRaw : trackingStart;
    let min = 0;
    for (const e of entries) {
      if (!(personFilter ?? popIds).has(e.person_id)) continue;
      const d = entryDay(e);
      if (d < start || d > end) continue;
      if (moreActive) {
        const pid = e.task_id ? taskProject.get(e.task_id) : null;
        if (!pid || !scopedProjectIds.has(pid)) continue;
      }
      min += e.duration_minutes ?? 0;
    }
    return min / 60;
  }
  const logged = useMemo(() => loggedIn(range.start, range.end), [entries, popIds, range, moreActive, scopedProjectIds, taskProject, trackingStart]); // eslint-disable-line react-hooks/exhaustive-deps
  // Expected hours across the elapsed part of the period (through today).
  const expectedInPeriod = useMemo(() => {
    const end = range.end < todayIso ? range.end : todayIso;
    const start = range.start > trackingStart ? range.start : trackingStart;
    if (start > end) return 0;
    let sum = 0;
    for (const d of eachDay(start, end)) {
      if (!isWorkingDay(parseLocalDate(d), holidaySet)) continue;
      for (const p of loggers) sum += expectedHoursForDay(p, availStatus.get(`${p.id}|${d}`));
    }
    return sum;
  }, [range, todayIso, holidaySet, loggers, availStatus, trackingStart]);

  // Overdue Tasks (current state): open leaf tasks past Target Due Date.
  const overdueTasks = useMemo(
    () =>
      leafTasks.filter((t) => {
        if (!isOpenTask(t) || !t.current_due_date || t.current_due_date.slice(0, 10) >= todayIso) return false;
        if (!scopedProjectIds.has(t.project_id)) return false;
        if (!popIsAll && (!t.assignee_id || !popIds.has(t.assignee_id))) return false;
        const proj = projectById.get(t.project_id);
        if (proj && (statusOf(proj) === "Cancelled" || statusOf(proj) === "Completed")) return false;
        return !isOverdueSuppressed(t, proj as unknown as PauseProjectInfo);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leafTasks, todayIso, scopedProjectIds, popIds, popIsAll, projectById]
  );
  const overdueProjectCount = new Set(overdueTasks.map((t) => t.project_id)).size;

  // Missing Hours: expected minus finalized logged, per person per COMPLETED
  // working day this week (Mon -> yesterday; today is excluded so a mid-day
  // view doesn't count hours people simply haven't logged yet). When no
  // working day has finished yet this week (e.g. Monday), shows last week.
  // Sandra 2026-09-30. My Dashboard keeps its own include-today nudge.
  const missing = useMemo(() => {
    const thisMon = addDays(today, -((today.getDay() + 6) % 7));
    const isWd = (d: string) => isWorkingDay(parseLocalDate(d), holidaySet) && d >= trackingStart;
    const yesterday = toISO(addDays(today, -1));
    let weekStart = toISO(thisMon);
    let days = weekStart <= yesterday ? eachDay(weekStart, yesterday).filter(isWd) : [];
    let label = "This week";
    if (days.length === 0) {
      weekStart = toISO(addDays(thisMon, -7));
      days = eachDay(weekStart, toISO(addDays(thisMon, -1))).filter(isWd);
      label = "Last week";
    }
    const rangeLabel = days.length ? `${fmtShort(days[0])}${days.length > 1 ? ` – ${fmtShort(days[days.length - 1])}` : ""}` : "";
    const loggedByPD = new Map<string, number>();
    for (const e of entries) {
      const d = entryDay(e);
      if (d < weekStart) continue;
      const k = `${e.person_id}|${d}`;
      loggedByPD.set(k, (loggedByPD.get(k) ?? 0) + (e.duration_minutes ?? 0) / 60);
    }
    let total = 0;
    const members: { person: Person; hours: number }[] = [];
    for (const p of loggers) {
      let m = 0;
      for (const d of days) {
        const exp = expectedHoursForDay(p, availStatus.get(`${p.id}|${d}`));
        m += Math.max(0, exp - (loggedByPD.get(`${p.id}|${d}`) ?? 0));
      }
      if (m > 0.1) {
        total += m;
        members.push({ person: p, hours: m });
      }
    }
    return { total, members, weekStart, label, rangeLabel };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, loggers, availStatus, holidaySet, todayIso, trackingStart]);

  // Portfolio Movement: projects started (Start date reached) vs completed
  // (Actual Close Date / completion stamp) per bucket inside the period.
  // Monthly buckets; weekly when the period is 2 months or shorter.
  const movement = useMemo(() => {
    const end = range.end < todayIso ? range.end : todayIso;
    const days = Math.round((parseLocalDate(range.end).getTime() - parseLocalDate(range.start).getTime()) / 86400000) + 1;
    const weekly = days <= 62;
    const buckets: { key: string; label: string; from: string; to: string }[] = [];
    if (weekly) {
      for (let d = parseLocalDate(range.start); toISO(d) <= range.end; d = addDays(d, 7)) {
        const from = toISO(d);
        const toD = addDays(d, 6);
        const to = toISO(toD) > range.end ? range.end : toISO(toD);
        buckets.push({ key: from, label: fmtShort(from), from, to });
      }
    } else {
      const s0 = parseLocalDate(range.start);
      for (let m = new Date(s0.getFullYear(), s0.getMonth(), 1); toISO(m) <= range.end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
        const from = toISO(m) < range.start ? range.start : toISO(m);
        const last = toISO(new Date(m.getFullYear(), m.getMonth() + 1, 0));
        buckets.push({ key: from, label: m.toLocaleDateString("en-US", { month: "short" }), from, to: last > range.end ? range.end : last });
      }
    }
    const started = buckets.map(() => 0);
    const completed = buckets.map(() => 0);
    for (const p of scopedProjects) {
      if (statusOf(p) === "Cancelled") continue;
      const sd = p.start_date?.slice(0, 10);
      if (sd && sd <= end && p.wbs_status !== "draft") {
        const i = buckets.findIndex((b) => sd >= b.from && sd <= b.to);
        if (i >= 0) started[i]++;
      }
      if (statusOf(p) === "Completed") {
        const cd = completionDateOf(p);
        const i = buckets.findIndex((b) => cd >= b.from && cd <= b.to);
        if (i >= 0) completed[i]++;
      }
    }
    return {
      unit: weekly ? "week" : "month",
      buckets: buckets.map(({ key, label }) => ({ key, label })),
      series: [
        { name: "Started", color: "#2f6fed", values: started },
        { name: "Completed", color: "#16a34a", values: completed },
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedProjects, range, todayIso]);

  // ======================================================== WORK MIX
  // Scoped Hours by Planning Type / Project Type, for the Reporting Period
  // (same engine spread as the Scoped Hours figure: leaf tasks only, only
  // the days inside the period). Toggle: active (In Progress) projects only.
  const [mixActiveOnly, setMixActiveOnly] = useState(false);
  const workMix = useMemo(() => {
    const byProject = new Map<string, number>();
    for (const t of leafTasks) {
      if (!t.assignee_id || !popIds.has(t.assignee_id) || !scopedProjectIds.has(t.project_id) || !t.estimated_hours) continue;
      const proj = projectById.get(t.project_id);
      if (!proj || statusOf(proj) === "Cancelled") continue;
      if (mixActiveOnly && statusOf(proj) !== "In Progress") continue;
      const days = engine.taskDays(t.assignee_id, t as unknown as UtilTaskRow);
      if (!days.size) continue;
      let inWin = 0;
      days.forEach((d) => {
        if (d >= range.start && d <= range.end) inWin++;
      });
      if (!inWin) continue;
      byProject.set(t.project_id, (byProject.get(t.project_id) ?? 0) + (Number(t.estimated_hours) * inWin) / days.size);
    }
    const colorFor = (list: Lookup[]) => {
      const used = new Set<string>();
      const m = new Map<string, string>();
      list.forEach((l, i) => {
        let c = l.color && l.color !== "neutral" ? CATEGORY_TONE_ICON_COLOR[l.color] ?? "" : "";
        if (!c || used.has(c)) c = MIX_PALETTE[i % MIX_PALETTE.length];
        used.add(c);
        m.set(l.id, c);
      });
      m.set("__none", "#c7cdd6");
      return m;
    };
    const ptColor = colorFor(lookups.planningTypes);
    const prtColor = colorFor(lookups.projectTypes);
    const plan = new Map<string, number>();
    const ptype = new Map<string, number>();
    const matrix = new Map<string, Map<string, number>>();
    let total = 0;
    byProject.forEach((h, pid) => {
      const p = projectById.get(pid)!;
      const pl = p.planning_type_id ?? "__none";
      const pr = p.project_type_id ?? "__none";
      plan.set(pl, (plan.get(pl) ?? 0) + h);
      ptype.set(pr, (ptype.get(pr) ?? 0) + h);
      if (!matrix.has(pr)) matrix.set(pr, new Map());
      matrix.get(pr)!.set(pl, (matrix.get(pr)!.get(pl) ?? 0) + h);
      total += h;
    });
    const nameOf = (list: Lookup[], id: string) => (id === "__none" ? "Not set" : list.find((l) => l.id === id)?.name ?? "Unknown");
    const segs = (m: Map<string, number>, list: Lookup[], colors: Map<string, string>) =>
      Array.from(m.entries())
        .map(([id, v]) => ({ id, label: nameOf(list, id), value: v, color: colors.get(id) ?? "#8a94a6" }))
        .sort((a, b) => b.value - a.value);
    const planSegs = segs(plan, lookups.planningTypes, ptColor);
    const typeSegs = segs(ptype, lookups.projectTypes, prtColor);
    const bars = typeSegs.map((t) => ({
      label: t.label,
      total: t.value,
      parts: planSegs.map((pl) => ({ label: pl.label, color: pl.color, value: matrix.get(t.id)?.get(pl.id) ?? 0 })).filter((x) => x.value > 0),
    }));
    return { total, planSegs, typeSegs, bars, projects: byProject.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafTasks, popIds, scopedProjectIds, projectById, engine, range, mixActiveOnly, lookups]);

  // ======================================================== ACTIVE HEALTH
  // Current state: Status = In Progress today. Ignores the Reporting Period
  // (Population + More Filters still apply).
  const activeHealth = useMemo(() => {
    const act = scopedProjects.filter((p) => statusOf(p) === "In Progress");
    const count = (keyOf: (p: ProjectRow) => string) => {
      const m = new Map<string, number>();
      for (const p of act) m.set(keyOf(p), (m.get(keyOf(p)) ?? 0) + 1);
      return m;
    };
    const fromLookup = (m: Map<string, number>, list: Lookup[], byName = false) => {
      const used = new Set<string>();
      return Array.from(m.entries())
        .map(([k, v]) => {
          const idx = list.findIndex((l) => (byName ? l.name : l.id) === k);
          const l = list[idx];
          let c = l?.color && l.color !== "neutral" ? CATEGORY_TONE_ICON_COLOR[l.color] ?? "" : "";
          if (!c || used.has(c)) c = k === "__none" ? "#c7cdd6" : MIX_PALETTE[(idx < 0 ? list.length : idx) % MIX_PALETTE.length];
          used.add(c);
          return { label: k === "__none" ? "Not set" : l?.name ?? k, value: v, color: c, order: idx < 0 ? 999 : idx };
        })
        .sort((a, b) => a.order - b.order);
    };
    const health = Array.from(count((p) => healthOf(p, tasks, holidayDates).label).entries())
      .map(([k, v]) => ({ label: k, value: v, color: HEALTH_COLORS[k] ?? "#8a94a6", order: HEALTH_ORDER.indexOf(k) < 0 ? 99 : HEALTH_ORDER.indexOf(k) }))
      .sort((a, b) => a.order - b.order);
    return {
      total: act.length,
      health,
      phase: fromLookup(count((p) => p.phase ?? "__none"), lookups.phases, true),
      planning: fromLookup(count((p) => p.planning_type_id ?? "__none"), lookups.planningTypes),
      ptype: fromLookup(count((p) => p.project_type_id ?? "__none"), lookups.projectTypes),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedProjects, tasks, holidayDates, lookups]);

  // ======================================================== SECTION 3
  // Needs Attention -- current state. Working-day age uses the same
  // holiday calendar as everything else.
  const [attnOpen, setAttnOpen] = useState<string | null>(null);
  const personName = (id: string | null | undefined) => people.find((x) => x.id === id)?.name ?? "—";
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const workingDaysSince = (iso: string | null | undefined): number => {
    if (!iso) return 0;
    const from = toISO(new Date(iso.length > 10 ? iso : iso + "T00:00:00"));
    if (from >= todayIso) return 0;
    let n = 0;
    for (let d = addDays(parseLocalDate(from), 1); toISO(d) <= todayIso; d = addDays(d, 1)) if (isWorkingDay(d, holidaySet)) n++;
    return n;
  };
  const AGING_DAYS = 2;
  const attention = useMemo(() => {
    const open = scopedProjects.filter((p) => !["Cancelled", "Completed"].includes(statusOf(p)) && p.wbs_status !== "closed");
    const overdueProjects = open.filter((p) => statusOf(p) === "In Progress" && healthOf(p, tasks, holidayDates).label === "Overdue");
    const atRisk = open
      .filter((p) => statusOf(p) === "In Progress")
      .map((p) => ({ p, h: healthOf(p, tasks, holidayDates).label }))
      .filter((x) => x.h === "At risk" || x.h === "Off track");
    const pausedReview = scopedProjects.filter(
      (p) =>
        p.wbs_status !== "closed" &&
        ((statusOf(p) === "Paused" && !!p.pause_expected_resume && p.pause_expected_resume.slice(0, 10) < todayIso) || !!p.schedule_review_required)
    );
    const inScopeTask = (t: TaskRow | undefined) => !!t && scopedProjectIds.has(t.project_id);
    const inPop = (id: string | null | undefined) => popIsAll || (!!id && popIds.has(id));
    const approvals: { kind: string; who: string; what: string; age: number; to: string }[] = [];
    for (const e of pendingTime) {
      if (!inPop(e.person_id)) continue;
      const t = e.task_id ? taskById.get(e.task_id) : undefined;
      if (e.task_id && !inScopeTask(t)) continue;
      approvals.push({ kind: "Time log", who: personName(e.person_id), what: t ? t.name : "Non-project time", age: workingDaysSince(e.created_at), to: "/approval-center" });
    }
    for (const r of pendingExt) {
      const t = taskById.get(r.task_id);
      if (!inScopeTask(t) || !inPop(r.requested_by)) continue;
      approvals.push({ kind: "Extension", who: personName(r.requested_by), what: t?.name ?? "—", age: workingDaysSince(r.created_at), to: "/approval-center" });
    }
    for (const r of pendingBaseline) {
      const p = projectById.get(r.project_id);
      if (!p || !scopedProjectIds.has(p.id)) continue;
      approvals.push({ kind: "Start Project", who: personName(p.owner_id), what: p.name, age: workingDaysSince(r.requested_at), to: "/approval-center" });
    }
    for (const r of pendingClosure) {
      const p = projectById.get(r.project_id);
      if (!p || !scopedProjectIds.has(p.id)) continue;
      approvals.push({ kind: "Project close", who: personName(p.owner_id), what: p.name, age: workingDaysSince(r.requested_at), to: "/approval-center" });
    }
    approvals.sort((a, b) => b.age - a.age);
    const validations = leafTasks
      .filter((t) => t.status === "Done" && !t.validated_completion_date && scopedProjectIds.has(t.project_id) && inPop(t.assignee_id))
      .map((t) => ({ t, reported: (t.submitted_on ?? t.actual_completion_date ?? "").slice(0, 10) }))
      .filter((x) => x.reported && workingDaysSince(x.reported) >= AGING_DAYS)
      .map((x) => ({ ...x, age: workingDaysSince(x.reported) }))
      .sort((a, b) => b.age - a.age);
    const readyToClose = scopedProjects
      .filter((p) => statusOf(p) === "Completed" && p.wbs_status !== "closed")
      .map((p) => {
        const since = (p.completed_at ?? p.end_date ?? "").slice(0, 10);
        const days = since ? Math.round((today.getTime() - parseLocalDate(since).getTime()) / 86400000) : 0;
        return { p, since, days };
      })
      .sort((a, b) => b.days - a.days);
    const planningGaps = leafTasks.filter((t) => {
      const p = projectById.get(t.project_id);
      if (!p || !scopedProjectIds.has(p.id) || p.wbs_status === "draft" || p.wbs_status === "closed") return false;
      if (!isOpenTask(t)) return false;
      return !t.assignee_id || !t.estimated_hours;
    });
    return { overdueProjects, atRisk, pausedReview, approvals, validations, readyToClose, planningGaps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedProjects, scopedProjectIds, tasks, leafTasks, holidayDates, holidaySet, todayIso, pendingTime, pendingExt, pendingBaseline, pendingClosure, popIds, popIsAll, people]);

  function attnCards(): AttnSpec[] {
    const a = attention;
    const projRow = (p: ProjectRow, extra: string[]) => ({ cells: [p.name, personName(p.owner_id), ...extra], to: `/projects/${p.id}/wbs` });
    const taskRow = (t: TaskRow, extra: string[]) => ({ cells: [t.name, projectById.get(t.project_id)?.name ?? "—", personName(t.assignee_id), ...extra], to: `/projects/${t.project_id}/wbs` });
    const aging = a.approvals.filter((x) => x.age >= AGING_DAYS).length;
    const rtc14 = a.readyToClose.filter((x) => x.days >= 14).length;
    const pastResume = a.pausedReview.filter((p) => statusOf(p) === "Paused" && p.pause_expected_resume && p.pause_expected_resume.slice(0, 10) < todayIso).length;
    const reviewPending = a.pausedReview.filter((p) => p.schedule_review_required).length;
    return [
      { key: "over", tier: 1, tone: "red", icon: <UserX size={16} />, label: "Overallocated", context: "Next 2 weeks", value: horizon.over.length, sub: "> 100% on 1+ day",
        definition: "People planned above 100% of their capacity on at least one working day in the next 2 weeks.", columns: ["Member", "Days over 100%", "Peak"], to: "/utilization", toLabel: "Utilization",
        rows: [...horizon.over].sort((x, y) => y.peak - x.peak).map((o) => ({ cells: [o.person.name, String(o.days), `${Math.round(o.peak)}%`], to: "/utilization" })) },
      { key: "under", tier: 1, tone: "blue", icon: <BatteryCharging size={16} />, label: "Underloaded", context: "Next 2 weeks", value: horizon.under.length, sub: "< 50% planned",
        definition: "People planned below 50% of their capacity over the next 2 weeks -- open capacity that can take more work.", columns: ["Member", "Planned", "Capacity", "Utilization"], to: "/utilization", toLabel: "Utilization",
        rows: [...horizon.under].sort((x, y) => x.pct - y.pct).map((u) => ({ cells: [u.person.name, fmtH(u.planned), fmtH(u.cap), `${Math.round(u.pct)}%`], to: "/utilization" })) },
      { key: "odproj", tier: 2, tone: "red", icon: <Clock3 size={16} />, label: "Overdue projects", context: "Health", value: a.overdueProjects.length, sub: "Past End Date",
        definition: "Active projects whose Health is Overdue: past their End Date and not complete.", columns: ["Project", "Owner", "End date"], to: "/projects", toLabel: "Projects & Tasks",
        rows: a.overdueProjects.map((p) => projRow(p, [p.end_date ? fmtLong(p.end_date.slice(0, 10)) : "—"])) },
      { key: "risk", tier: 2, tone: "amber", icon: <AlertTriangle size={16} />, label: "At-risk projects", context: "Health", value: a.atRisk.length, sub: "At risk · off track",
        definition: "Active projects whose progress is behind schedule (Health = At risk or Off track) but not overdue yet.", columns: ["Project", "Owner", "Health", "End date"], to: "/projects", toLabel: "Projects & Tasks",
        rows: a.atRisk.map((x) => projRow(x.p, [x.h, x.p.end_date ? fmtLong(x.p.end_date.slice(0, 10)) : "—"])) },
      { key: "odtask", tier: 2, tone: "red", icon: <ListChecks size={16} />, label: "Overdue tasks", context: `As of ${fmtShort(todayIso)}`, value: overdueTasks.length, sub: `${overdueProjectCount} project${overdueProjectCount === 1 ? "" : "s"}`,
        definition: "Open tasks past their Target Due Date. Tasks in paused projects are excluded.", columns: ["Task", "Project", "Assignee", "Due", "Days late"], to: "/projects", toLabel: "Projects & Tasks",
        rows: [...overdueTasks].sort((x, y) => (x.current_due_date ?? "").localeCompare(y.current_due_date ?? "")).map((t) => taskRow(t, [fmtLong(t.current_due_date.slice(0, 10)), String(workingDaysSince(t.current_due_date))])) },
      { key: "paused", tier: 2, tone: "amber", icon: <PauseCircle size={16} />, label: "Paused / needs review", context: "Current", value: a.pausedReview.length, sub: `${pastResume} past resume · ${reviewPending} review`,
        definition: "Paused projects past their expected resume date, or resumed projects still waiting for their Schedule Review.", columns: ["Project", "Owner", "Reason", "Expected resume"], to: "/projects", toLabel: "Projects & Tasks",
        rows: a.pausedReview.map((p) => projRow(p, [p.schedule_review_required ? "Schedule review pending" : "Past expected resume", p.pause_expected_resume ? fmtLong(p.pause_expected_resume.slice(0, 10)) : "—"])) },
      { key: "appr", tier: 3, tone: "purple", icon: <ClipboardCheck size={16} />, label: "Pending approvals", context: "Time · extension · start · close", value: a.approvals.length, sub: aging ? `${aging} waiting ${AGING_DAYS}+ days` : "None aging", subTone: aging ? "red" : undefined,
        definition: `Requests waiting for a decision. "Aging" = waiting ${AGING_DAYS}+ working days. Task validations have their own card.`, columns: ["Type", "Requested by", "Item", "Waiting (working days)"], to: "/approval-center", toLabel: "Approval Center",
        rows: a.approvals.map((x) => ({ cells: [x.kind, x.who, x.what, String(x.age)], to: x.to })) },
      { key: "valid", tier: 3, tone: "purple", icon: <BadgeCheck size={16} />, label: "Validations overdue", context: `Done ${AGING_DAYS}+ working days`, value: a.validations.length, sub: "Not yet validated",
        definition: `Tasks marked Done whose Reported Completion Date is ${AGING_DAYS}+ working days ago and nobody has confirmed (validated) yet.`, columns: ["Task", "Project", "Assignee", "Reported done", "Waiting"], to: "/approval-center", toLabel: "Approval Center",
        rows: a.validations.map((x) => taskRow(x.t, [fmtLong(x.reported), `${x.age} days`])) },
      { key: "rtc", tier: 4, tone: "amber", icon: <Flag size={16} />, label: "Ready to close", context: "Completed, not closed", value: a.readyToClose.length, sub: rtc14 ? `${rtc14} waiting 14+ days` : "None waiting 14+ days",
        definition: "Projects with Status Completed whose WBS hasn't been closed yet.", columns: ["Project", "Owner", "Completed", "Days waiting"], to: "/projects", toLabel: "Projects & Tasks",
        rows: a.readyToClose.map((x) => projRow(x.p, [x.since ? fmtLong(x.since) : "—", String(x.days)])) },
      { key: "miss", tier: 4, tone: "blue", icon: <Hourglass size={16} />, label: "Missing hours", context: missing.rangeLabel ? `${missing.label} · ${missing.rangeLabel}` : missing.label, value: missing.members.length, sub: `members · ${fmtH(missing.total)}`,
        definition: "Members whose finalized logged hours are below expected hours on completed working days this week.", columns: ["Member", "Missing"], to: "/time-tracking?scope=all", toLabel: "Time Tracking",
        rows: [...missing.members].sort((x, y) => y.hours - x.hours).map((m) => ({ cells: [m.person.name, `${m.hours.toFixed(1)}h`], to: "/time-tracking?scope=all" })) },
      { key: "gaps", tier: 4, tone: "amber", icon: <FileWarning size={16} />, label: "Planning gaps", context: "Started projects", value: a.planningGaps.length, sub: "No assignee or hours",
        definition: "Open tasks in started projects with no Assignee or no Scoped Hours -- invisible to Utilization. Draft projects are not counted.", columns: ["Task", "Project", "Assignee", "Missing"], to: "/projects", toLabel: "Projects & Tasks",
        rows: a.planningGaps.map((t) => taskRow(t, [[!t.assignee_id && "Assignee", !t.estimated_hours && "Scoped Hours"].filter(Boolean).join(", ")])) },
    ];
  }

  // ---------------------------------------------------------- render
  // measure(start,end) -> value. Uses the period's own comparison; for YTD
  // with no prior-year data, falls back to QTD vs same point last quarter.
  const trend = (measure: (start: string, end: string) => number) => {
    const fmt = (cur: number, prev: number, label: string) => {
      const d = Math.round(((cur - prev) / prev) * 100);
      return { text: `${Math.abs(d)}% ${label}`, dir: (d > 0 ? 1 : d < 0 ? -1 : 0) as 1 | -1 | 0 };
    };
    const prev = measure(range.prevStart, range.prevEnd);
    if (prev > 0) return fmt(measure(range.start, range.end), prev, range.prevLabel);
    if (period === "ytd") {
      const qp = measure(range.qtd.prevStart, range.qtd.prevEnd);
      if (qp > 0) return fmt(measure(range.qtd.curStart, range.qtd.curEnd), qp, range.qtd.label);
    }
    return { text: "No prior data yet", dir: 0 as const };
  };
  const completedIn = (a: string, b: string) => scopedProjects.filter((p) => { if (statusOf(p) !== "Completed") return false; const c = completionDateOf(p); return c >= a && c <= b; }).length;
  const periodTag = period === "ytd" ? "YTD" : range.label;
  const t = portfolio.total;

  return (
    <div className="exec-dash">
      <style>{EXEC_CSS}</style>
      <div className="exec-head">
        <div>
          <h1 style={{ marginBottom: 2 }}>L&amp;D Executive Dashboard</h1>
          <p className="subtitle" style={{ margin: 0 }}>Portfolio, capacity, effort and execution at a glance</p>
        </div>
        <div className="exec-filters">
          <PeriodPicker period={period} setPeriod={setPeriod} custom={custom} setCustom={setCustom} range={range} />
          <PopulationPicker
            mode={popMode}
            setMode={setPopMode}
            roles={roles}
            selRoles={popRoles}
            setSelRoles={setPopRoles}
            people={people}
            selMembers={popMembers}
            setSelMembers={setPopMembers}
            count={popPeople.length}
          />
          <MoreFiltersPicker more={more} setMore={setMore} people={people} lookups={lookups} />
          <button className="exec-updated" onClick={load} title="Refresh data">
            <RefreshCw size={13} className={loading ? "spin" : undefined} />
            <span>
              <span style={{ display: "block", color: "var(--muted)", fontSize: 10 }}>Updated</span>
              {updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{" "}
              {updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          </button>
        </div>
      </div>
      <FilterChips more={more} setMore={setMore} people={people} lookups={lookups} popMode={popMode} popRoles={popRoles} popMembers={popMembers} onClearPop={() => { setPopMode("all"); setPopRoles([]); setPopMembers([]); }} />

      {loading && projects.length === 0 ? (
        <p className="subtitle">Loading…</p>
      ) : (
        <>
          <section className="exec-section">
            <SectionTitle title={`Portfolio Overview (${periodTag})`} caption={`Projects relevant to the selected period (${fmtShort(range.start)} – ${fmtLong(range.end)})`} />
            <div className="exec-portfolio">
            <div className="exec-grid exec-grid-3">
              <Kpi to="/projects" tone="blue" icon={<Folder size={18} />} label="Total Projects" value={t} sub="Completed + open in period" title="Completed in period + open projects (In Progress, Not Started, Paused) that started by period end. Cancelled excluded." />
              <Kpi to="/projects" tone="green" icon={<CheckCircle2 size={18} />} label="Completed" value={portfolio.completed.length} sub={`${pctOf(portfolio.completed.length, t)}% of total`} trend={trend(completedIn)} title="Projects whose Actual Close Date (or completion stamp) falls in the period." />
              <Kpi to="/projects" tone="indigo" icon={<Activity size={18} />} label="Active" value={portfolio.active.length} sub={`${pctOf(portfolio.active.length, t)}% of total`} title="Status = In Progress (current state)." />
              <Kpi to="/projects" tone="slate" icon={<CircleDashed size={18} />} label="Not Started" value={portfolio.notStarted.length} sub={`${pctOf(portfolio.notStarted.length, t)}% of total`} title="Status = Not Started, or WBS still in Draft." />
              <Kpi to="/projects" tone="orange" icon={<PauseCircle size={18} />} label="Paused" value={portfolio.paused.length} sub={`${pctOf(portfolio.paused.length, t)}% of total`} />
              <Kpi to="/projects" tone="red" icon={<Clock3 size={18} />} label="Overdue" value={portfolio.overdue.length} sub={`${pctOf(portfolio.overdue.length, portfolio.active.length)}% of active`} title="Active projects whose Health is Overdue (past End Date, not complete). Health is separate from Status." />
            </div>
            <div className="exec-chart-card">
              <div className="exec-kpi-label" style={{ fontSize: 12.5, color: "var(--navy)" }}>Portfolio Movement ({periodTag})</div>
              <div className="exec-kpi-context" style={{ marginBottom: 6 }}>Projects started vs. completed, by {movement.unit}</div>
              <MonthlyBarChart months={movement.buckets} series={movement.series} />
            </div>
            </div>
          </section>

          <section className="exec-section">
            <SectionTitle title="Executive Operating Summary" caption="Key capacity, effort and execution metrics" />
            <div className="exec-grid exec-grid-7">
              <Kpi to="/time-tracking?scope=all" tone="slate" icon={<CalendarClock size={18} />} label="Expected Hours" context={periodTag} value={fmtH(expectedInPeriod)} sub={`${loggers.length} ${loggers.length === 1 ? "person" : "people"} · from ${fmtShort(range.start > trackingStart ? range.start : trackingStart)}`} title={`Each person's daily shift (usually 7.5h), adjusted for half-days, approved time off, holidays and weekends, from the Time tracking start date (${fmtShort(trackingStart)}) or period start, whichever is later, to today. People tagged "not expected to log time" are excluded.`} />
              <Kpi to="/hours-overview" tone="teal" icon={<Timer size={18} />} label="Logged Hours" context={`${periodTag} · from ${fmtShort(range.start > trackingStart ? range.start : trackingStart)}`} value={fmtH(logged)} sub={expectedInPeriod > 0 ? `${pctOf(loggedIn(range.start, range.end, new Set(loggers.map((p) => p.id))), expectedInPeriod)}% of expected` : undefined} trend={trend((a, b) => loggedIn(a, b))} title={`Finalized (Confirmed/Approved) time only${moreActive ? ", project time within filtered projects" : ", incl. non-project time"}. Expected = ${fmtH(expectedInPeriod)}: each person's daily capacity (adjusted for half-days, time off, holidays, weekends) across working days from ${fmtShort(range.start > trackingStart ? range.start : trackingStart)} (time tracking start) to today.`} />
              <Kpi to="/utilization" tone="purple" icon={<Users size={18} />} label="Planned Utilization" context="Next 2 weeks" value={`${Math.round(horizon.util)}%`} sub={`${fmtH(horizon.planned)} of ${fmtH(horizon.cap)} capacity`} valueTone={horizon.util > 100 ? "red" : undefined} title={`Planned workload vs available capacity, ${fmtShort(todayIso)} – ${fmtShort(horizon.end)}. Same engine as the Utilization page.`} />
              <Kpi to="/utilization" tone="green" icon={<BatteryCharging size={18} />} label="Available Capacity" context="Next 2 weeks" value={fmtH(horizon.available)} sub={`${pctOf(horizon.available, horizon.cap)}% of capacity open`} title="Sum of unallocated hours per person per working day (an overloaded day doesn't cancel out someone else's free time)." />
              <Kpi to="/utilization" tone="orange" icon={<UserX size={18} />} label="Overallocated Members" context="Next 2 weeks" value={horizon.over.length} sub="> 100% on at least 1 day" valueTone={horizon.over.length ? "orange" : undefined} title={horizon.over.length ? horizon.over.map((o) => `${o.person.name}: ${o.days} day(s), peak ${Math.round(o.peak)}%`).join("\n") : "Nobody above 100% in the next 2 weeks."} />
              <Kpi to="/projects" tone="red" icon={<AlertTriangle size={18} />} label="Overdue Tasks" context={`As of ${fmtShort(todayIso)}`} value={overdueTasks.length} sub={`Across ${overdueProjectCount} project${overdueProjectCount === 1 ? "" : "s"}`} valueTone={overdueTasks.length ? "red" : undefined} title="Open leaf tasks with Target Due Date before today. Paused-project tasks excluded." />
              <Kpi to="/time-tracking?scope=all" tone="orange" icon={<Hourglass size={18} />} label="Missing Hours" context={missing.rangeLabel ? `${missing.label} · ${missing.rangeLabel}` : missing.label} value={fmtH(missing.total)} sub={`${missing.members.length} member${missing.members.length === 1 ? "" : "s"} · completed days only`} valueTone={missing.total > 0.1 ? "orange" : undefined} title={missing.members.length ? missing.members.sort((a, b) => b.hours - a.hours).map((m) => `${m.person.name}: ${m.hours.toFixed(1)}h`).join("\n") : "No missing hours this week."} />
            </div>
          </section>

          <section className="exec-section">
            <SectionTitle title="Needs Attention" caption="Items that may need leadership review or intervention · current state" />
            {(() => {
              const a = attention;
              const cards = attnCards();
              const byTier = (tier: number) => cards.filter((c) => c.tier === tier);
              const row = (left: number, right: number) => (
                <div className="exec-attn-row">
                  {[left, right].map((tier, i) => (
                    <div key={tier} style={{ display: "contents" }}>
                      {i === 1 && <div className="exec-attn-sep" />}
                      <div className="exec-attn-grp" style={{ flex: byTier(tier).length }}>
                        <div className="exec-attn-tier">{TIER_LABELS[tier]}</div>
                        <div className="exec-attn-cards" style={{ gridTemplateColumns: `repeat(${byTier(tier).length}, minmax(0, 1fr))` }}>
                          {byTier(tier).map((c) => (
                            <AttnCard key={c.key} c={c} onOpen={() => setAttnOpen(c.key)} />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
              void a;
              const openCard = cards.find((c) => c.key === attnOpen);
              return (
                <>
                  {row(1, 2)}
                  <div className="exec-attn-hr" />
                  {row(3, 4)}
                  {openCard && (
                    <Modal title={`${openCard.label} (${openCard.rows.length})`} onClose={() => setAttnOpen(null)} width={720}>
                      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 10 }}>{openCard.definition}</div>
                      {openCard.rows.length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--muted)", padding: "12px 0" }}>All clear.</div>
                      ) : (
                        <table className="exec-attn-table">
                          <thead>
                            <tr>
                              {openCard.columns.map((h) => (
                                <th key={h}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {openCard.rows.map((r, i) => (
                              <tr key={i}>
                                {r.cells.map((c, j) => (
                                  <td key={j}>{j === 0 && r.to ? <Link to={r.to} onClick={() => setAttnOpen(null)}>{c}</Link> : c}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div style={{ marginTop: 12, textAlign: "right" }}>
                        <Link to={openCard.to} onClick={() => setAttnOpen(null)} style={{ fontSize: 12, color: "var(--accent)" }}>
                          Open {openCard.toLabel} →
                        </Link>
                      </div>
                    </Modal>
                  )}
                </>
              );
            })()}
          </section>

          <section className="exec-section">
            <div className="exec-section-title" style={{ justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <span className="exec-title">Work Mix &amp; Effort Allocation</span>
                <span className="exec-caption">
                  Scoped Hours by type · {periodTag} · {fmtH(workMix.total)} across {workMix.projects} project{workMix.projects === 1 ? "" : "s"}
                </span>
              </div>
              <label className="exec-toggle" title="Only count projects whose Status is In Progress today">
                <span>Active projects only</span>
                <input type="checkbox" checked={mixActiveOnly} onChange={(e) => setMixActiveOnly(e.target.checked)} />
                <span className="exec-toggle-track" />
              </label>
            </div>
            <div className="exec-mix">
              <MixDonut title="By Planning Type" segments={workMix.planSegs} total={workMix.total} />
              <MixDonut title="By Project Type" segments={workMix.typeSegs} total={workMix.total} />
              <div className="exec-chart-card">
                <div className="exec-kpi-label" style={{ fontSize: 12.5, color: "var(--navy)" }}>Project Type × Planning Type</div>
                <div className="exec-kpi-context" style={{ marginBottom: 10 }}>Scoped Hours per Project Type, split by Planning Type</div>
                <StackedBars bars={workMix.bars} legend={workMix.planSegs} />
              </div>
            </div>
          </section>

          <section className="exec-section">
            <SectionTitle title="Active Projects Health" caption={`Current state · ${activeHealth.total} active (In Progress) project${activeHealth.total === 1 ? "" : "s"} · not affected by the Reporting Period`} />
            <div className="exec-grid-4">
              {([
                ["Health", activeHealth.health],
                ["Phase", activeHealth.phase],
                ["Planning Type", activeHealth.planning],
                ["Project Type", activeHealth.ptype],
              ] as const).map(([t, segs]) => (
                <MixDonut key={t} title={t} segments={[...segs]} total={activeHealth.total} fmt={(n) => String(Math.round(n))} centerSub="active" />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}


// ---------------------------------------------------------------- Needs Attention
const TIER_LABELS: Record<number, string> = { 1: "Capacity risk", 2: "Delivery risk", 3: "Decisions waiting", 4: "Closure and hygiene" };
const ATTN_TONES: Record<string, { bg: string; fg: string; ic: string }> = {
  red: { bg: "#fdecec", fg: "#b42318", ic: "#dc2626" },
  amber: { bg: "#fff4e0", fg: "#9a5b00", ic: "#d97706" },
  purple: { bg: "#f1ebfd", fg: "#5b3aa8", ic: "#8b5cf6" },
  blue: { bg: "#e8f1fd", fg: "#1e4f9c", ic: "#2f6fed" },
  clear: { bg: "var(--hover-bg)", fg: "var(--text-secondary)", ic: "var(--muted)" },
};
interface AttnSpec {
  key: string;
  tier: number;
  tone: string;
  icon: JSX.Element;
  label: string;
  context: string;
  value: number;
  sub: string;
  subTone?: string;
  definition: string;
  columns: string[];
  rows: { cells: string[]; to?: string }[];
  to: string;
  toLabel: string;
}
function AttnCard({ c, onOpen }: { c: AttnSpec; onOpen: () => void }) {
  const t = ATTN_TONES[c.value === 0 ? "clear" : c.tone];
  return (
    <button type="button" className="exec-attn-card" onClick={onOpen} style={{ background: t.bg, color: t.fg }} title={c.definition}>
      <span className="exec-kpi-icon" style={{ background: "rgba(255,255,255,.75)", color: t.ic, width: 32, height: 32 }}>
        {c.value === 0 ? <CheckCircle2 size={16} /> : c.icon}
      </span>
      <div style={{ minWidth: 0, textAlign: "left" }}>
        <div className="exec-kpi-label" style={{ color: t.fg }}>{c.label}</div>
        <div className="exec-kpi-context" style={{ color: t.fg, opacity: 0.75 }}>{c.context}</div>
        <div className="exec-kpi-value" style={{ color: t.fg }}>{c.value}</div>
        <div className="exec-kpi-sub" style={{ color: c.subTone === "red" && c.value ? "#b42318" : t.fg, opacity: c.subTone ? 1 : 0.8, fontWeight: c.subTone ? 600 : 400 }}>
          {c.value === 0 ? "All clear" : c.sub}
        </div>
      </div>
    </button>
  );
}


// ---------------------------------------------------------------- Work Mix
const HEALTH_ORDER = ["On track", "At risk", "Off track", "Overdue", "Schedule review", "Not started", "Health unavailable", "Paused"];
const HEALTH_COLORS: Record<string, string> = {
  "On track": "#16a34a",
  "At risk": "#f59e0b",
  "Off track": "#ea7a16",
  Overdue: "#dc2626",
  "Schedule review": "#d4a72c",
  "Not started": "#94a3b8",
  "Health unavailable": "#cbd5e1",
  Paused: "#8b5cf6",
};
const MIX_PALETTE = ["#2f6fed", "#16a34a", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#ef4444", "#64748b"];
type MixSeg = { id?: string; label: string; value: number; color: string };
function MixDonut({ title, segments, total, fmt = fmtH, centerSub = "scoped", subtitle }: { title: string; segments: MixSeg[]; total: number; fmt?: (n: number) => string; centerSub?: string; subtitle?: string }) {
  const r = 52;
  const sw = 18;
  const C = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="exec-chart-card">
      <div className="exec-kpi-label" style={{ fontSize: 12.5, color: "var(--navy)", marginBottom: subtitle ? 0 : 8 }}>{title}</div>
      {subtitle && <div className="exec-kpi-context" style={{ marginBottom: 8 }}>{subtitle}</div>}
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <svg viewBox="0 0 140 140" width={130} height={130} style={{ flexShrink: 0 }}>
          <g transform="translate(70,70) rotate(-90)">
            {total <= 0 ? (
              <circle r={r} fill="none" stroke="var(--border)" strokeWidth={sw} />
            ) : (
              segments.map((s, i) => {
                const dash = (s.value / total) * C;
                const el = <circle key={i} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-off}><title>{`${s.label}: ${fmt(s.value)}`}</title></circle>;
                off += dash;
                return el;
              })
            )}
          </g>
          <text x={70} y={68} textAnchor="middle" fontSize={17} fontWeight={700} fill="var(--navy)">{fmt(total)}</text>
          <text x={70} y={84} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{centerSub}</text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0, flex: 1 }}>
          {segments.map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <span style={{ color: "var(--text-secondary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ fontWeight: 600, color: "var(--navy)" }}>{fmt(s.value)}</span>
              <span style={{ color: "var(--muted)", width: 32, textAlign: "right" }}>{pctOf(s.value, total)}%</span>
            </div>
          ))}
          {total <= 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>No data.</div>}
        </div>
      </div>
    </div>
  );
}
function StackedBars({ bars, legend }: { bars: { label: string; total: number; parts: MixSeg[] }[]; legend: MixSeg[] }) {
  const max = Math.max(1, ...bars.map((b) => b.total));
  if (!bars.length) return <div style={{ fontSize: 11, color: "var(--muted)" }}>No scoped hours in this period.</div>;
  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {bars.map((b) => (
          <div key={b.label} style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr) 56px", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.label}>{b.label}</span>
            <div style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", width: `${(b.total / max) * 100}%`, background: "var(--hover-bg)" }}>
              {b.parts.map((p) => (
                <div key={p.label} title={`${b.label} · ${p.label}: ${fmtH(p.value)} (${pctOf(p.value, b.total)}%)`} style={{ width: `${(p.value / b.total) * 100}%`, background: p.color }} />
              ))}
            </div>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)", textAlign: "right" }}>{fmtH(b.total)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        {legend.map((l) => (
          <span key={l.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-secondary)" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ================================================================= pieces
function SectionTitle({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="exec-section-title">
      <span className="exec-title">{title}</span>
      <span className="exec-caption">{caption}</span>
    </div>
  );
}

function Kpi({
  to,
  tone,
  icon,
  label,
  context,
  value,
  sub,
  trend,
  valueTone,
  title,
}: {
  to: string;
  tone: Tone;
  icon: JSX.Element;
  label: string;
  context?: string;
  value: string | number;
  sub?: string;
  trend?: { text: string; dir: 1 | -1 | 0 };
  valueTone?: Tone;
  title?: string;
}) {
  const c = TONES[tone];
  const vc = TONES[valueTone ?? tone].fg;
  return (
    <Link to={to} className="exec-kpi" title={title}>
      <span className="exec-kpi-icon" style={{ background: c.bg, color: c.fg }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="exec-kpi-label">{label}</div>
        {context && <div className="exec-kpi-context">{context}</div>}
        <div className="exec-kpi-value" style={{ color: vc }}>
          {value}
        </div>
        {trend && (
          <div className="exec-kpi-sub" style={{ color: trend.dir > 0 ? "#16a34a" : trend.dir < 0 ? "#dc2626" : "var(--muted)" }}>
            {trend.dir > 0 ? <TrendingUp size={11} /> : trend.dir < 0 ? <TrendingDown size={11} /> : null} {trend.text}
          </div>
        )}
        {sub && <div className="exec-kpi-sub">{sub}</div>}
      </div>
    </Link>
  );
}

// Small portal popover anchored to a button.
function Popover({ anchor, open, onClose, width = 280, children }: { anchor: React.RefObject<HTMLElement>; open: boolean; onClose: () => void; width?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open, onClose, anchor]);
  if (!open || !anchor.current) return null;
  const r = anchor.current.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
  return createPortal(
    <div ref={ref} className="exec-pop" style={{ top: r.bottom + 6, left, width }}>
      {children}
    </div>,
    document.body
  );
}

function FilterButton({ btnRef, icon, top, bottom, active, onClick }: { btnRef: React.RefObject<HTMLButtonElement>; icon: JSX.Element; top: string; bottom: string; active?: boolean; onClick: () => void }) {
  return (
    <button ref={btnRef} type="button" className={`exec-fbtn${active ? " active" : ""}`} onClick={onClick}>
      {icon}
      <span style={{ textAlign: "left" }}>
        <span className="exec-fbtn-top">{top}</span>
        <span className="exec-fbtn-bottom">{bottom}</span>
      </span>
      <ChevronDown size={13} color="var(--muted)" />
    </button>
  );
}

const PERIOD_LABELS: Record<PeriodKey, string> = {
  ytd: "YTD",
  this_quarter: "This Quarter",
  last_quarter: "Last Quarter",
  this_month: "This Month",
  last_month: "Last Month",
  custom: "Custom Range",
};

function PeriodPicker({ period, setPeriod, custom, setCustom, range }: { period: PeriodKey; setPeriod: (p: PeriodKey) => void; custom: { start: string; end: string }; setCustom: (c: { start: string; end: string }) => void; range: { start: string; end: string; label: string } }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <FilterButton btnRef={ref} icon={<CalendarRange size={15} color="var(--accent)" />} top={range.label} bottom={`${fmtShort(range.start)} – ${fmtLong(range.end)}`} onClick={() => setOpen((v) => !v)} />
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={240}>
        <div className="exec-pop-h">Reporting period</div>
        {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => (
          <label key={k} className="exec-pop-opt">
            <input type="radio" checked={period === k} onChange={() => { setPeriod(k); if (k !== "custom") setOpen(false); }} /> {PERIOD_LABELS[k]}
          </label>
        ))}
        {period === "custom" && (
          <div className="exec-pop-sub" style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: "6px 8px", padding: "8px 4px 2px" }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>From</span>
            <input type="date" value={custom.start} max={custom.end} onChange={(e) => e.target.value && setCustom({ ...custom, start: e.target.value })} className="exec-date" style={{ marginBottom: 0 }} />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>To</span>
            <input type="date" value={custom.end} min={custom.start} onChange={(e) => e.target.value && setCustom({ ...custom, end: e.target.value })} className="exec-date" style={{ marginBottom: 0 }} />
          </div>
        )}
      </Popover>
    </>
  );
}

function CheckList({ options, selected, onChange, max = 220 }: { options: Lookup[]; selected: string[]; onChange: (v: string[]) => void; max?: number }) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      {options.length > 8 && <input className="exec-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div style={{ maxHeight: max, overflowY: "auto" }}>
        {shown.map((o) => (
          <label key={o.id} className="exec-pop-opt">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => onChange(selected.includes(o.id) ? selected.filter((x) => x !== o.id) : [...selected, o.id])} /> {o.name}
          </label>
        ))}
        {shown.length === 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", padding: 6 }}>No matches</div>}
      </div>
    </div>
  );
}

function PopulationPicker(props: { mode: PopMode; setMode: (m: PopMode) => void; roles: string[]; selRoles: string[]; setSelRoles: (v: string[]) => void; people: Person[]; selMembers: string[]; setSelMembers: (v: string[]) => void; count: number }) {
  const { mode, setMode, roles, selRoles, setSelRoles, people, selMembers, setSelMembers, count } = props;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const top = mode === "role" && selRoles.length ? (selRoles.length === 1 ? selRoles[0] : `${selRoles.length} roles`) : mode === "members" && selMembers.length ? `${selMembers.length} member${selMembers.length === 1 ? "" : "s"}` : "All L&D";
  return (
    <>
      <FilterButton btnRef={ref} icon={<Users size={15} color="var(--accent)" />} top={top} bottom={`${count} people`} active={top !== "All L&D"} onClick={() => setOpen((v) => !v)} />
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={270}>
        <div className="exec-pop-h">Population</div>
        {(["all", "role", "members"] as PopMode[]).map((m) => (
          <label key={m} className="exec-pop-opt">
            <input type="radio" checked={mode === m} onChange={() => setMode(m)} /> {m === "all" ? "All L&D" : m === "role" ? "By role" : "Selected team members"}
          </label>
        ))}
        {mode === "role" && (
          <div className="exec-pop-sub">
            <CheckList options={roles.map((r) => ({ id: r, name: r }))} selected={selRoles} onChange={setSelRoles} />
          </div>
        )}
        {mode === "members" && (
          <div className="exec-pop-sub">
            <CheckList options={people.map((p) => ({ id: p.id, name: p.name }))} selected={selMembers} onChange={setSelMembers} />
          </div>
        )}
      </Popover>
    </>
  );
}

type LookupBag = { sources: Lookup[]; planningTypes: Lookup[]; projectTypes: Lookup[]; categories: Lookup[] };
function moreGroups(people: Person[], l: LookupBag): { key: keyof MoreFilters; label: string; options: Lookup[] }[] {
  return [
    { key: "owner", label: "Project Owner", options: people.map((p) => ({ id: p.id, name: p.name })) },
    { key: "source", label: "Source", options: l.sources },
    { key: "planningType", label: "Planning Type", options: l.planningTypes },
    { key: "projectType", label: "Project Type", options: l.projectTypes },
    // category is stored by NAME on projects
    { key: "category", label: "Category", options: l.categories.map((c) => ({ id: c.name, name: c.name })) },
    { key: "status", label: "Project Status", options: PROJECT_STATUSES.map((s) => ({ id: s, name: s })) },
  ];
}

function MoreFiltersPicker({ more, setMore, people, lookups }: { more: MoreFilters; setMore: (m: MoreFilters) => void; people: Person[]; lookups: LookupBag }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<keyof MoreFilters>("owner");
  const groups = moreGroups(people, lookups);
  const activeCount = Object.values(more).reduce((n, v) => n + v.length, 0);
  const g = groups.find((x) => x.key === section)!;
  return (
    <>
      <FilterButton btnRef={ref} icon={<SlidersHorizontal size={15} color="var(--accent)" />} top="More Filters" bottom={activeCount ? `${activeCount} applied` : "Owner · Source · Type · +3"} active={activeCount > 0} onClick={() => setOpen((v) => !v)} />
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={420}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 140, borderRight: "1px solid var(--border)", paddingRight: 8 }}>
            {groups.map((x) => (
              <button key={x.key} type="button" className={`exec-pop-tab${section === x.key ? " on" : ""}`} onClick={() => setSection(x.key)}>
                {x.label}
                {more[x.key].length > 0 && <span className="exec-badge">{more[x.key].length}</span>}
              </button>
            ))}
            {activeCount > 0 && (
              <button type="button" className="exec-clear" onClick={() => setMore(EMPTY_MORE)}>
                Clear all
              </button>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="exec-pop-h">{g.label}</div>
            <CheckList options={g.options} selected={more[section]} onChange={(v) => setMore({ ...more, [section]: v })} />
          </div>
        </div>
      </Popover>
    </>
  );
}

function FilterChips({ more, setMore, people, lookups, popMode, popRoles, popMembers, onClearPop }: { more: MoreFilters; setMore: (m: MoreFilters) => void; people: Person[]; lookups: LookupBag; popMode: PopMode; popRoles: string[]; popMembers: string[]; onClearPop: () => void }) {
  const groups = moreGroups(people, lookups);
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (popMode === "role" && popRoles.length) chips.push({ key: "pop", label: `Role: ${popRoles.join(", ")}`, onRemove: onClearPop });
  if (popMode === "members" && popMembers.length)
    chips.push({ key: "pop", label: `Members: ${popMembers.map((id) => people.find((p) => p.id === id)?.name ?? "?").join(", ")}`, onRemove: onClearPop });
  for (const g of groups)
    for (const id of more[g.key])
      chips.push({ key: `${g.key}-${id}`, label: `${g.label}: ${g.options.find((o) => o.id === id)?.name ?? id}`, onRemove: () => setMore({ ...more, [g.key]: more[g.key].filter((x) => x !== id) }) });
  if (!chips.length) return null;
  return (
    <div className="exec-chips">
      {chips.map((c) => (
        <span key={c.key} className="exec-chip">
          {c.label}
          <button type="button" onClick={c.onRemove} aria-label="Remove filter">
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

const EXEC_CSS = `
.exec-dash{min-width:0;max-width:100%}
.exec-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:10px}
.exec-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:stretch}
.exec-fbtn{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);cursor:pointer;font:inherit;color:var(--navy);box-shadow:0 1px 2px rgba(15,41,66,.04)}
.exec-fbtn:hover{border-color:#c9d3df}
.exec-fbtn.active{border-color:var(--accent);background:#f4f8fd}
.exec-fbtn-top{display:block;font-size:12px;font-weight:600;line-height:1.2}
.exec-fbtn-bottom{display:block;font-size:10.5px;color:var(--muted);line-height:1.2}
.exec-updated{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:none;background:transparent;font:inherit;font-size:11px;color:var(--text-secondary);cursor:pointer;text-align:left}
.exec-updated:hover{color:var(--accent)}
.exec-updated .spin{animation:execspin 1s linear infinite}
@keyframes execspin{to{transform:rotate(360deg)}}
.exec-pop{position:fixed;z-index:1000;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:0 8px 24px rgba(15,41,66,.14);padding:10px}
.exec-pop-h{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:2px 4px 6px}
.exec-pop-opt{display:flex;align-items:center;gap:7px;font-size:12px;padding:5px 4px;border-radius:4px;cursor:pointer;color:var(--text)}
.exec-pop-opt:hover{background:var(--hover-bg)}
.exec-pop-sub{border-top:1px solid var(--border);margin-top:6px;padding-top:6px}
.exec-pop-tab{display:flex;justify-content:space-between;align-items:center;width:100%;text-align:left;font:inherit;font-size:12px;padding:6px 8px;border:none;background:transparent;border-radius:4px;cursor:pointer;color:var(--text-secondary)}
.exec-pop-tab:hover{background:var(--hover-bg)}
.exec-pop-tab.on{background:var(--accent-bg);color:var(--accent);font-weight:600}
.exec-badge{font-size:10px;background:var(--accent);color:#fff;border-radius:9px;padding:0 6px}
.exec-clear{margin-top:8px;font:inherit;font-size:11.5px;color:var(--danger-text);background:none;border:none;cursor:pointer;padding:4px 8px}
.exec-search,.exec-date{width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:4px;margin-bottom:6px}
.exec-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}
.exec-chip{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 4px 3px 9px;border-radius:12px;background:var(--accent-bg);color:var(--accent);max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.exec-chip button{display:inline-flex;border:none;background:transparent;color:inherit;cursor:pointer;padding:2px;border-radius:50%}
.exec-chip button:hover{background:rgba(46,117,182,.15)}
.exec-section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-card);padding:14px 16px 16px;margin-bottom:16px}
.exec-section-title{display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.exec-title{font-size:14.5px;font-weight:700;color:var(--navy)}
.exec-caption{font-size:11px;color:var(--muted)}
.exec-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
.exec-portfolio{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.exec-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.exec-chart-card{border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px;min-width:0}
@media (max-width:1100px){.exec-portfolio{grid-template-columns:minmax(0,1fr)}}
.exec-attn-row{display:flex;align-items:stretch;min-width:0}
.exec-attn-grp{min-width:0}
.exec-attn-sep{width:1px;background:var(--border);margin:20px 12px 0;flex-shrink:0}
.exec-attn-hr{height:1px;background:var(--border);margin:12px 0}
.exec-attn-tier{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 6px 2px}
.exec-attn-cards{display:grid;gap:8px}
.exec-attn-card{display:flex;gap:9px;align-items:flex-start;padding:11px 10px;border:none;border-radius:var(--radius-md);cursor:pointer;font:inherit;min-width:0;overflow:hidden;transition:box-shadow .15s,transform .15s}
.exec-attn-card:hover{box-shadow:0 3px 10px rgba(15,41,66,.10);transform:translateY(-1px)}
.exec-attn-table{width:100%;border-collapse:collapse;font-size:12px}
.exec-attn-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;padding:6px 8px;border-bottom:1px solid var(--border)}
.exec-attn-table td{padding:7px 8px;border-bottom:1px solid var(--border);color:var(--text)}
.exec-attn-table a{color:var(--accent);text-decoration:none;font-weight:600}
@media (max-width:1100px){.exec-attn-row{flex-direction:column}.exec-attn-sep{display:none}.exec-attn-grp{margin-bottom:8px}}
.exec-mix{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.6fr);gap:10px}
@media (max-width:1250px){.exec-mix{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.exec-mix>:last-child{grid-column:1 / -1}}
@media (max-width:760px){.exec-mix{grid-template-columns:minmax(0,1fr)}}
.exec-toggle{display:inline-flex;align-items:center;gap:8px;font-size:11.5px;color:var(--text-secondary);cursor:pointer;user-select:none;position:relative}
.exec-toggle input{position:absolute;opacity:0;width:0;height:0}
.exec-toggle-track{width:34px;height:20px;border-radius:10px;background:#cfd6df;position:relative;transition:background .15s;flex-shrink:0}
.exec-toggle-track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.exec-toggle input:checked + .exec-toggle-track{background:#34c759}
.exec-toggle input:checked + .exec-toggle-track::after{transform:translateX(14px)}
.exec-toggle input:focus-visible + .exec-toggle-track{outline:2px solid var(--accent);outline-offset:2px}
.exec-grid-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
@media (max-width:1400px){.exec-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:700px){.exec-grid-4{grid-template-columns:minmax(0,1fr)}}
.exec-grid-7{grid-template-columns:repeat(7,minmax(0,1fr))}
@media (max-width:1180px){.exec-grid:not(.exec-grid-3),.exec-grid-7{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:820px){.exec-grid,.exec-grid-7{grid-template-columns:repeat(2,minmax(0,1fr))}}
.exec-kpi{min-width:0;overflow:hidden;display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);text-decoration:none;color:inherit;transition:box-shadow .15s,border-color .15s}
.exec-kpi:hover{border-color:#c9d3df;box-shadow:0 3px 10px rgba(15,41,66,.08)}
.exec-kpi-icon{display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;flex-shrink:0}
.exec-kpi-label{font-size:11px;font-weight:600;color:var(--text-secondary);line-height:1.25}
.exec-kpi-context{font-size:10px;color:var(--muted);line-height:1.2}
.exec-kpi-value{font-size:clamp(17px,1.6vw,22px);white-space:nowrap;font-weight:700;line-height:1.2;margin-top:2px}
.exec-kpi-sub{display:flex;align-items:center;gap:3px;font-size:10px;color:var(--muted);line-height:1.35}
`;
