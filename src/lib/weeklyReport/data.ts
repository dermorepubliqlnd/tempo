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
import { fetchAllRows } from "../fetchAllRows";
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
interface Entry { person_id: string; task_id: string | null; activity_type_id?: string | null; started_at: string; duration_minutes: number | null }
type P = ProjectRow & { actual_close_date?: string | null; is_unsaved?: boolean | null };
type T = TaskRow & { created_at?: string | null; actual_completion_date?: string | null; is_archived?: boolean | null };

export interface WeekRange { start: string; end: string }
export interface ProjLine { name: string; type: string; planning: string; date: string; extra?: string; warn?: boolean }

export interface WeeklyReportData {
  /** "Training Delivery", or "Ongoing" when ongoing containers exist too (phase161). */
  opLabel: string;
  generatedOn: string;
  week: WeekRange; thisWeek: WeekRange; nextWeek: WeekRange;
  glance: {
    completedProjects: string[]; completedDetail: { name: string; date: string; onTime: boolean | null }[]; tasksDone: number; tasksOnTime: number;
    logged: number; expected: number; nonProject: number; doneLogged: number; doneEst: number;
    utilPct: number; starting: number; awaitingStart: number; intake: number; pausedInWeek: number; pausedNow: number; pausedNoResume: number;
  };
  portfolio: { total: number; completed: number; active: number; operationalActive: number; notStarted: number; paused: number; overdue: number;
    movement: { label: string; started: number; completed: number }[] };
  health: { activeCount: number; operationalActive: number; buckets: { label: string; count: number }[]; overdue: (ProjLine & { daysLate: number })[]; dueThisWeek: ProjLine[]; closePending: number; offTrack: number };
  drivers: { rows: { name: string; type: string; daysLate: number; what: string; signal: string }[]; grewCount: number; overdueCount: number; tasksAdded: number; hoursAdded: number; extRequests: number; notes: number };
  mix: { rows: { label: string; devPlanned: number; devAdHoc: number; trPlanned: number; trAdHoc: number }[]; active: number; dev: number; trainer: number };
  pipeline: { completed: ProjLine[]; intake: ProjLine[]; starting: ProjLine[]; awaitingStart: ProjLine[]; paused: ProjLine[] };
  util: { roles: { label: string; name: string; people: number; last: number; thisW: number; nextW: number }[];
    overloaded: { name: string; pct: number }[]; room: { name: string; pct: number }[];
    thisPlanned: number; thisCap: number; nextPlanned: number; nextCap: number };
  overall: { rows: { label: string; planned: number; adHoc: number }[]; total: number; untyped: number };
  // Sandra 2026-10-05: Portfolio overview = YTD totals + monthly movement;
  // Work mix = Scoped Hours YTD by Project Type x Planning Type + active Health/Phase.
  ytd: {
    start: string; end: string; total: number; completed: number; active: number; operationalActive: number; notStartedPaused: number;
    movement: { label: string; started: number; completed: number }[];
    mix: { total: number; projects: number; planTypes: { label: string; value: number }[]; bars: { label: string; total: number; parts: Record<string, number> }[] };
    activeHealth: { total: number; operationalExcluded: number; health: { label: string; count: number }[]; phase: { label: string; count: number }[] };
  };
  // Speaker notes per slide (plain text; "- " lines are bullets). Editable on the Reports page.
  notes: Record<"cover" | "glance" | "portfolio" | "health" | "drivers" | "mix" | "pipeline" | "util" | "training" | "appendix", string>;
  // phase151: sessions in operational projects (e.g. quarterly Training Delivery).
  training: {
    projects: number;
    delivered: number; validated: number; cancelled: number; loggedHours: number; scopedHours: number;
    thisWeek: number; pastNotDone: number; qtdDelivered: number; qtdLabel: string;
    trainers: { name: string; delivered: number; validated: number; hours: number; thisWeek: number; pastNotDone: number }[];
  };
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
    fetchAllRows((f, t) => supabase.from("task_assignee_history").select("task_id,person_id,effective_from,effective_to").order("id").range(f, t)),
    supabase.from("deleted_person_day_hours").select("person_id,date,hours"),
    supabase.from("app_settings").select("historical_locking_enabled,time_tracking_start_date").eq("id", true).single(),
    supabase.from("project_types").select("id,name,uses_sessions"),
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
  // phase161: ongoing (operational) projects are Training Delivery unless an
  // "Ongoing container" project (e.g. a BAU revisions bucket) is in play.
  const sessionTypeIdsPT = new Set(((ptypes.data as (Lookup & { uses_sessions?: boolean })[]) ?? []).filter((l) => l.uses_sessions).map((l) => l.id));
  const opLabel = projects.some((p) => (p as { is_operational?: boolean | null }).is_operational && !(p.project_type_id && sessionTypeIdsPT.has(p.project_type_id)) && p.status !== "Completed" && p.status !== "Cancelled" && p.wbs_status !== "closed")
    ? "Ongoing"
    : "Training Delivery";
  const planName = new Map(((plans.data as Lookup[]) ?? []).map((l) => [l.id, l.name]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const typeOf = (p: P) => (p.project_type_id && typeName.get(p.project_type_id)) || "No type";
  const planOf = (p: P) => (p.planning_type_id && planName.get(p.planning_type_id)) || "—";
  const isAdHoc = (p: P) => planOf(p).toLowerCase().replace(/[^a-z]/g, "") === "adhoc";

  // Finalized time entries from the report week through next week (for logged hours).
  const fromTs = parseLocalDate(week.start).toISOString();
  const toTs = addDays(parseLocalDate(nextWeek.end), 1).toISOString();
  const entries = await fetchAll<Entry>((f, t) =>
    supabase.from("time_entries").select("person_id,task_id,activity_type_id,started_at,duration_minutes")
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
  const loggedByTask = new Map<string, number>();
  let doneEst = 0;
  const doneIds = doneTasks.filter((t) => Number(t.estimated_hours) > 0).map((t) => t.id);
  for (let i = 0; i < doneIds.length; i += 150) {
    const chunk = doneIds.slice(i, i + 150);
    const { data } = await supabase.from("time_entries").select("task_id,duration_minutes").in("status", ["confirmed", "approved"]).eq("is_archived", false).in("task_id", chunk);
    for (const e of (data as { task_id: string; duration_minutes: number | null }[]) ?? []) {
      doneLogged += (e.duration_minutes ?? 0) / 60;
      loggedByTask.set(e.task_id, (loggedByTask.get(e.task_id) ?? 0) + (e.duration_minutes ?? 0) / 60);
    }
  }
  for (const t of doneTasks) if (Number(t.estimated_hours) > 0) doneEst += Number(t.estimated_hours);

  // Sandra 2026-10-05: paused projects stay under Paused, not "Starting this week".
  // Sandra 2026-10-05: "Starting this week" = Start Project approved (baseline
  // locked) only. Drafts planned for this week stay in the pipeline as
  // awaiting confirmation.
  const startingP = live.filter((p) => p.wbs_status !== "draft" && statusOf(p) !== "Completed" && statusOf(p) !== "Paused" && inWeek(d10(p.start_date), thisWeek));
  const awaitingStartP = live.filter((p) => p.wbs_status === "draft" && inWeek(d10(p.start_date), thisWeek));
  const pausedStartingP = live.filter((p) => statusOf(p) === "Paused" && inWeek(d10(p.start_date), thisWeek));
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
  // phase149: operational projects (e.g. quarterly Training Delivery) have no
  // date-based health -- keep them out of the health/overdue/due-this-week slides.
  // Sandra 2026-10-05: operational projects (Training Delivery) STAY in the
  // portfolio counts and mix; only date-based health/overdue/due-this-week
  // leave them out. The Training delivery slide is the drill-down.
  const activeAll = live.filter((p) => statusOf(p) === "In Progress");
  const activeP = activeAll.filter((p) => !(p as { is_operational?: boolean | null }).is_operational);
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
  const typesActive = Array.from(new Set(activeAll.map(typeOf))).sort((a, b) => activeAll.filter((p) => typeOf(p) === b).length - activeAll.filter((p) => typeOf(p) === a).length);
  const mixRows = [mixRow("All active", activeAll), ...typesActive.map((t) => mixRow(t, activeAll.filter((p) => typeOf(p) === t)))];
  const trainerActive = activeAll.filter(isTrainer).length;

  // ------------------------------------------------------------ pipeline
  const pipeline = {
    completed: completedProjects.map((p) => line(p, completionDateOf(p))),
    intake: intakeP.map((p) => line(p, localDay(p.created_at), statusOf(p))),
    starting: startingP.map((p) => line(p, d10(p.start_date))).sort((a, b) => a.date.localeCompare(b.date)),
    awaitingStart: awaitingStartP.map((p) => line(p, d10(p.start_date))).sort((a, b) => a.date.localeCompare(b.date)),
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

  // ------------------------------------------------------------ training delivery (phase151)
  // Session = leaf task with Output Type "Session" in an operational project.
  // Delivered = Done with Actual Completion Date in the report week; hours =
  // finalized time logged on session tasks during the report week.
  const opIds = new Set(projects.filter((p) => (p as { is_operational?: boolean | null }).is_operational && !(p as { is_ongoing_container?: boolean | null }).is_ongoing_container).map((p) => p.id));
  const { data: otData } = await supabase.from("output_types").select("id,name");
  const sessionTypeIds = new Set(((otData as Lookup[]) ?? []).filter((o) => o.name.trim().toLowerCase() === "session").map((o) => o.id));
  const sessions = leaf.filter((t) => opIds.has(t.project_id) && !!t.output_type_id && sessionTypeIds.has(t.output_type_id));
  const sessionIds = new Set(sessions.map((t) => t.id));
  const tDone = sessions.filter((t) => t.status === "Done" && inWeek(d10(t.actual_completion_date ?? t.current_due_date), week));
  const tCancelled = sessions.filter((t) => t.status === "Cancelled" && inWeek(d10(t.current_due_date), week));
  const tThis = sessions.filter((t) => t.status !== "Done" && t.status !== "Cancelled" && inWeek(d10(t.current_due_date), thisWeek));
  const tPast = sessions.filter((t) => t.status !== "Done" && t.status !== "Cancelled" && !!t.current_due_date && d10(t.current_due_date) < todayIso);
  const qStartMonth = Math.floor(parseLocalDate(week.end).getMonth() / 3) * 3;
  const qYear = parseLocalDate(week.end).getFullYear();
  const qStart = toISO(new Date(qYear, qStartMonth, 1));
  const tQtd = sessions.filter((t) => t.status === "Done" && d10(t.actual_completion_date ?? t.current_due_date) >= qStart && d10(t.actual_completion_date ?? t.current_due_date) <= week.end);
  const sessionHoursBy = new Map<string, number>();
  let sessionHours = 0;
  for (const e of entries) {
    if (!e.task_id || !sessionIds.has(e.task_id)) continue;
    const d = localDay(e.started_at);
    if (d < week.start || d > week.end) continue;
    const h = (e.duration_minutes ?? 0) / 60;
    sessionHours += h;
    sessionHoursBy.set(e.person_id, (sessionHoursBy.get(e.person_id) ?? 0) + h);
  }
  const trainerIds = new Set<string>([...tDone, ...tThis, ...tPast].map((t) => t.assignee_id ?? "").filter(Boolean));
  sessionHoursBy.forEach((_, k) => trainerIds.add(k));
  const trainersRows = Array.from(trainerIds)
    .map((id) => ({
      name: personById.get(id)?.name ?? "Unknown",
      delivered: tDone.filter((t) => t.assignee_id === id).length,
      validated: tDone.filter((t) => t.assignee_id === id && !!t.validated_completion_date).length,
      hours: round1(sessionHoursBy.get(id) ?? 0),
      thisWeek: tThis.filter((t) => t.assignee_id === id).length,
      pastNotDone: tPast.filter((t) => t.assignee_id === id).length,
    }))
    .sort((a, b) => b.delivered - a.delivered || b.hours - a.hours || a.name.localeCompare(b.name));
  const training: WeeklyReportData["training"] = {
    projects: opIds.size,
    delivered: tDone.length,
    validated: tDone.filter((t) => !!t.validated_completion_date).length,
    cancelled: tCancelled.length,
    loggedHours: round1(sessionHours),
    scopedHours: round1(tDone.reduce((a, t) => a + Number(t.estimated_hours ?? 0), 0)),
    thisWeek: tThis.length,
    pastNotDone: tPast.length,
    qtdDelivered: tQtd.length,
    qtdLabel: `Q${qStartMonth / 3 + 1} ${qYear}`,
    trainers: trainersRows,
  };

  // ------------------------------------------------------------ YTD portfolio + work mix (Sandra 2026-10-05)
  // Mirrors the Executive Dashboard (Portfolio Overview YTD, Portfolio Movement
  // by month, Work Mix & Effort Allocation, Active Projects Health), but as of
  // the report week's Friday instead of today.
  const isOp = (p: P) => !!(p as { is_operational?: boolean | null }).is_operational;
  const ytdStart = `${week.end.slice(0, 4)}-01-01`;
  const ytdEnd = week.end;
  // Sandra 2026-10-05: one basis -- open projects counted as of TODAY (same as
  // the Health donut), completed counted Jan 1 -> report-week Friday.
  // Active projects (regular) and Training Delivery are shown separately.
  let yCompleted = 0, yActive = 0, yOpActive = 0, yOther = 0;
  for (const p of live) {
    const st = statusOf(p);
    if (st === "Completed") { const cd = completionDateOf(p); if (cd && cd >= ytdStart && cd <= ytdEnd) yCompleted++; continue; }
    if (st === "In Progress") { if (isOp(p)) yOpActive++; else yActive++; continue; }
    if (p.start_date && d10(p.start_date) > todayIso) continue;
    yOther++;
  }
  const months: { label: string; from: string; to: string }[] = [];
  for (let m = new Date(Number(ytdStart.slice(0, 4)), 0, 1); toISO(m) <= ytdEnd; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const last = toISO(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    months.push({ label: m.toLocaleDateString("en-US", { month: "short" }), from: toISO(m), to: last > ytdEnd ? ytdEnd : last });
  }
  const ytdMovementAll = months.map((b) => ({
    label: b.label,
    started: live.filter((p) => p.wbs_status !== "draft" && !!p.start_date && d10(p.start_date) >= b.from && d10(p.start_date) <= b.to).length,
    completed: live.filter((p) => statusOf(p) === "Completed" && completionDateOf(p) >= b.from && completionDateOf(p) <= b.to).length,
  }));
  // Skip the empty months before Tempo has any data (tracking started mid-year).
  const firstActive = ytdMovementAll.findIndex((m) => m.started || m.completed);
  const ytdMovement = firstActive > 0 ? ytdMovementAll.slice(Math.max(0, firstActive - 1)) : ytdMovementAll;
  // Scoped Hours spread over each task's working days, counting only days in YTD.
  const ytdByProject = new Map<string, number>();
  for (const t of leaf) {
    if (!t.assignee_id || !personById.has(t.assignee_id) || !t.estimated_hours) continue;
    const proj = projects.find((x) => x.id === t.project_id);
    if (!proj || statusOf(proj) === "Cancelled") continue;
    const days = engine.taskDays(t.assignee_id, t as unknown as UtilTaskRow);
    if (!days.size) continue;
    let inWin = 0;
    days.forEach((d) => { if (d >= ytdStart && d <= ytdEnd) inWin++; });
    if (!inWin) continue;
    ytdByProject.set(t.project_id, (ytdByProject.get(t.project_id) ?? 0) + (Number(t.estimated_hours) * inWin) / days.size);
  }
  const planTot = new Map<string, number>();
  const typeTot = new Map<string, number>();
  const cell = new Map<string, Map<string, number>>();
  let mixTotal = 0;
  ytdByProject.forEach((h, pid) => {
    const p = projects.find((x) => x.id === pid)!;
    const pl = p.planning_type_id ? planName.get(p.planning_type_id) ?? "Not set" : "Not set";
    const ty = typeOf(p) === "No type" ? "Not set" : typeOf(p);
    planTot.set(pl, (planTot.get(pl) ?? 0) + h);
    typeTot.set(ty, (typeTot.get(ty) ?? 0) + h);
    if (!cell.has(ty)) cell.set(ty, new Map());
    cell.get(ty)!.set(pl, (cell.get(ty)!.get(pl) ?? 0) + h);
    mixTotal += h;
  });
  const planTypes = Array.from(planTot.entries()).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value: round1(value) }));
  const mixBars = Array.from(typeTot.entries()).sort((a, b) => b[1] - a[1]).map(([label, total]) => ({
    label, total: round1(total), parts: Object.fromEntries(planTypes.map((pt) => [pt.label, round1(cell.get(label)?.get(pt.label) ?? 0)])),
  }));
  const HORDER = ["On track", "Done on time · close pending", "Done late · close pending", "At risk", "Off track", "Overdue", "Schedule review", "Not started", "Health unavailable"];
  const hc = new Map<string, number>();
  for (const p of activeP) { const l = healthBy.get(p.id) ?? "Health unavailable"; hc.set(l, (hc.get(l) ?? 0) + 1); }
  const pc = new Map<string, number>();
  for (const p of activeP) { const l = p.phase || "Not set"; pc.set(l, (pc.get(l) ?? 0) + 1); }
  const ytd: WeeklyReportData["ytd"] = {
    start: ytdStart, end: ytdEnd, total: yCompleted + yActive + yOpActive + yOther, completed: yCompleted, active: yActive, operationalActive: yOpActive, notStartedPaused: yOther,
    movement: ytdMovement,
    mix: { total: round1(mixTotal), projects: ytdByProject.size, planTypes, bars: mixBars },
    activeHealth: {
      total: activeP.length, operationalExcluded: activeAll.length - activeP.length,
      health: Array.from(hc.entries()).sort((a, b) => (HORDER.indexOf(a[0]) + 99 * +(HORDER.indexOf(a[0]) < 0)) - (HORDER.indexOf(b[0]) + 99 * +(HORDER.indexOf(b[0]) < 0))).map(([label, count]) => ({ label, count })),
      phase: Array.from(pc.entries()).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    },
  };

  // ------------------------------------------------------------ speaker notes (Sandra 2026-10-05)
  // "Put in the notes what those are; extract the reason if you can."
  const [allPeopleRes, actTypesRes] = await Promise.all([
    supabase.from("people").select("id,name"),
    supabase.from("non_project_activity_types").select("id,name"),
  ]);
  const nameOf = new Map(((allPeopleRes.data as Lookup[]) ?? []).map((x) => [x.id, x.name]));
  const actName = new Map(((actTypesRes.data as Lookup[]) ?? []).map((x) => [x.id, x.name]));
  const projById = new Map(projects.map((p) => [p.id, p]));
  const who = (id: string | null | undefined) => (id && nameOf.get(id)) || "Unassigned";
  const md = (d: string | null | undefined) => (d ? fmtMD(d.slice(0, 10)) : "no date");
  const h1 = (n: number) => `${round1(n)}h`;
  const bl = (items: string[], empty = "None.") => (items.length ? items.map((x) => `- ${x}`).join("\n") : `- ${empty}`);
  const cap = (items: string[], max: number) => (items.length > max ? [...items.slice(0, max), `…and ${items.length - max} more (see Tempo)`] : items);
  const projLabel = (p: P) => `${p.name} (P-${String(p.project_number).padStart(4, "0")}, ${typeOf(p)} · ${planOf(p)}, owner ${who(p.owner_id)})`;
  const pauseWhy = (p: P) => [p.pause_category, p.pause_reason].filter((x) => x && String(x).trim()).join(" — ") || "no reason recorded";

  // Delivery
  const completedNotes = completedProjects.map((p) => {
    const done = completionDateOf(p), end = d10(p.end_date);
    return `${projLabel(p)} — completed ${md(done)}${end ? (done <= end ? " (on time)" : ` (late vs End Date ${md(end)})`) : ""}`;
  });
  const lateTasks = doneTasks.filter((t) => t.current_due_date && d10(t.actual_completion_date) > d10(t.current_due_date));
  const byProj = new Map<string, number>();
  for (const t of doneTasks) byProj.set(t.project_id, (byProj.get(t.project_id) ?? 0) + 1);
  const tasksByProject = Array.from(byProj.entries()).sort((a, b) => b[1] - a[1]).map(([pid, n]) => `${projById.get(pid)?.name ?? "Unknown project"}: ${n}`);
  const lateNotes = lateTasks.map((t) => `${t.name} (${projById.get(t.project_id)?.name ?? "—"}, ${who(t.assignee_id)}) — due ${md(t.current_due_date)}, done ${md(t.actual_completion_date)}`);
  const overEst = doneTasks
    .filter((t) => Number(t.estimated_hours) > 0 && (loggedByTask.get(t.id) ?? 0) > Number(t.estimated_hours) * 1.25 + 0.5)
    .map((t) => ({ t, over: (loggedByTask.get(t.id) ?? 0) - Number(t.estimated_hours) }))
    .sort((a, b) => b.over - a.over)
    .map(({ t }) => `${t.name} (${projById.get(t.project_id)?.name ?? "—"}) — ${h1(loggedByTask.get(t.id) ?? 0)} logged vs ${h1(Number(t.estimated_hours))} estimated`);

  // Utilization (last week)
  const perLogger = loggers.map((p) => {
    const ids = new Set([p.id]);
    const exp = expectedFor([p], week), lg = loggedFor(ids, week);
    return { name: p.name, exp, lg, gap: exp - lg };
  });
  const gaps = perLogger.filter((x) => x.gap >= 2).sort((a, b) => b.gap - a.gap).map((x) => `${x.name}: ${h1(x.lg)} of ${h1(x.exp)} (${h1(x.gap)} not logged)`);
  const npBy = new Map<string, number>();
  for (const e of entries) {
    if (e.task_id || !loggerIds.has(e.person_id)) continue;
    const d = localDay(e.started_at);
    if (d < week.start || d > week.end || d < trackingStart) continue;
    const k = (e.activity_type_id && actName.get(e.activity_type_id)) || "Other";
    npBy.set(k, (npBy.get(k) ?? 0) + (e.duration_minutes ?? 0) / 60);
  }
  const npNotes = Array.from(npBy.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${h1(v)}`);

  // Pipeline
  const startingNotes = startingP.sort((a, b) => d10(a.start_date).localeCompare(d10(b.start_date))).map((p) => `${projLabel(p)} — starts ${md(p.start_date)}`);
  const intakeNotes = intakeP.map((p) => `${projLabel(p)} — added ${md(localDay(p.created_at))}, now ${statusOf(p)}`);
  const pausedWeekP = live.filter((p) => inWeek(d10(p.paused_at), week));
  const pausedNotes = (list: P[]) =>
    list.map((p) => {
      const days = p.paused_at ? Math.max(0, daysBetween(d10(p.paused_at), todayIso)) : 0;
      return `${projLabel(p)} — paused ${md(p.paused_at)} (${days} days); reason: ${pauseWhy(p)}; expected resume: ${p.pause_expected_resume ? md(p.pause_expected_resume) : "not set"}`;
    });

  // Health
  const overdueNotes = overdueLines.map((o) => {
    const p = overdueP.find((x) => x.name === o.name) as P | undefined;
    const dr = driverRows.find((r) => r.name === o.name);
    return `${o.name}${p ? ` (owner ${who(p.owner_id)})` : ""} — End Date ${md(o.date)}, ${o.daysLate} days late${dr ? `. Why: ${dr.what}` : ""}`;
  });
  const healthList = (label: string) => activeP.filter((p) => healthBy.get(p.id) === label).map((p) => `${p.name} (owner ${who(p.owner_id)}, End Date ${md(p.end_date)})`);
  const closePendingNotes = activeP.filter((p) => (healthBy.get(p.id) ?? "").includes("close pending")).map((p) => `${p.name} (owner ${who(p.owner_id)})`);
  const opActive = activeAll.filter((p) => (p as { is_operational?: boolean | null }).is_operational);

  // Utilization (this/next week)
  const overNotes = perPerson.filter((x) => x.thisPct > 1.005).sort((a, b) => b.thisPct - a.thisPct).map((x) => `${x.name}: ${Math.round(x.thisPct * 100)}% planned this week, ${Math.round(x.nextPct * 100)}% next week`);
  const roomNotes = perPerson.filter((x) => x.nextPct < 0.5).sort((a, b) => a.nextPct - b.nextPct).map((x) => `${x.name}: ${Math.round(x.thisPct * 100)}% this week, ${Math.round(x.nextPct * 100)}% next week`);

  // Training
  const sessionLine = (t: T) => `${t.name} — ${who(t.assignee_id)}, ${md(t.status === "Done" ? t.actual_completion_date ?? t.current_due_date : t.current_due_date)}${t.status === "Done" ? (t.validated_completion_date ? ", validated" : ", awaiting validation") : ""}`;

  const notes: WeeklyReportData["notes"] = {
    cover: `Report week: ${md(week.start)} – ${md(week.end)} (Mon–Fri). "This week" = ${md(thisWeek.start)} – ${md(thisWeek.end)}. Generated ${md(todayIso)} from Tempo; health and paused figures are as of the generation date.`,
    glance: [
      "DELIVERY · LAST WEEK",
      `Projects completed (${completedProjects.length}):`, bl(completedNotes),
      "",
      "PIPELINE",
      `Starting this week — Start Project approved (${startingP.length}):`, bl(cap(startingNotes, 10)),
      `Planned for this week, awaiting Start Project approval (${awaitingStartP.length}) — not counted as starting:`, bl(awaitingStartP.map((p) => `${projLabel(p)} — planned ${md(p.start_date)}`)),
      ...(pausedStartingP.length ? [`Planned to start this week but PAUSED (not counted above): ${pausedStartingP.map((p) => p.name).join(", ")}.`] : []),
      `New intake last week (${intakeP.length}):`, bl(cap(intakeNotes, 10)),
      `Paused last week (${pausedWeekP.length}):`, bl(pausedNotes(pausedWeekP)),
      `All paused projects (${pausedNowP.length}):`, bl(pausedNotes(pausedNowP)),
    ].join("\n"),
    portfolio: [
      `Total year to date = projects completed ${md(ytdStart)} – ${md(ytdEnd)} + projects open today (Cancelled excluded).`,
      `Total ${yCompleted + yActive + yOpActive + yOther} = ${yCompleted} completed + ${yActive} active projects + ${yOpActive} Training Delivery + ${yOther} not started or paused.`,
      `Active projects (${yActive}) = In Progress project work as of ${md(todayIso)} — the same ${yActive} on the Health donut:`, bl(activeP.map((p) => `${p.name} (owner ${who(p.owner_id)})`)),
      `${opLabel} (${yOpActive}) = ongoing projects kept open while work comes in (Training Delivery sessions${opLabel === "Ongoing" ? " and ongoing containers such as revision buckets" : ""}); health is always "Ongoing":`, bl(opActive.map((p) => p.name)),
      `Portfolio movement by month (started = Start Project approved and start date in the month; completed = completion date in the month):`,
      bl(ytdMovement.map((m) => `${m.label}: ${m.started} started, ${m.completed} completed`)),
      `Paused now (${pausedNowP.length}):`, bl(pausedNowP.map((p) => `${p.name} — ${pauseWhy(p)}`)),
    ].join("\n"),
    health: [
      `Health of ${activeP.length} of the ${activeAll.length} In Progress projects as of ${md(todayIso)}. The other ${activeAll.length - activeP.length} are ongoing ${opLabel === "Ongoing" ? "" : "Training Delivery "}projects${opActive.length ? ` (${opActive.map((p) => p.name).join(", ")})` : ""} — counted as Active on the Portfolio slide, but left out here because their health is always "Ongoing".`,
      `Overdue (${overdueP.length}) — past End Date, not complete:`, bl(overdueNotes),
      `Off track:`, bl(healthList("Off track")),
      `At risk:`, bl(healthList("At risk")),
      `Close pending (100% done, still In Progress — owner should mark Completed):`, bl(closePendingNotes),
      `Due this week:`, bl(dueThisWeek.map((x) => `${x.name} — ${md(x.date)}`)),
    ].join("\n"),
    drivers: [
      "Why overdue projects slipped, from Tempo history (tasks added after Start Project, date changes, extension requests, project notes):",
      bl(driverRows.map((r) => `${r.name} (${r.daysLate} days late) — ${r.what} Signal: ${r.signal}.`)),
    ].join("\n"),
    mix: [
      `Effort allocation = Estimated Hours (task estimates) spread over each task's working days, counting only days from ${md(ytdStart)} to ${md(ytdEnd)}. ${h1(mixTotal)} across ${ytdByProject.size} projects. Same method as the Executive Dashboard's Work Mix & Effort Allocation.`,
      `By Project Type (and Planning Type split):`,
      bl(mixBars.map((b) => `${b.label}: ${h1(b.total)} (${mixTotal ? Math.round((b.total / mixTotal) * 100) : 0}%) — ${planTypes.map((pt) => `${pt.label} ${h1(b.parts[pt.label] ?? 0)}`).join(", ")}`)),
      `By Planning Type:`, bl(planTypes.map((pt) => `${pt.label}: ${h1(pt.value)} (${mixTotal ? Math.round((pt.value / mixTotal) * 100) : 0}%)`)),
      `Active projects Health and Phase: ${activeP.length} In Progress projects, current state as of ${md(todayIso)}; ${activeAll.length - activeP.length} Training Delivery projects left out (health always "Ongoing").`,
      bl(Array.from(pc.entries()).map(([k, v]) => `Phase ${k}: ${v}`)),
    ].join("\n"),
    pipeline: [
      `Completed last week (${completedProjects.length}):`, bl(completedNotes),
      `New intake last week (${intakeP.length}):`, bl(intakeNotes),
      `Starting this week — Start Project approved (${startingP.length}):`, bl(startingNotes),
      `Awaiting Start Project approval, planned for this week (${awaitingStartP.length}):`, bl(awaitingStartP.map((p) => `${projLabel(p)} — planned ${md(p.start_date)}`)),
      ...(pausedStartingP.length ? [`Planned to start this week but PAUSED (shown under Paused): ${pausedStartingP.map((p) => p.name).join(", ")}.`] : []),
      `Paused (${pausedNowP.length}):`, bl(pausedNotes(pausedNowP)),
    ].join("\n"),
    util: [
      "Last week = actual (finalized logged ÷ expected hours). This and next week = planned (task estimates spread over working days ÷ capacity, leave and holidays removed).",
      `Last week: ${h1(logged)} logged of ${h1(expected)} expected.`,
      `People with 2h+ not logged last week:`, bl(cap(gaps, 10), "Everyone logged within 2h of expected."),
      `Non-project time last week (${h1(nonProject)}) by activity:`, bl(npNotes),
      `Tasks completed last week that ran 25%+ over estimate:`, bl(cap(overEst, 6)),
      `Over 100% this week:`, bl(overNotes),
      `Under 50% next week (room to take work):`, bl(roomNotes),
      ...roles.map((r) => `- ${r.label}: last week ${Math.round(r.last * 100)}%, this week ${Math.round(r.thisW * 100)}%, next week ${Math.round(r.nextW * 100)}%`),
    ].join("\n"),
    training: [
      "Drill-down of Training Delivery projects (already counted in the portfolio). A session = a task with Output Type \"Session\"; hours = finalized time logged on sessions in the report week.",
      `Delivered last week (${tDone.length}):`, bl(cap(tDone.map(sessionLine), 15)),
      `Scheduled this week (${tThis.length}):`, bl(cap(tThis.map(sessionLine), 15)),
      `Past date, not marked Done (${tPast.length}) — trainers to update:`, bl(cap(tPast.map(sessionLine), 15)),
      tCancelled.length ? `Cancelled last week (${tCancelled.length}):\n${bl(tCancelled.map((t) => `${t.name} — ${who(t.assignee_id)}${t.cancellation_reason ? `; reason: ${t.cancellation_reason}` : ""}`))}` : "",
    ].filter(Boolean).join("\n"),
    appendix: `All projects to date (excluding Cancelled) by Project Type, Planned vs Ad Hoc.${overall.untyped ? ` ${overall.untyped} project(s) have no Project Type yet: ${live.filter((p) => typeOf(p) === "No type").map((p) => p.name).slice(0, 8).join(", ")}.` : ""}`,
  };

  return {
    opLabel,
    generatedOn: todayIso, week, thisWeek, nextWeek, training, notes, ytd,
    glance: {
      completedProjects: completedProjects.map((p) => p.name),
      completedDetail: completedProjects.map((p) => ({ name: p.name, date: completionDateOf(p), onTime: p.end_date ? completionDateOf(p) <= d10(p.end_date) : null })),
      tasksDone: doneTasks.length, tasksOnTime,
      logged, expected, nonProject, doneLogged, doneEst, utilPct: expected > 0 ? logged / expected : 0,
      starting: startingP.length, awaitingStart: awaitingStartP.length, intake: intakeP.length, pausedInWeek, pausedNow: pausedNowP.length,
      pausedNoResume: pausedNowP.filter((p) => !p.pause_expected_resume).length,
    },
    portfolio: { total: pfCompleted + pfActive + pfNotStarted + pfPaused, completed: pfCompleted, active: pfActive, operationalActive: activeAll.length - activeP.length, notStarted: pfNotStarted, paused: pfPaused, overdue: overdueP.length, movement },
    health: { activeCount: activeP.length, operationalActive: activeAll.length - activeP.length, buckets, overdue: overdueLines, dueThisWeek, closePending: (counts.get("Done on time · close pending") ?? 0) + (counts.get("Done late · close pending") ?? 0), offTrack: counts.get("Off track") ?? 0 },
    drivers: { rows: driverRows, grewCount: grew, overdueCount: overdueP.length, tasksAdded, hoursAdded, extRequests: extCount, notes: noteCount },
    mix: { rows: mixRows, active: activeAll.length, dev: activeAll.length - trainerActive, trainer: trainerActive },
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
