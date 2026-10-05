// Weekly Report narrative defaults + brand tokens (phase128). Kept separate
// from deck.ts so the Reports page can draft/edit text without loading
// pptxgenjs (deck.ts is lazy-loaded only when generating).
import type { WeeklyReportData } from "./data";
import { parseLocalDate } from "../workingDays";

// ------------------------------------------------------------------ brand
export const BRAND = {
  white: "FFFFFF", clinical: "F7F6F3", linen: "DBD3C9", taupe: "989187", mahogany: "5F5144", onyx: "121212",
  renew: "C43A52", calm: "83AA6E", repair: "E3A4F3", rewind: "7843A6", hydrate: "6990C7", brighten: "EAADB4", clarify: "D8A891", protect: "F1D53D",
  amberText: "C9A800", panel: "F1EDE7", grid: "E8E3DC", hydrateLight: "A9C0E2", clarifyLight: "EBD3C7", nextWeek: "B7C9E6",
};
const B = BRAND;

export type SlideKey = "glance" | "portfolio" | "health" | "drivers" | "mix" | "pipeline" | "util" | "training" | "appendix";
export interface GlanceCard { tag: string; head: string; bullets: string[]; color: string }
export interface DeckText {
  coverTitle: string;
  coverSubtitle: string;
  titles: Record<SlideKey, string>;
  cards: GlanceCard[];
  asks: string[]; // "Label: text" -- label part rendered bold
  include: { drivers: boolean; training: boolean; appendix: boolean };
}

// ------------------------------------------------------------------ text defaults
const pct = (x: number) => `${Math.round(x * 100)}%`;
const h0 = (x: number) => `${Math.round(x)}h`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const listNames = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
export function utilColor(x: number): string {
  if (x > 1.0) return B.renew;
  if (x > 0.8) return B.amberText;
  if (x >= 0.6) return B.calm;
  return B.clarify;
}
export function weekLabel(start: string, end: string): string {
  const s = parseLocalDate(start), e = parseLocalDate(end);
  const m1 = s.toLocaleDateString("en-US", { month: "long" }), m2 = e.toLocaleDateString("en-US", { month: "long" });
  return m1 === m2 ? `${m1} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}` : `${m1} ${s.getDate()} – ${m2} ${e.getDate()}, ${e.getFullYear()}`;
}

export function defaultDeckText(d: WeeklyReportData, preparedFor = "Brad Veleña"): DeckText {
  const g = d.glance;
  const onTimeRate = g.tasksDone ? g.tasksOnTime / g.tasksDone : 1;
  const unlogged = Math.max(0, g.expected - g.logged);
  const part1 = g.completedProjects.length || g.tasksDone ? (onTimeRate >= 0.9 ? "Strong delivery last week" : "Delivery moved last week") : "No completions last week";
  const part2 = g.expected > 0 && unlogged / g.expected > 0.15 ? "time logging needs attention" : g.utilPct > 1 ? "team ran over capacity" : "capacity on track";
  const deliveryBul: string[] = [];
  if (g.completedProjects.length) deliveryBul.push(`Closed: ${listNames(g.completedProjects.slice(0, 3))}${g.completedProjects.length > 3 ? ` +${g.completedProjects.length - 3} more` : ""}.`);
  else deliveryBul.push("No projects were closed out last week.");
  if (g.tasksDone) deliveryBul.push(`${g.tasksOnTime} of ${g.tasksDone} tasks (${pct(onTimeRate)}) finished on or before their due date.`);
  if (d.training.delivered) deliveryBul.push(`${plural(d.training.delivered, "training session")} delivered (${h0(d.training.loggedHours)} logged).`);
  const utilBul = [`${h0(g.logged)} logged of ${h0(g.expected)} expected${unlogged >= 1 ? ` — ${h0(unlogged)} not logged` : ""}.`];
  if (g.logged > 0) utilBul.push(`${pct(g.nonProject / g.logged)} of logged time (${h0(g.nonProject)}) was non-project work.`);
  if (g.doneEst > 0) {
    const r = g.doneLogged / g.doneEst;
    utilBul.push(`Completed tasks used ${h0(g.doneLogged)} vs ${h0(g.doneEst)} estimated — ${r < 0.85 ? "estimates running high" : r > 1.15 ? "work ran over estimate" : "close to estimate"}.`);
  }
  const pipeBul = [`${plural(g.intake, "new project")} ${g.intake === 1 ? "was" : "were"} added last week.`];
  pipeBul.push(g.pausedInWeek ? `${plural(g.pausedInWeek, "project")} paused last week; ${g.pausedNow} paused in total.` : `No projects paused last week${g.pausedNow ? `; ${g.pausedNow} remain paused${g.pausedNoResume ? `${g.pausedNoResume === g.pausedNow ? "" : ` (${g.pausedNoResume})`} with no resume date` : ""}` : ""}.`);

  const asks: string[] = [];
  // headline role = the most overloaded role with more than one person (a 1-person role is an individual figure)
  const overRoles = d.util.roles.slice(1).filter((r) => r.thisW > 1.005).sort((a, b) => (b.people > 1 ? 1 : 0) - (a.people > 1 ? 1 : 0) || b.thisW - a.thisW);
  const top = overRoles[0];
  if (d.util.roles[0] && d.util.roles[0].thisW > 1) asks.push(`Prioritization: this week is planned at ${pct(d.util.roles[0].thisW)}${top ? ` (${top.name} at ${pct(top.thisW)})` : ""} — confirm which BAU runs can shift.`);
  const noResume = d.pipeline.paused.filter((p) => p.warn).map((p) => p.name);
  if (noResume.length) asks.push(`Paused projects: decide resume vs. cancel for ${listNames(noResume.slice(0, 4))}.`);
  if (!asks.length) asks.push("No decisions needed this week.");

  const h = d.health;
  const mixTrainerShare = d.mix.active ? d.mix.trainer / d.mix.active : 0;
  return {
    coverTitle: "L&D Weekly Report",
    coverSubtitle: `Week of ${weekLabel(d.week.start, d.week.end)}  ·  Prepared for ${preparedFor}`,
    titles: {
      glance: `${part1}; ${part2}`,
      portfolio: `${d.portfolio.total} projects in play; ${d.portfolio.completed} completed last week`,
      health: h.overdue.length ? `${h.overdue.length} of ${h.activeCount} active projects are overdue${h.offTrack ? `; ${h.offTrack} more off track` : ""}` : `No overdue projects among ${h.activeCount} active`,
      drivers: d.drivers.overdueCount && d.drivers.grewCount === Math.min(5, d.drivers.overdueCount) ? "Every overdue project grew after it started" : `${d.drivers.grewCount} of ${Math.min(5, d.drivers.overdueCount)} overdue projects grew after they started`,
      mix: mixTrainerShare >= 0.3 && mixTrainerShare <= 0.37 ? "A third of active work is Trainer-led BAU" : `Trainer-led work is ${pct(mixTrainerShare)} of active projects`,
      pipeline: `${plural(d.glance.intake, "project")} came in last week; ${d.glance.starting} start this week`,
      util: top ? `${top.name} ${top.people > 1 ? "carry" : "carries"} this week’s overload` : `Team planned at ${pct(d.util.roles[0]?.thisW ?? 0)} this week`,
      training: d.training.delivered
        ? `${plural(d.training.delivered, "session")} delivered last week; ${d.training.thisWeek} scheduled this week`
        : d.training.thisWeek
        ? `${plural(d.training.thisWeek, "session")} scheduled this week`
        : "No training sessions logged last week",
      appendix: "Overall portfolio mix — all projects to date",
    },
    cards: [
      { tag: "DELIVERY · LAST WEEK", head: `${plural(g.completedProjects.length, "project")} · ${plural(g.tasksDone, "task")}`, bullets: deliveryBul, color: B.calm },
      { tag: "UTILIZATION · LAST WEEK", head: `${pct(g.utilPct)} of expected hours`, bullets: utilBul, color: utilColor(g.utilPct) },
      { tag: "PIPELINE", head: `${plural(g.starting, "project")} starting`, bullets: pipeBul, color: B.hydrate },
    ],
    asks,
    include: { drivers: d.drivers.rows.length > 0, training: d.training.projects > 0, appendix: true },
  };
}

