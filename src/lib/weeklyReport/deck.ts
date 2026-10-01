// Weekly Report deck builder (phase128).
// 1) pptxgenjs draws every slide (text, tables, native editable charts).
// 2) The slides are transplanted into the REAL Dermorepubliq template
//    (public/report-templates/dermorepubliq-weekly.pptx = Sandra's .potx with
//    only "Title Slide Plain" + "1_Blank" layouts kept, embedded Poppins
//    fonts intact), pointing at those layouts, so logo/footer/pixel motif and
//    fonts come from the template itself.
// 3) Chart XML is patched for things pptxgenjs can't do: "33% (7)" labels on
//    100% stacked bars and per-bar colors (over-capacity bars in Renew red).
import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import type { WeeklyReportData, ProjLine } from "./data";
import { fmtMD } from "./format";

import { BRAND, utilColor, type DeckText, type SlideKey } from "./text";
const B = BRAND;
const F = "Poppins";
const FB = "Poppins SemiBold";
const pct = (x: number) => `${Math.round(x * 100)}%`;
const h0 = (x: number) => `${Math.round(x)}h`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const listNames = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
export type { DeckText, SlideKey };

// ------------------------------------------------------------------ deck
interface ChartPatch { labels?: (string | null)[][]; labelColors?: string[]; pointColors?: { ser: number; idx: number; color: string }[] }

export async function buildWeeklyDeck(d: WeeklyReportData, t: DeckText, templateUrl: string): Promise<Blob> {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  const patches: (ChartPatch | null)[] = [];
  const kinds: ("cover" | "content")[] = [];
  type Slide = ReturnType<typeof pptx.addSlide>;

  // ---- primitives
  const box = (s: Slide, x: number, y: number, w: number, h: number, fill: string = B.white, line: string | null = B.linen, rounded = true) =>
    s.addShape(rounded ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { x, y, w, h, fill: { color: fill }, line: line ? { color: line, width: 0.75 } : { type: "none" }, rectRadius: rounded ? 0.08 : undefined });
  type Run = { text: string; options?: Record<string, unknown> };
  const txt = (s: Slide, x: number, y: number, w: number, h: number, text: string | Run[], o: Record<string, unknown> = {}) =>
    s.addText(text as never, { x, y, w, h, fontFace: F, fontSize: 12, color: B.onyx, valign: "top", margin: 3, ...o });
  const bullets = (items: string[], size: number, color: string = B.mahogany): Run[] =>
    items.map((b) => ({ text: b, options: { bullet: { indent: Math.round(size * 1.1) }, fontSize: size, color, fontFace: F, breakLine: true, paraSpaceBefore: 4 } }));
  const rich = (parts: [string, boolean, number?, string?][], defSize: number, defColor: string = B.onyx): Run[] =>
    parts.map(([text, bold, size, color], i) => ({ text, options: { fontFace: bold ? FB : F, fontSize: size ?? defSize, color: color ?? defColor, breakLine: i === parts.length - 1 ? false : undefined } }));
  type Cell = string | { text: string; color?: string };
  const table = (s: Slide, x: number, y: number, colW: number[], rows: Cell[][], size = 10, rowH = 0.3) => {
    const body = rows.map((r, ri) =>
      r.map((c) => {
        const text = typeof c === "string" ? c : c.text;
        const color = typeof c === "string" ? undefined : c.color;
        return { text, options: { fontFace: ri === 0 ? FB : F, fontSize: ri === 0 ? size - 0.5 : size, color: ri === 0 ? B.mahogany : color ?? B.onyx, fill: { color: ri === 0 ? B.linen : ri % 2 ? B.white : B.clinical }, valign: "middle" as const } };
      })
    );
    s.addTable(body as never, { x, y, colW, rowH, margin: [0.03, 0.08, 0.03, 0.08], border: { type: "none" } as never, autoPage: false });
  };
  const content = (eyebrow: string, title: string) => {
    const s = pptx.addSlide();
    kinds.push("content");
    s.addText(eyebrow.toUpperCase(), { objectName: "ph-eyebrow", x: 0.33, y: 0.3, w: 12.67, h: 0.42, fontFace: F, fontSize: 20, color: B.calm, charSpacing: 3, valign: "top", margin: 0 });
    s.addText(title, { objectName: "ph-title", x: 0.33, y: 0.74, w: 12.67, h: 0.55, fontFace: FB, fontSize: 26, color: B.onyx, valign: "top", margin: 0, fit: "shrink" });
    return s;
  };
  const card = (s: Slide, x: number, y: number, w: number, h: number, title: string, sub?: string, titleColor: string = B.onyx) => {
    box(s, x, y, w, h);
    txt(s, x + 0.2, y + 0.12, w - 0.4, 0.35, title, { fontFace: FB, fontSize: 14, color: titleColor });
    if (sub) txt(s, x + 0.2, y + 0.47, w - 0.4, 0.3, sub, { fontSize: 9.5, color: B.taupe });
  };
  const cut = (n: string, max = 40) => (n.length > max ? `${n.slice(0, max - 1)}…` : n);
  const chartBase = { fontFace: F, catAxisLabelFontFace: F, valAxisLabelFontFace: F, legendFontFace: F, dataLabelFontFace: FB, catAxisLabelColor: B.mahogany, valAxisLabelColor: B.taupe, legendColor: B.mahogany } as Record<string, unknown>;
  const addChart = (s: Slide, type: unknown, data: unknown, opts: Record<string, unknown>, patch: ChartPatch | null = null) => {
    s.addChart(type as never, data as never, { ...chartBase, ...opts } as never);
    patches.push(patch);
  };

  // ================================================================ 1 COVER
  {
    const s = pptx.addSlide();
    kinds.push("cover");
    s.addText(t.coverTitle, { objectName: "ph-ctrTitle", x: 0.88, y: 2.57, w: 10.0, h: 1.97, fontFace: FB, fontSize: 54, color: B.onyx, valign: "bottom", margin: 0 });
    s.addText(t.coverSubtitle, { objectName: "ph-subTitle", x: 0.88, y: 4.55, w: 10.0, h: 0.8, fontFace: F, fontSize: 20, color: B.mahogany, valign: "top", margin: 0 });
  }

  // ================================================================ 2 WEEK AT A GLANCE
  {
    const s = content("Week at a glance", t.titles.glance);
    t.cards.slice(0, 3).forEach((c, i) => {
      const x = 0.33 + i * 4.25;
      box(s, x, 1.55, 4.05, 3.35);
      box(s, x, 1.55, 0.09, 3.35, c.color, null, false);
      txt(s, x + 0.3, 1.75, 3.6, 0.35, c.tag, { fontFace: FB, fontSize: 11, color: c.color });
      txt(s, x + 0.3, 2.1, 3.6, 0.5, c.head, { fontFace: FB, fontSize: 20, fit: "shrink" });
      txt(s, x + 0.3, 2.75, 3.6, 2.05, bullets(c.bullets.filter(Boolean), 12));
    });
    box(s, 0.33, 5.1, 12.67, 1.45, B.panel, null);
    txt(s, 0.6, 5.22, 4, 0.35, "ASKS FOR BRAD", { fontFace: FB, fontSize: 11, color: B.mahogany });
    const runs: Run[] = [];
    t.asks.filter(Boolean).slice(0, 3).forEach((a, i, arr) => {
      const k = a.indexOf(":");
      const label = k > 0 && k < 40 ? a.slice(0, k + 1) + " " : "";
      const rest = label ? a.slice(k + 1).trim() : a;
      runs.push({ text: `${i + 1}.  ${label}`, options: { fontFace: FB, fontSize: 13, color: B.onyx } });
      runs.push({ text: rest, options: { fontFace: F, fontSize: 13, color: B.onyx, breakLine: i < arr.length - 1 } });
    });
    txt(s, 0.6, 5.58, 12.1, 0.95, runs);
  }

  // ================================================================ 3 PORTFOLIO OVERVIEW
  {
    const p = d.portfolio;
    const s = content("Portfolio overview", t.titles.portfolio);
    const share = (n: number) => (p.total ? `${pct(n / p.total)} of total` : "");
    const kpis: [string, number, string, string][] = [
      ["Total projects", p.total, "Completed + open, last week", B.mahogany], ["Completed", p.completed, `Closed ${fmtMD(d.week.start)} – ${fmtMD(d.week.end)}`, B.calm],
      ["Active", p.active, share(p.active), B.hydrate], ["Not started", p.notStarted, share(p.notStarted), B.taupe],
      ["Paused", p.paused, share(p.paused), B.clarify], ["Overdue", p.overdue, `Active, as of ${fmtMD(d.generatedOn)}`, B.renew],
    ];
    kpis.forEach(([lab, val, sub, col], i) => {
      const x = 0.33 + (i % 3) * 2.1, y = 1.55 + Math.floor(i / 3) * 2.62;
      box(s, x, y, 1.95, 2.45);
      box(s, x + 0.25, y + 0.28, 0.5, 0.07, col, null, false);
      txt(s, x + 0.2, y + 0.45, 1.6, 0.35, lab, { fontSize: 11, color: B.mahogany });
      txt(s, x + 0.2, y + 0.8, 1.6, 0.8, String(val), { fontFace: FB, fontSize: 36 });
      txt(s, x + 0.2, y + 1.7, 1.6, 0.6, sub, { fontSize: 9.5, color: B.taupe });
    });
    card(s, 6.75, 1.55, 6.25, 5.07, "Portfolio movement", "Projects started vs. completed per week (last 8 weeks)");
    const labels = p.movement.map((m) => m.label);
    const maxV = Math.max(4, ...p.movement.map((m) => Math.max(m.started, m.completed)));
    addChart(s, pptx.ChartType.line, [
      { name: "Started", labels, values: p.movement.map((m) => m.started) },
      { name: "Completed", labels, values: p.movement.map((m) => m.completed) },
    ], { x: 6.95, y: 2.4, w: 5.9, h: 4.1, chartColors: [B.hydrate, B.calm], lineSize: 2, lineDataSymbol: "circle", lineDataSymbolSize: 7,
      showValue: true, dataLabelPosition: "t", dataLabelFontSize: 9, dataLabelColor: B.mahogany, valAxisMaxVal: maxV + 2, valAxisMinVal: 0,
      valGridLine: { color: B.grid, size: 0.5 }, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, showLegend: true, legendPos: "b", legendFontSize: 9.5 });
  }

  // ================================================================ 4 ACTIVE PROJECT HEALTH
  {
    const h = d.health;
    const s = content("Active project health", t.titles.health);
    card(s, 0.33, 1.55, 5.3, 5.07, `Health of ${h.activeCount} active projects`, `Current state as of ${fmtMD(d.generatedOn)}`);
    const HC: Record<string, string> = { "On track": B.calm, "Done on time · close pending": B.hydrate, "Done late · close pending": B.clarify, "At risk": B.protect, "Off track": B.brighten, Overdue: B.renew, "Not started": B.taupe, "Schedule review": B.rewind, "Health unavailable": B.linen };
    const bk = h.buckets.length ? h.buckets : [{ label: "None", count: 1 }];
    addChart(s, pptx.ChartType.doughnut, [{ name: "Projects", labels: bk.map((b) => b.label), values: bk.map((b) => b.count) }],
      { x: 0.45, y: 2.4, w: 2.6, h: 2.6, holeSize: 62, showLegend: false, showValue: false, showPercent: false, showTitle: false, chartColors: bk.map((b) => HC[b.label] ?? B.linen), dataBorder: { pt: 1, color: B.white } });
    txt(s, 1.15, 3.3, 1.2, 0.75, [{ text: String(h.activeCount), options: { fontFace: FB, fontSize: 26, breakLine: true } }, { text: "active", options: { fontSize: 11, color: B.mahogany } }], { align: "center" });
    h.buckets.slice(0, 9).forEach((b, i) => {
      const y = 2.45 + i * 0.36;
      box(s, 3.15, y + 0.08, 0.16, 0.16, HC[b.label] ?? B.linen, null, false);
      txt(s, 3.35, y, 1.75, 0.34, b.label, { fontSize: 9, color: B.mahogany });
      txt(s, 4.95, y, 0.6, 0.34, `${b.count} · ${pct(b.count / Math.max(1, h.activeCount))}`, { fontFace: FB, fontSize: 9, align: "right" });
    });
    if (h.closePending) txt(s, 0.53, 5.65, 4.9, 0.8, rich([["Close pending: ", true], [`${plural(h.closePending, "project")} ${h.closePending === 1 ? "is" : "are"} 100% done but still In Progress — ready to mark Completed.`, false]], 10, B.mahogany));
    card(s, 5.85, 1.55, 7.15, 5.07, "Overdue projects", "Past their End Date and not complete", B.renew);
    const ov = h.overdue.slice(0, 6);
    if (ov.length) {
      const rows: Cell[][] = [["Project", "Type", "Planning", "End date", "Days late"], ...ov.map((o) => [cut(o.name, 38), o.type, o.planning, fmtMD(o.date), { text: o.daysLate ? String(o.daysLate) : "Due today", color: B.renew }])];
      table(s, 6.05, 2.4, [3.0, 0.9, 0.95, 0.85, 0.95], rows, 10, 0.34);
      if (h.overdue.length > 6) txt(s, 6.05, 2.4 + 0.34 * 7 + 0.02, 6.6, 0.28, `+${h.overdue.length - 6} more in Tempo`, { fontSize: 9, color: B.taupe });
    } else txt(s, 6.05, 2.5, 6.6, 0.4, "No active project is past its End Date.", { fontSize: 11, color: B.mahogany });
    const dy = 4.85;
    txt(s, 6.05, dy, 6.7, 0.35, `Due this week (${fmtMD(d.thisWeek.start)} – ${fmtMD(d.thisWeek.end)})`, { fontFace: FB, fontSize: 12 });
    const due = h.dueThisWeek.slice(0, 4).map((x) => `${cut(x.name, 44)} — ${fmtMD(x.date)}  ·  ${x.type}`);
    if (h.dueThisWeek.length > 4) due.push(`+${h.dueThisWeek.length - 4} more`);
    txt(s, 6.05, dy + 0.35, 6.7, 1.35, due.length ? bullets(due, 10) : "Nothing due this week.", { fontSize: 10, color: B.mahogany });
  }

  // ================================================================ 4b DELIVERY DRIVERS
  if (t.include.drivers && d.drivers.rows.length) {
    const dr = d.drivers;
    const s = content("Delivery drivers", t.titles.drivers);
    const n = Math.min(5, dr.overdueCount);
    const pats: [string, string, string][] = [
      [`${dr.grewCount} of ${n}`, "had tasks added after Start Project", B.renew],
      [plural(dr.tasksAdded, "task"), `added post-baseline across the ${n} (${h0(dr.hoursAdded)})`, B.clarify],
      [String(dr.extRequests), dr.extRequests ? "extension requests filed with a reason" : "extension requests filed — dates were moved directly", B.protect],
      [String(dr.notes), "project notes logged explaining changes", B.taupe],
    ];
    pats.forEach(([big, lab, col], i) => {
      const x = 0.33 + i * 3.19;
      box(s, x, 1.5, 3.04, 1.05);
      box(s, x, 1.5, 0.08, 1.05, col, null, false);
      txt(s, x + 0.25, 1.58, 2.7, 0.5, big, { fontFace: FB, fontSize: 22 });
      txt(s, x + 0.25, 2.08, 2.75, 0.45, lab, { fontSize: 9.5, color: B.mahogany });
    });
    const rows: Cell[][] = [["Project", "Type", "Days late", "What changed (from Tempo history)", "Signal"],
      ...dr.rows.map((r) => [cut(r.name, 36), r.type, { text: r.daysLate ? String(r.daysLate) : "Due today", color: B.renew }, cut(r.what, 175), r.signal])];
    table(s, 0.33, 2.8, [2.75, 0.85, 0.95, 6.62, 1.5], rows, 10, 0.52);
    box(s, 0.33, 6.08, 12.67, 0.62, B.panel, null);
    txt(s, 0.55, 6.15, 12.3, 0.5, rich([["Recommendation: ", true], ["require an extension request (with reason) whenever an End Date passes or tasks are added after Start Project, so the “why” comes from the team, not inferred from edits.", false]], 11));
  }

  // ================================================================ 5 PORTFOLIO MIX (one chart)
  {
    const m = d.mix;
    const s = content("Portfolio mix", t.titles.mix);
    card(s, 0.33, 1.55, 8.6, 5.07, "Active projects by Project Type, split by owner group and Planning Type",
      `${m.active} active projects · % within each row (count) · Development = owned by anyone who is not a Trainer`);
    const segs: [string, keyof (typeof m.rows)[0], string, string][] = [
      ["Development · Planned", "devPlanned", B.hydrate, B.white], ["Development · Ad Hoc", "devAdHoc", B.hydrateLight, B.onyx],
      ["Trainer · Planned", "trPlanned", B.clarify, B.onyx], ["Trainer · Ad Hoc", "trAdHoc", B.clarifyLight, B.onyx],
    ];
    const labels = m.rows.map((r) => r.label);
    const lab = segs.map(([, k]) => m.rows.map((r) => {
      const n = r[k] as number;
      const tot = r.devPlanned + r.devAdHoc + r.trPlanned + r.trAdHoc;
      return n && tot ? `${Math.round((n / tot) * 100)}% (${n})` : null;
    }));
    addChart(s, pptx.ChartType.bar, segs.map(([name, k]) => ({ name, labels, values: m.rows.map((r) => r[k] as number) })),
      { x: 0.45, y: 2.4, w: 8.35, h: 4.1, barDir: "bar", barGrouping: "percentStacked", barGapWidthPct: 45, chartColors: segs.map((x) => x[2]),
        catAxisOrientation: "maxMin", valAxisHidden: true, valGridLine: { style: "none" }, catAxisLineShow: false, catAxisLabelFontFace: FB, catAxisLabelFontSize: 11,
        showValue: true, dataLabelFontSize: 10, dataLabelColor: B.onyx, showLegend: true, legendPos: "b", legendFontSize: 10 },
      { labels: lab, labelColors: segs.map((x) => x[3]) });
    box(s, 9.15, 1.55, 3.85, 5.07, B.panel, null);
    txt(s, 9.4, 1.75, 3.4, 0.35, "Read-out", { fontFace: FB, fontSize: 14 });
    const all = m.rows[0];
    const ro: string[] = [];
    if (m.active) ro.push(`Development owns ${m.dev} of ${m.active} active projects (${pct(m.dev / m.active)}); Trainers own ${m.trainer} (${pct(m.trainer / m.active)}).`);
    m.rows.slice(1).forEach((r) => {
      const tot = r.devPlanned + r.devAdHoc + r.trPlanned + r.trAdHoc;
      const tr = r.trPlanned + r.trAdHoc;
      const name = r.label.replace(/ \(\d+\)$/, "");
      if (tot && tr) ro.push(`Trainers lead ${tr} of ${tot} ${name} projects (${pct(tr / tot)}).`);
      else if (tot) ro.push(`${name} work is 100% development-led${r.devAdHoc ? `; ${r.devAdHoc} of ${tot} is Ad Hoc` : ""}.`);
    });
    if (all) { const ah = all.devAdHoc + all.trAdHoc; ro.push(`Ad Hoc is ${ah} of ${m.active} (${pct(ah / Math.max(1, m.active))}) of active work.`); }
    txt(s, 9.4, 2.2, 3.4, 4.3, bullets(ro.slice(0, 5), 11));
  }

  // ================================================================ 6 PROJECT PIPELINE
  {
    const pl = d.pipeline;
    const s = content("Project pipeline", t.titles.pipeline);
    const quad = (x: number, y: number, col: string, head: string, items: ProjLine[], cols: string[], colW: number[], row: (p: ProjLine) => Cell[]) => {
      box(s, x, y, 6.25, 2.5);
      box(s, x, y, 6.25, 0.07, col, null, false);
      txt(s, x + 0.2, y + 0.14, 4.5, 0.36, rich([[head + "  ", true, 13], [String(items.length), true, 13, col]], 13));
      if (items.length > 5) txt(s, x + 3.6, y + 0.17, 2.45, 0.3, `Showing 5 of ${items.length}`, { fontSize: 9, color: B.taupe, align: "right" });
      if (items.length) table(s, x + 0.2, y + 0.55, colW, [cols, ...items.slice(0, 5).map(row)], 9.5, 0.29);
      else txt(s, x + 0.2, y + 0.6, 5.8, 0.3, "None.", { fontSize: 10, color: B.taupe });
    };
    quad(0.33, 1.5, B.calm, "Completed last week", pl.completed, ["Project", "Type", "Planning", "Completed"], [3.05, 0.9, 0.95, 0.95], (p) => [cut(p.name, 38), p.type, p.planning, fmtMD(p.date)]);
    quad(6.75, 1.5, B.hydrate, "New intake last week", pl.intake, ["Project", "Type", "Planning", "Status"], [2.95, 0.8, 0.9, 1.2], (p) => [cut(p.name, 36), p.type, p.planning, p.extra ?? ""]);
    quad(0.33, 4.18, B.rewind, "Starting this week", pl.starting, ["Project", "Type", "Planning", "Start"], [3.05, 0.9, 0.95, 0.95], (p) => [cut(p.name, 38), p.type, p.planning, fmtMD(p.date)]);
    quad(6.75, 4.18, B.clarify, "Paused", pl.paused, ["Project", "Type", "Days paused", "Expected resume"], [2.6, 0.85, 1.05, 1.35], (p) => [cut(p.name, 32), p.type, p.extra ?? "", { text: p.date, color: p.warn ? B.renew : B.onyx }]);
  }

  // ================================================================ 7 TEAM UTILIZATION (by role)
  {
    const u = d.util;
    const s = content("Team utilization", t.titles.util);
    card(s, 0.33, 1.55, 8.2, 5.07, "Utilization by role · last week, this week, next week",
      "Last week = actual (logged ÷ expected) · This & next week = planned (task estimates ÷ capacity) · red = over 100%");
    const labels = u.roles.map((r) => r.label);
    const maxV = Math.max(1.2, ...u.roles.flatMap((r) => [r.last, r.thisW, r.nextW])) * 1.12;
    const pc: ChartPatch["pointColors"] = [];
    u.roles.forEach((r, i) => { if (r.thisW > 1.005) pc.push({ ser: 1, idx: i, color: B.renew }); if (r.nextW > 1.005) pc.push({ ser: 2, idx: i, color: B.renew }); });
    addChart(s, pptx.ChartType.bar, [
      { name: "Last week · actual", labels, values: u.roles.map((r) => r.last) },
      { name: "This week · planned", labels, values: u.roles.map((r) => r.thisW) },
      { name: "Next week · planned", labels, values: u.roles.map((r) => r.nextW) },
    ], { x: 0.45, y: 2.4, w: 7.95, h: 4.1, barDir: "col", barGrouping: "clustered", barGapWidthPct: 70, chartColors: [B.calm, B.hydrate, B.nextWeek],
      showValue: true, dataLabelFormatCode: "0%", dataLabelPosition: "outEnd", dataLabelFontSize: 8, dataLabelColor: B.mahogany,
      valAxisLabelFormatCode: "0%", valAxisMaxVal: Math.ceil(maxV * 4) / 4, valAxisMinVal: 0, valAxisMajorUnit: 0.5, valGridLine: { color: B.grid, size: 0.5 },
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, showLegend: true, legendPos: "b", legendFontSize: 9.5 }, { pointColors: pc });
    card(s, 8.75, 1.55, 4.25, 5.07, "By role");
    const cell = (v: number): Cell => ({ text: pct(v), color: utilColor(v) });
    table(s, 9.0, 2.1, [1.65, 0.7, 0.7, 0.7], [["Role", "Last wk", "This wk", "Next wk"], ...u.roles.map((r) => [r.label, cell(r.last), cell(r.thisW), cell(r.nextW)])], 9.5, 0.33);
    const ty = 2.1 + 0.33 * (u.roles.length + 1) + 0.15;
    const lines: Run[] = [];
    const over = u.roles.slice(1).filter((r) => r.thisW > 1.005).map((r) => `${r.label.replace(/ \(\d+\)$/, "")} at ${pct(r.thisW)}`);
    if (over.length) {
      lines.push({ text: "This week: ", options: { fontFace: FB, fontSize: 10, color: B.renew } });
      lines.push({ text: `${over.join(", ")}${u.overloaded.length ? ` (${u.overloaded.slice(0, 3).map((p) => `${p.name} ${pct(p.pct)}`).join(", ")})` : ""}.`, options: { fontSize: 10, color: B.mahogany, breakLine: true } });
    }
    const roomRoles = u.roles.slice(1).filter((r) => r.thisW < 0.7).map((r) => `${r.label.replace(/ \(\d+\)$/, "")} at ${pct(r.thisW)}`);
    if (roomRoles.length || u.room.length) {
      lines.push({ text: "Room: ", options: { fontFace: FB, fontSize: 10, color: B.calm } });
      lines.push({ text: `${roomRoles.join(", ")}${roomRoles.length && u.room.length ? "; " : ""}${u.room.length ? `${listNames(u.room.slice(0, 3).map((p) => p.name))} under 50% next week` : ""}.`, options: { fontSize: 10, color: B.mahogany, breakLine: true } });
    }
    const singles = u.roles.slice(1).filter((r) => r.people === 1).map((r) => r.label.replace(/ \(\d+\)$/, ""));
    if (singles.length) {
      lines.push({ text: "Note: ", options: { fontFace: FB, fontSize: 8.5, color: B.taupe } });
      lines.push({ text: `${listNames(singles)} ${singles.length === 1 ? "is" : "are"} one person each, so those bars are individual figures.`, options: { fontSize: 8.5, color: B.taupe } });
    }
    if (lines.length) txt(s, 9.0, ty, 3.75, Math.max(0.6, 6.5 - ty), lines, { paraSpaceBefore: 3 });
  }

  // ================================================================ 8 APPENDIX
  if (t.include.appendix) {
    const o = d.overall;
    const s = content("Appendix", t.titles.appendix);
    box(s, 0.33, 1.55, 8.0, 5.07);
    const labels = o.rows.map((r) => r.label);
    const lab = [o.rows.map((r) => (r.planned ? `${Math.round((r.planned / (r.planned + r.adHoc)) * 100)}% (${r.planned})` : null)), o.rows.map((r) => (r.adHoc ? `${Math.round((r.adHoc / (r.planned + r.adHoc)) * 100)}% (${r.adHoc})` : null))];
    addChart(s, pptx.ChartType.bar, [{ name: "Planned", labels, values: o.rows.map((r) => r.planned) }, { name: "Ad Hoc", labels, values: o.rows.map((r) => r.adHoc) }],
      { x: 0.5, y: 1.9, w: 7.7, h: 3.9, barDir: "bar", barGrouping: "percentStacked", barGapWidthPct: 55, chartColors: [B.hydrate, B.protect], catAxisOrientation: "maxMin",
        valAxisHidden: true, valGridLine: { style: "none" }, catAxisLineShow: false, catAxisLabelFontFace: FB, catAxisLabelFontSize: 11, showValue: true, dataLabelFontSize: 11,
        showLegend: true, legendPos: "b", legendFontSize: 10 }, { labels: lab, labelColors: [B.white, B.onyx] });
    txt(s, 0.58, 5.95, 7.5, 0.5, `${o.total} projects (excl. Cancelled).${o.untyped ? ` ${plural(o.untyped, "project")} ${o.untyped === 1 ? "has" : "have"} no Project Type set yet.` : ""}`, { fontSize: 9.5, color: B.taupe });
    box(s, 8.55, 1.55, 4.45, 5.07, B.panel, null);
    txt(s, 8.8, 1.75, 4.0, 0.35, "Read-out", { fontFace: FB, fontSize: 14 });
    const ro = o.rows.map((r) => `${r.label}: ${r.planned + r.adHoc} projects (${pct((r.planned + r.adHoc) / Math.max(1, o.total))}); ${r.adHoc} Ad Hoc (${pct(r.adHoc / Math.max(1, r.planned + r.adHoc))}).`);
    txt(s, 8.8, 2.2, 4.0, 4.2, bullets(ro.slice(0, 5), 11));
  }

  const gen = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  const tpl = await fetch(templateUrl).then((r) => {
    if (!r.ok) throw new Error(`Template not found (${r.status})`);
    return r.arrayBuffer();
  });
  return transplant(gen, tpl, kinds, patches);
}

// ------------------------------------------------------------------ chart XML patches
function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export function patchChartXml(xml: string, p: ChartPatch): string {
  let ser = -1;
  // Each <c:ser> has exactly one <c:dLbls> (pptxgenjs writes it when showValue is on);
  // dPt must sit right before dLbls, custom dLbl entries go first inside it.
  return xml.replace(/<c:ser>|<c:dLbls>/g, (m) => {
    if (m === "<c:ser>") { ser++; return m; }
    if (ser < 0) return m;
    let pre = "";
    for (const pc of p.pointColors ?? []) if (pc.ser === ser) pre += `<c:dPt><c:idx val="${pc.idx}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${pc.color}"/></a:solidFill></c:spPr></c:dPt>`;
    let inner = "";
    const labels = p.labels?.[ser];
    if (labels) {
      const col = p.labelColors?.[ser] ?? "121212";
      labels.forEach((l, i) => {
        inner += l == null
          ? `<c:dLbl><c:idx val="${i}"/><c:delete val="1"/></c:dLbl>`
          : `<c:dLbl><c:idx val="${i}"/><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US" sz="1000" b="0"><a:solidFill><a:srgbClr val="${col}"/></a:solidFill><a:latin typeface="${FB}"/></a:rPr><a:t>${esc(l)}</a:t></a:r></a:p></c:rich></c:tx><c:dLblPos val="ctr"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl>`;
      });
    }
    return `${pre}<c:dLbls>${inner}`;
  });
}

// ------------------------------------------------------------------ transplant into template
function phFor(name: string): string | null {
  switch (name) {
    case "ph-title": return '<p:ph type="title"/>';
    case "ph-eyebrow": return '<p:ph type="body" sz="quarter" idx="10"/>';
    case "ph-ctrTitle": return '<p:ph type="ctrTitle"/>';
    case "ph-subTitle": return '<p:ph type="subTitle" idx="1"/>';
    default: return null;
  }
}
export function placeholderize(xml: string): string {
  return xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (sp) => {
    const m = sp.match(/<p:cNvPr id="\d+" name="([^"]+)"/);
    const ph = m && phFor(m[1]);
    if (!ph) return sp;
    let out = sp.replace(/<p:cNvSpPr txBox="1"\s*\/>/, "<p:cNvSpPr><a:spLocks noGrp=\"1\"/></p:cNvSpPr>").replace(/<p:nvPr\s*\/>|<p:nvPr><\/p:nvPr>/, `<p:nvPr>${ph}</p:nvPr>`);
    // no inherited bullets / indents on the placeholder paragraphs
    out = out.replace(/<a:pPr([^>]*?)\/>/g, '<a:pPr$1 marL="0" indent="0"><a:buNone/></a:pPr>').replace(/<a:pPr([^>]*?[^/])>(?!<a:buNone)/g, '<a:pPr$1><a:buNone/>');
    out = out.replace(/(<a:pPr[^>]*?) marL="0" indent="0"([^>]*?) marL="[^"]*"/g, "$1$2").replace(/(<a:pPr[^>]*?) indent="0"([^>]*?) indent="[^"]*"/g, "$1$2");
    return out;
  });
}

async function transplant(genBuf: ArrayBuffer, tplBuf: ArrayBuffer, kinds: ("cover" | "content")[], patches: (ChartPatch | null)[]): Promise<Blob> {
  const gen = await JSZip.loadAsync(genBuf);
  const tpl = await JSZip.loadAsync(tplBuf);
  const ct = await tpl.file("[Content_Types].xml")!.async("string");
  let presXml = await tpl.file("ppt/presentation.xml")!.async("string");
  let presRels = await tpl.file("ppt/_rels/presentation.xml.rels")!.async("string");
  // template layouts: find the file names for the two layouts we use
  const layoutFiles = Object.keys(tpl.files).filter((f) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(f));
  let coverLayout = "", contentLayout = "";
  for (const f of layoutFiles) {
    const x = await tpl.file(f)!.async("string");
    if (/<p:cSld name="Title Slide Plain"/.test(x)) coverLayout = f.split("/").pop()!;
    if (/<p:cSld name="1_Blank"/.test(x)) contentLayout = f.split("/").pop()!;
  }
  if (!coverLayout || !contentLayout) throw new Error("Template layouts not found");

  const overrides: string[] = [];
  const sldIds: string[] = [];
  const slideFiles = Object.keys(gen.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => +a.match(/(\d+)\.xml$/)![1] - +b.match(/(\d+)\.xml$/)![1]);
  let rid = 1000;
  for (let i = 0; i < slideFiles.length; i++) {
    const f = slideFiles[i];
    const n = f.match(/(\d+)\.xml$/)![1];
    let xml = await gen.file(f)!.async("string");
    xml = placeholderize(xml);
    tpl.file(`ppt/slides/slide${n}.xml`, xml);
    let rels = await gen.file(`ppt/slides/_rels/slide${n}.xml.rels`)!.async("string");
    rels = rels
      .replace(/<Relationship[^>]*notesSlide[^>]*\/>/g, "")
      .replace(/Target="\.\.\/slideLayouts\/slideLayout\d+\.xml"/, `Target="../slideLayouts/${kinds[i] === "cover" ? coverLayout : contentLayout}"`);
    tpl.file(`ppt/slides/_rels/slide${n}.xml.rels`, rels);
    overrides.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    const r = `rId${rid++}`;
    presRels = presRels.replace("</Relationships>", `<Relationship Id="${r}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/></Relationships>`);
    sldIds.push(`<p:sldId id="${256 + i}" r:id="${r}"/>`);
  }
  // charts + embedded workbooks
  const chartFiles = Object.keys(gen.files).filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)).sort((a, b) => +a.match(/(\d+)\.xml$/)![1] - +b.match(/(\d+)\.xml$/)![1]);
  for (let i = 0; i < chartFiles.length; i++) {
    const f = chartFiles[i];
    let xml = await gen.file(f)!.async("string");
    const p = patches[i];
    if (p) xml = patchChartXml(xml, p);
    tpl.file(f, xml);
    overrides.push(`<Override PartName="/${f}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  }
  for (const f of Object.keys(gen.files)) {
    if (gen.files[f].dir) continue;
    if (/^ppt\/charts\/_rels\//.test(f) || /^ppt\/embeddings\//.test(f)) tpl.file(f, await gen.file(f)!.async("uint8array"));
  }
  let ct2 = ct.replace("</Types>", `${overrides.join("")}</Types>`);
  if (!/Extension="xlsx"/.test(ct2)) ct2 = ct2.replace("<Override", '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/><Override');
  tpl.file("[Content_Types].xml", ct2);
  presXml = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, "");
  presXml = presXml.replace(/<p:sldSz/, `<p:sldIdLst>${sldIds.join("")}</p:sldIdLst><p:sldSz`);
  tpl.file("ppt/presentation.xml", presXml);
  tpl.file("ppt/_rels/presentation.xml.rels", presRels);
  return tpl.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", compression: "DEFLATE" });
}
