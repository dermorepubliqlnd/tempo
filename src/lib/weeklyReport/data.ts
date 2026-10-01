// Weekly Report for Brad (phase128, 2026-10-01).
// Loads everything the weekly deck needs and turns it into plain numbers +
// default narrative text. All rules mirror the Team Dashboard / Utilization
// page so the deck never disagrees with what the app shows:
//   * Report week      = Mon-Fri of the selected week (Sandra: Mon-Fri only)
//   * "This week"      = the Mon-Fri right after the report week
//   * Health           = current state (healthOf uses today), like the dashboard
//   * Utilization      = last week actual (finalized logged / expected),
//                        this + next week planned (allocation engine / capacity)
//   * Development      = projects owned by anyone who is NOT a Trainer
import { supabase } from "../supabaseClient";
import { toISO, parseLocalDate, addDays, isWorkingDay, buildHolidaySet } from "../workingDays";
import { createAllocationEngine, dailyCapacityHours, expectedHoursForDay, type UtilTaskRow, type UtilProjectRow } from "../dailyAllocation";
import { healthOf, type ProjectRow, type TaskRow } from "../../pages/Projects";
import { fmtMD } from "./format";

// ------------------------------------------------------------------ types
export interface Person {
  id: string;
  name: string;
  daily_capacity_hours: number;
  job_title: string | null;
  tracks_time?: boolean | null;
}
interface Lookup { id: string; name: string }
interface Avail { person_id: string; date: string; status: "off" | "half_day" }
interface Entry { person_id: string; task_id: string | null; started_at: string; duration_minutes: number | null }
type P = ProjectRow & { actual_close_date?: string | null; is_unsaved?: boolean | null };
type T = TaskRow & { created_at?: string | null; actual_completion_date?: string | null; is_archived?: boolean | null };

export interface WeekRange { start: string; end: string }
export interface ProjLine { name: string; type: string; planning: string; date: string; extra?: string; warn?: boolean }

export interface WeeklyReportData {
  generatedOn: string;
  week: WeekRange; thisWeek: WeekRange; nextWeek: WeekRange;
  glance: {
    completedProjects: string[]; tasksDone: number; tasksOnTime: number;
    logged: number; expected: number; nonProject: number; doneLogged: number; doneEst: number;
    utilPct: number; starting: number; intake: number; pausedInWeek: number; pausedNow: number; pausedNoResume: number;
  };
  portfolio: { total: number; completed: number; active: number; notStarted: number; paused: number; overdue: number;
    movement: { label: string; started: number; completed: number }[] };
  health: { activeCount: number; buckets: { label: string; count: number }[]; overdue: (ProjLine & { daysLate: number })[]; dueThisWeek: ProjLine[]; closePending: number; offTrack: number };
  drivers: { rows: { name: string; type: string; daysLate: number; what: string; signal: string }[]; grewCount: number; overdueCount: number; tasksAdded: number; hoursAdded: number; extRequests: number; notes: number };
  mix: { rows: { label: string; devPlanned: number; devAdHoc: number; trPlanned: number; trAdHoc: number }[]; active: number; dev: number; trainer: number };
  pipeline: { completed: ProjLine[]; intake: ProjLine[]; starting: ProjLine[]; paused: ProjLine[] };
  util: { roles: { label: string; name: string; people: number; last: number; thisW: number; nextW: number }[];
    overloaded: { name: string; pct: number }[]; room: { name: string; pct: number }[];
    thisPlanned: number; thisCap: number; nextPlanned: number; nextCap: number };
  overall: { rows: { label: string; planned: number; adHoc: number }[]; total: number; untyped: number };
}

// ------------------------------------------------------------------ helpers
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = parseLocalDate(start); toISO(d) <= end; d = addDays(d, 1)) out.push(toISO(d));
  return out;
}
async function fetchAll<R>(build: (from: number, to: number) => PromiseLike<{ data: R[] | null; error: unknown }>): Promise<R[]> {
  const out: R[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
/** Monday (ISO) of the week containing d. */
export function mondayOf(d: Date): string {
  return toISO(addDays(d, -((d.getDay() + 6) % 7)));
}
/** Default report week = last full Mon-Fri before today. */
export function defaultReportMonday(today = new Date()): string {
  return toISO(addDays(parseLocalDate(mondayOf(today)), -7));
}
export function weekOf(monday: string, offsetWeeks = 0): WeekRange {
  const m = addDays(parseLocalDate(monday), offsetWeeks * 7);
  return { start: toISO(m), end: toISO(addDays(m, 4)) };
}
const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : "");
const localDay = (ts: string) => toISO(new Date(ts)); // never ts.slice(0,10) (UTC bug)
const daysBetween = (a: string, b: string) => Math.round((parseLocalDate(b).getTime() - parseLocalDate(a).getTime()) / 86400000);

export const ROLE_PLURAL: Record<string, string> = {
  "Content Developer": "Content Developers",
  "Instructional Designer": "Instructional Designers",
  Trainer: "Trainers",
  "L&D Supervisor": "The L&D Supervisor",
  "L&D Director": "The L&D Director",
};
export const ROLE_SHORT: Record<string, string> = {
  "Content Developer": "Content Dev",
  "Instructional Designer": "Instr. Design",
  Trainer: "Trainers",
  "L&D Supervisor": "Supervisor",
  "L&D Director": "Director",
};

// ------------------------------------------------------------------ main
export async function loadWeeklyReport(monday: string): Promise<WeeklyReportData> {
  const week = weekOf(monday, 0);
  const thisWeek = weekOf(monday, 1);
  const nextWeek = weekOf(monday, 2);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIso = toISO(today);

  const [pe, pr, tk, hol, av, oh, ah, del, settings, ptypes, plans] = await Promise.all([
    supabase.from("people").select("id,name,daily_capacity_hours,job_title,tracks_time").eq("is_active", true).order("name"),
    supabase.from("projects").select("*").eq("is_archived", false),
    fetchAll<T>((f, t) => supabase.from("tasks").select("*").eq("is_archived", false).range(f, t)),
    supabase.from("holidays").select("date"),
    supabase.from("person_availability").select("person_id,date,status"),
    supabase.from("project_owner_history").select("project_id,person_id,effective_from,effective_to"),
    supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to"),
    supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
    supabase.from("app_settings").select("historical_locking_enabled,time_tracking_start_date").eq("id", true).single(),
    supabase.from("project_types").select("id,name"),
    supabase.from("project_planning_types").select("id,name"),
  ]);
  const people = (pe.data as Person[]) ?? [];
  const projects = ((pr.data as P[]) ?? []).filter((p) => !p.is_unsaved);
  const tasks = tk;
  const holidays = ((hol.data as { date: string }[]) ?? []).map((h) => h.date.slice(0, 10));
  const holidaySet = buildHolidaySet(holidays);
  const availability = ((av.data as Avail[]) ?? []).map((a) => ({ ...a, date: a.date.slice(0, 10) }));
  const sd = settings.data as { historical_locking_enabled?: boolean; time_tracking_start_date?: string | null } | null;
  const hist = sd?.historical_locking_enabled ?? false;
  const trackingStart = d10(sd?.time_tracking_start_date) || "2026-08-03";
  const typeName = new Map(((ptypes.data as Lookup[]) ?? []).map((l) => [l.id, l.name]));
  const planName = new Map(((plans.data as Lookup[]) ?? []).map((l) => [l.id, l.name]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const typeOf = (p: P) => (p.project_type_id && typeName.get(p.project_type_id)) || "No type";
  const planOf = (p: P) => (p.planning_type_id && planName.get(p.planning_type_id)) || "—";
  const isAdHoc = (p: P) => planOf(p).toLowerCase().replace(/[^a-z]/g, "") === "adhoc";

  // Finalized time entries from the report week through next week (for logged hours).
  const fromTs = parseLocalDate(week.start).toISOString();
  const toTs = addDays(parseLocalDate(nextWeek.end), 1).toISOString();
  const entries = await fetchAll<Entry>((f, t) =>
    supabase.from("time_entries").select("person_id,task_id,started_at,duration_minutes")
      .in("status", ["confirmed", "approved"]).eq("is_archived", false)
      .gte("started_at", fromTs).lt("started_at", toTs).order("started_at").range(f, t)
  );

  const statusOf = (p: P) => (p.wbs_status === "draft" ? "Not Started" : p.wbs_status === "closed" && p.status !== "Cancelled" ? "Completed" : p.status ?? "Not Started");
  const completionDateOf = (p: P) => d10(p.actual_close_date ?? p.completed_at ?? p.end_date);
  const parentIds = new Set(tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id as string));
  const leaf = tasks.filter((t) => !parentIds.has(t.id));
  const holidayDates = new Set(holidays);
  const live = projects.filter((p) => statusOf(p) !== "Cancelled");
  const inWeek = (d: string, w: WeekRange) => !!d && d >= w.start && d <= w.end;
  const line = (p: P, date: string, extra?: string, warn?: boolean): ProjLine => ({ name: p.name, type: typeOf(p), planning: planOf(p), date, extra, warn });

  // ------------------------------------------------------------ glance
  const completedProjects = live.filter((p) => statusOf(p) === "Completed" && inWeek(completionDateOf(p), week));
  const doneTasks = leaf.filter((t) => t.status === "Done" && inWeek(d10(t.actual_completion_date), week));
  const tasksOnTime = doneTasks.filter((t) => !t.current_due_date || d10(t.actual_completion_date) <= d10(t.current_due_date)).length;
  const loggers = people.filter((p) => p.tracks_time !== false);
  const loggerIds = new Set(loggers.map((p) => p.id));
  const availStatus = new Map<string, "off" | "half_day">();
  for (const a of availability) availStatus.set(`${a.person_id}|${a.date}`, a.status);
  const workDays = (w: WeekRange) => eachDay(w.start, w.end).filter((d) => isWorkingDay(parseLocalDate(d), holidaySet));
  const expectedFor = (pp: Person[], w: WeekRange) => {
    let s = 0;
    for (const d of workDays(w)) if (d >= trackingStart) for (const p of pp) s += expectedHoursForDay(p, availStatus.get(`${p.id}|${d}`));
    return s;
  };
  const loggedFor = (ids: Set<string>, w: WeekRange, onlyNonProject = false) => {
    let m = 0;
    for (const e of entries) {
      if (!ids.has(e.person_id)) continue;
      const d = localDay(e.started_at);
      if (d < w.start || d > w.end || d < trackingStart) continue;
      if (onlyNonProject && e.task_id) continue;
      m += e.duration_minutes ?? 0;
    }
    return m / 60;
  };
  const logged = loggedFor(loggerIds, week);
  const expected = expectedFor(loggers, week);
  const nonProject = loggedFor(loggerIds, week, true);
  // Productivity: hours logged (all time, finalized) vs estimate on tasks completed last week.
  let doneLogged = 0;
  let doneEst = 0;
  const doneIds = doneTasks.filter((t) => Number(t.estimated_hours) > 0).map((t) => t.id);
  for (let i = 0; i < doneIds.length; i += 150) {
    const chunk = doneIds.slice(i, i + 150);
    const { data } = await supabase.from("time_entries").select("task_id,duration_minutes").in("status", ["confirmed", "approved"]).eq("is_archived", false).in("task_id", chunk);
    for (const e of (data as { duration_minutes: number | null }[]) ?? []) doneLogged += (e.duration_minutes ?? 0) / 60;
  }
  for (const t of doneTasks) if (Number(t.estimated_hours) > 0) doneEst += Number(t.estimated_hours);

  const startingP = live.filter((p) => statusOf(p) !== "Completed" && inWeek(d10(p.start_date), thisWeek));
  const intakeP = live.filter((p) => inWeek(localDay(p.created_at), week));
  const pausedNowP = live.filter((p) => statusOf(p) === "Paused");
  const pausedInWeek = live.filter((p) => inWeek(d10(p.paused_at), week)).length;

  // ------------------------------------------------------------ portfolio
  const pfCompleted = completedProjects.length;
  let pfActive = 0, pfNotStarted = 0, pfPaused = 0;
  for (const p of live) {
    const s = statusOf(p);
    if (s === "Completed") continue;
    if (p.start_date && d10(p.start_date) > week.end) continue;
    if (s === "In Progress") pfActive++;
    else if (s === "Paused") pfPaused++;
    else pfNotStarted++;
  }
  const activeP = live.filter((p) => statusOf(p) === "In Progress");
  const healthBy = new Map(activeP.map((p) => [p.id, healthOf(p as ProjectRow, tasks as TaskRow[], holidayDates).label]));
  const overdueP = activeP.filter((p) => healthBy.get(p.id) === "Overdue");
  const movement: WeeklyReportData["portfolio"]["movement"] = [];
  for (let i = 7; i >= 0; i--) {
    const s = toISO(addDays(parseLocalDate(week.start), -7 * i));
    const e = toISO(addDays(parseLocalDate(s), 6));
    const w = { start: s, end: e };
    movement.push({
      label: fmtMD(s),
      started: live.filter((p) => p.wbs_status !== "draft" && inWeek(d10(p.start_date), w)).length,
      completed: live.filter((p) => statusOf(p) === "Completed" && inWeek(completionDateOf(p), w)).length,
    });
  }

  // ------------------------------------------------------------ health
  const ORDER = ["On track", "Done on time · close pending", "Done late · close pending", "At risk", "Off track", "Overdue", "Schedule review", "Not started", "Health unavailable"];
  const counts = new Map<string, number>();
  healthBy.forEach((l) => counts.set(l, (counts.get(l) ?? 0) + 1));
  const buckets = Array.from(counts.entries()).sort((a, b) => (ORDER.indexOf(a[0]) + 99 * +(ORDER.indexOf(a[0]) < 0)) - (ORDER.indexOf(b[0]) + 99 * +(ORDER.indexOf(b[0]) < 0))).map(([label, count]) => ({ label, count }));
  const overdueLines = overdueP
    .map((p) => ({ ...line(p, d10(p.end_date)), daysLate: Math.max(0, daysBetween(d10(p.end_date), todayIso)) }))
    .sort((a, b) => b.daysLate - a.daysLate);
  const dueThisWeek = activeP.filter((p) => inWeek(d10(p.end_date), thisWeek)).map((p) => line(p, d10(p.end_date))).sort((a, b) => a.date.localeCompare(b.date));

  // ------------------------------------------------------------ drivers (overdue projects)
  const ovIds = overdueP.map((p) => p.id);
  let driverRows: WeeklyReportData["drivers"]["rows"] = [];
  let grew = 0, tasksAdded = 0, hoursAdded = 0, extCount = 0, noteCount = 0;
  if (ovIds.length) {
    const [bl, ext, revs, notes] = await Promise.all([
      supabase.from("project_baselines").select("project_id,captured_at,task_count,total_est_hours").in("project_id", ovIds),
      supabase.from("extension_requests").select("project_id,task_id,reason_category,reason_notes,status,created_at").in("project_id", ovIds).order("created_at", { ascending: false }),
      supabase.from("project_revisions").select("id,project_id").in("project_id", ovIds),
      supabase.from("project_notes").select("project_id,body,created_at").in("project_id", ovIds).order("created_at", { ascending: false }),
    ]);
    const revRows = (revs.data as { id: string; project_id: string }[]) ?? [];
    const revProject = new Map(revRows.map((r) => [r.id, r.project_id]));
    const changes = revRows.length
      ? ((await supabase.from("project_revision_changes").select("revision_id,change_type").in("revision_id", revRows.map((r) => r.id))).data as { revision_id: string; change_type: string }[]) ?? []
      : [];
    const baselines = new Map((((bl.data as { project_id: string; captured_at: string; task_count: number; total_est_hours: number }[]) ?? [])).map((b) => [b.project_id, b]));
    const exts = (ext.data as { project_id: string; task_id: string; reason_category: string; reason_notes: string; created_at: string }[]) ?? [];
    const notesRows = (notes.data as { project_id: string; body: string; created_at: string }[]) ?? [];
    extCount = exts.length;
    noteCount = notesRows.length;
    driverRows = overdueLines.slice(0, 5).map((o) => {
      const p = overdueP.find((x) => x.name === o.name && x.end_date && d10(x.end_date) === o.date) as P;
      const b = baselines.get(p.id);
      const pl = leaf.filter((t) => t.project_id === p.id);
      const added = b ? pl.filter((t) => t.created_at && t.created_at > b.captured_at) : [];
      const addedH = added.reduce((s, t) => s + (Number(t.estimated_hours) || 0), 0);
      const end = d10(p.end_date);
      const addedLate = added.filter((t) => t.created_at && localDay(t.created_at) > end);
      const ch = changes.filter((c) => revProject.get(c.revision_id) === p.id);
      const cnt = (k: string) => ch.filter((c) => c.change_type === k).length;
      const dateCh = cnt("date_changed"), removed = cnt("task_removed");
      const openPast = pl.filter((t) => t.status !== "Done" && t.status !== "Cancelled" && t.current_due_date && d10(t.current_due_date) < todayIso).length;
      const e = exts.find((x) => x.project_id === p.id);
      const n = notesRows.find((x) => x.project_id === p.id);
      if (added.length) grew++;
      tasksAdded += added.length;
      hoursAdded += addedH;
      const parts: string[] = [];
      if (added.length) {
        const span = Array.from(new Set(added.map((t) => fmtMD(localDay(t.created_at as string))))).slice(0, 2).join("–");
        parts.push(`${added.length} task${added.length > 1 ? "s" : ""} (${round1(addedH)}h) added after Start Project (${span})${addedLate.length ? `, ${addedLate.length} after the ${fmtMD(end)} End Date` : ""}.`);
      }
      if (dateCh >= 3 || removed) parts.push(`${dateCh} date change${dateCh === 1 ? "" : "s"}${removed ? `, ${removed} task${removed > 1 ? "s" : ""} removed` : ""} since baseline.`);
      if (openPast) parts.push(`${openPast} task${openPast > 1 ? "s" : ""} still past due.`);
      if (e) parts.push(`Extension: ${e.reason_category}${e.reason_notes ? ` — “${e.reason_notes.slice(0, 70)}”` : ""}.`);
      else if (n) parts.push(`Note (${fmtMD(localDay(n.created_at))}): “${n.body.slice(0, 70)}”.`);
      if (!parts.length) parts.push("No scope or date changes logged in Tempo.");
      let signal = "No change logged";
      if (e) signal = "Extension filed";
      else if (addedLate.length) signal = "Scope added late";
      else if (b && b.task_count <= 2 && added.length) signal = "Under-scoped";
      else if (dateCh >= 10 || removed) signal = "Re-planned";
      else if (added.length) signal = "Scope added";
      else if (dateCh) signal = "Re-dated";
      return { name: p.name, type: typeOf(p), daysLate: o.daysLate, what: parts.join(" "), signal };
    });
  }

  // ------------------------------------------------------------ mix (active)
  const isTrainer = (p: P) => (personById.get(p.owner_id ?? "")?.job_title ?? "").trim().toLowerCase() === "trainer";
  const mixRow = (label: string, list: P[]) => ({
    label: `${label} (${list.length})`,
    devPlanned: list.filter((p) => !isTrainer(p) && !isAdHoc(p)).length,
    devAdHoc: list.filter((p) => !isTrainer(p) && isAdHoc(p)).length,
    trPlanned: list.filter((p) => isTrainer(p) && !isAdHoc(p)).length,
    trAdHoc: list.filter((p) => isTrainer(p) && isAdHoc(p)).length,
  });
  const typesActive = Array.from(new Set(activeP.map(typeOf))).sort((a, b) => activeP.filter((p) => typeOf(p) === b).length - activeP.filter((p) => typeOf(p) === a).length);
  const mixRows = [mixRow("All active", activeP), ...typesActive.map((t) => mixRow(t, activeP.filter((p) => typeOf(p) === t)))];
  const trainerActive = activeP.filter(isTrainer).length;

  // ------------------------------------------------------------ pipeline
  const pipeline = {
    completed: completedProjects.map((p) => line(p, completionDateOf(p))),
    intake: intakeP.map((p) => line(p, localDay(p.created_at), statusOf(p))),
    starting: startingP.map((p) => line(p, d10(p.start_date))).sort((a, b) => a.date.localeCompare(b.date)),
    paused: pausedNowP.map((p) => {
      const days = p.paused_at ? Math.max(0, daysBetween(d10(p.paused_at), todayIso)) : 0;
      const resume = d10(p.pause_expected_resume);
      return line(p, resume ? fmtMD(resume) : "Not set", String(days), !resume || resume < todayIso);
    }),
  };

  // ------------------------------------------------------------ utilization by role
  const engine = createAllocationEngine({
    tasks: tasks as unknown as UtilTaskRow[],
    projects: projects as unknown as UtilProjectRow[],
    holidays: holidaySet,
    availability,
    assigneeHistory: hist ? ((ah.data as never[]) ?? []) : [],
    ownerHistory: hist ? ((oh.data as never[]) ?? []) : [],
    todayStr: todayIso,
    deletedHours: (del.data as { person_id: string; date: string; hours: number }[]) ?? [],
  });
  const capOn = (p: Person, d: string) => {
    if (!isWorkingDay(parseLocalDate(d), holidaySet)) return 0;
    const st = availStatus.get(`${p.id}|${d}`);
    return st === "off" ? 0 : dailyCapacityHours(p as never, st === "half_day");
  };
  const planned = (p: Person, w: WeekRange) => {
    let pl = 0, cap = 0;
    for (const d of eachDay(w.start, w.end)) {
      const c = capOn(p, d);
      if (c <= 0) continue;
      cap += c;
      pl += engine.totalFor(p.id, d);
    }
    return { pl, cap };
  };
  const groupStats = (pp: Person[]) => {
    const ids = new Set(pp.map((p) => p.id));
    const exp = expectedFor(pp, week);
    let tp = 0, tc = 0, np = 0, nc = 0;
    for (const p of pp) {
      const a = planned(p, thisWeek), b = planned(p, nextWeek);
      tp += a.pl; tc += a.cap; np += b.pl; nc += b.cap;
    }
    return { last: exp > 0 ? loggedFor(ids, week) / exp : 0, thisW: tc > 0 ? tp / tc : 0, nextW: nc > 0 ? np / nc : 0, tp, tc, np, nc };
  };
  const team = groupStats(loggers);
  const roleNames = Array.from(new Set(loggers.map((p) => p.job_title || "No role")));
  roleNames.sort((a, b) => loggers.filter((p) => (p.job_title || "No role") === b).length - loggers.filter((p) => (p.job_title || "No role") === a).length);
  const roles = [
    { label: `Team (${loggers.length})`, name: "The team", people: loggers.length, last: team.last, thisW: team.thisW, nextW: team.nextW },
    ...roleNames.map((r) => {
      const pp = loggers.filter((p) => (p.job_title || "No role") === r);
      const g = groupStats(pp);
      return { label: `${ROLE_SHORT[r] ?? r} (${pp.length})`, name: ROLE_PLURAL[r] ?? (pp.length > 1 ? `${r}s` : r), people: pp.length, last: g.last, thisW: g.thisW, nextW: g.nextW };
    }),
  ];
  const perPerson = loggers.map((p) => {
    const a = planned(p, thisWeek), b = planned(p, nextWeek);
    return { name: p.name.split(" ")[0], thisPct: a.cap > 0 ? a.pl / a.cap : 0, nextPct: b.cap > 0 ? b.pl / b.cap : 0 };
  });

  // ------------------------------------------------------------ overall mix (appendix)
  const typesAll = Array.from(new Set(live.map(typeOf))).filter((t) => t !== "No type");
  typesAll.sort((a, b) => live.filter((p) => typeOf(p) === b).length - live.filter((p) => typeOf(p) === a).length);
  const overall = {
    rows: typesAll.map((t) => {
      const l = live.filter((p) => typeOf(p) === t);
      return { label: t, planned: l.filter((p) => !isAdHoc(p)).length, adHoc: l.filter(isAdHoc).length };
    }),
    total: live.length,
    untyped: live.filter((p) => typeOf(p) === "No type").length,
  };

  return {
    generatedOn: todayIso, week, thisWeek, nextWeek,
    glance: {
      completedProjects: completedProjects.map((p) => p.name), tasksDone: doneTasks.length, tasksOnTime,
      logged, expected, nonProject, doneLogged, doneEst, utilPct: expected > 0 ? logged / expected : 0,
      starting: startingP.length, intake: intakeP.length, pausedInWeek, pausedNow: pausedNowP.length,
      pausedNoResume: pausedNowP.filter((p) => !p.pause_expected_resume).length,
    },
    portfolio: { total: pfCompleted + pfActive + pfNotStarted + pfPaused, completed: pfCompleted, active: pfActive, notStarted: pfNotStarted, paused: pfPaused, overdue: overdueP.length, movement },
    health: { activeCount: activeP.length, buckets, overdue: overdueLines, dueThisWeek, closePending: (counts.get("Done on time · close pending") ?? 0) + (counts.get("Done late · close pending") ?? 0), offTrack: counts.get("Off track") ?? 0 },
    drivers: { rows: driverRows, grewCount: grew, overdueCount: overdueP.length, tasksAdded, hoursAdded, extRequests: extCount, notes: noteCount },
    mix: { rows: mixRows, active: activeP.length, dev: activeP.length - trainerActive, trainer: trainerActive },
    pipeline,
    util: {
      roles,
      overloaded: perPerson.filter((x) => x.thisPct > 1.005).sort((a, b) => b.thisPct - a.thisPct).map((x) => ({ name: x.name, pct: x.thisPct })),
      room: perPerson.filter((x) => x.nextPct < 0.5).sort((a, b) => a.nextPct - b.nextPct).map((x) => ({ name: x.name, pct: x.nextPct })),
      thisPlanned: team.tp, thisCap: team.tc, nextPlanned: team.np, nextCap: team.nc,
    },
    overall,
  };
}
function round1(n: number) { return Math.round(n * 10) / 10; }
