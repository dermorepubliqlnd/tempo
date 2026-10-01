// Admin > Reports (phase128, 2026-10-01). Sandra: "a report builder ... to
// generate a deck for me" -- first report = the weekly L&D report for Brad.
// Data comes live from Tempo (lib/weeklyReport/data.ts); every narrative line
// is auto-drafted and editable here before the .pptx is generated on the
// real Dermorepubliq template (lib/weeklyReport/deck.ts).
import { useEffect, useMemo, useState } from "react";
import { Presentation, Download, RotateCcw, Loader2, CalendarRange, ChevronDown, ChevronRight } from "lucide-react";
import { useSession } from "../lib/useSession";
import { loadWeeklyReport, defaultReportMonday, weekOf, type WeeklyReportData } from "../lib/weeklyReport/data";
import { defaultDeckText, weekLabel, type DeckText, type SlideKey } from "../lib/weeklyReport/text";
import { toISO, addDays, parseLocalDate } from "../lib/workingDays";

const SLIDES: { key: SlideKey; eyebrow: string; optional?: "drivers" | "appendix" }[] = [
  { key: "glance", eyebrow: "Week at a glance" },
  { key: "portfolio", eyebrow: "Portfolio overview" },
  { key: "health", eyebrow: "Active project health" },
  { key: "drivers", eyebrow: "Delivery drivers", optional: "drivers" },
  { key: "mix", eyebrow: "Portfolio mix" },
  { key: "pipeline", eyebrow: "Project pipeline" },
  { key: "util", eyebrow: "Team utilization" },
  { key: "appendix", eyebrow: "Appendix", optional: "appendix" },
];

export default function Reports() {
  const { person: me, loading: sessionLoading } = useSession();
  const weeks = useMemo(() => {
    const first = defaultReportMonday();
    return Array.from({ length: 10 }, (_, i) => toISO(addDays(parseLocalDate(first), -7 * i)));
  }, []);
  const [monday, setMonday] = useState(weeks[0]);
  const [preparedFor, setPreparedFor] = useState("Brad Veleña");
  const [data, setData] = useState<WeeklyReportData | null>(null);
  const [text, setText] = useState<DeckText | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ glance: true, titles: false });

  async function load(m: string) {
    setLoading(true);
    setError(null);
    try {
      const d = await loadWeeklyReport(m);
      setData(d);
      setText(defaultDeckText(d, preparedFor));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (me?.access_level === "full") load(monday);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monday, me?.access_level]);

  async function generate() {
    if (!data || !text) return;
    setBusy(true);
    setError(null);
    try {
      const { buildWeeklyDeck } = await import("../lib/weeklyReport/deck");
      const blob = await buildWeeklyDeck(data, text, `${import.meta.env.BASE_URL}report-templates/dermorepubliq-weekly.pptx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `LD_Weekly_Report_${data.week.start}_to_${data.week.end}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
      setError(`Couldn't build the deck: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  if (sessionLoading) return null;
  if (me?.access_level !== "full") {
    return (
      <div>
        <h1>Reports</h1>
        <p className="subtitle">Admin only.</p>
        <div className="card"><p style={{ margin: 0, fontSize: 12.5 }}>Reports are available to Full Access users.</p></div>
      </div>
    );
  }

  const set = (fn: (t: DeckText) => DeckText) => setText((t) => (t ? fn(t) : t));
  const wk = weekOf(monday);
  const g = data?.glance;

  return (
    <div style={{ maxWidth: 1100 }}>
      <style>{CSS}</style>
      <h1>Reports</h1>
      <p className="subtitle">Generate PowerPoint decks from live Tempo data, on the Dermorepubliq template.</p>

      <div className="card rp-head">
        <div className="rp-title"><Presentation size={18} /> <strong>L&amp;D Weekly Report</strong> <span className="rp-muted">· for Brad · 8 slides</span></div>
        <div className="rp-row">
          <label className="rp-field">
            <span><CalendarRange size={13} /> Report week (Mon–Fri)</span>
            <select value={monday} onChange={(e) => setMonday(e.target.value)}>
              {weeks.map((m, i) => { const w = weekOf(m); return <option key={m} value={m}>{weekLabel(w.start, w.end)}{i === 0 ? " (last week)" : ""}</option>; })}
            </select>
          </label>
          <label className="rp-field">
            <span>Prepared for</span>
            <input value={preparedFor} onChange={(e) => { setPreparedFor(e.target.value); set((t) => ({ ...t, coverSubtitle: `Week of ${weekLabel(wk.start, wk.end)}  ·  Prepared for ${e.target.value}` })); }} />
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn-secondary" disabled={!data || loading} onClick={() => data && setText(defaultDeckText(data, preparedFor))} title="Discard edits and re-draft all text from the data"><RotateCcw size={14} /> Reset text</button>
          <button className="btn-primary" disabled={!data || !text || loading || busy} onClick={generate}>
            {busy ? <Loader2 size={14} className="rp-spin" /> : <Download size={14} />} Generate deck (.pptx)
          </button>
        </div>
        {error && <div className="rp-error">{error}</div>}
        <div className="rp-note">Covers {weekLabel(wk.start, wk.end)}. “This week” = {data ? weekLabel(data.thisWeek.start, data.thisWeek.end) : "the following Mon–Fri"}. Health, overdue and paused lists show the current state as of today. Edits below aren’t saved — generate the deck when it reads right.</div>
      </div>

      {loading && <div className="card rp-muted" style={{ marginTop: 12 }}><Loader2 size={14} className="rp-spin" /> Loading Tempo data…</div>}

      {!loading && data && text && g && (
        <>
          <div className="rp-kpis">
            <Kpi label="Completed last week" value={`${g.completedProjects.length} proj · ${g.tasksDone} tasks`} />
            <Kpi label="Tasks on time" value={g.tasksDone ? `${Math.round((g.tasksOnTime / g.tasksDone) * 100)}%` : "—"} />
            <Kpi label="Utilization (actual)" value={`${Math.round(g.utilPct * 100)}%`} />
            <Kpi label="This week planned" value={`${Math.round((data.util.roles[0]?.thisW ?? 0) * 100)}%`} />
            <Kpi label="Overdue projects" value={String(data.health.overdue.length)} />
            <Kpi label="New intake · starting" value={`${g.intake} · ${g.starting}`} />
          </div>

          <Section id="glance" title="Week at a Glance — cards & asks" open={open} setOpen={setOpen}>
            <div className="rp-cards">
              {text.cards.map((c, i) => (
                <div key={i} className="rp-card" style={{ borderLeftColor: `#${c.color}` }}>
                  <div className="rp-tag" style={{ color: `#${c.color}` }}>{c.tag}</div>
                  <input className="rp-input rp-strong" value={c.head} onChange={(e) => set((t) => ({ ...t, cards: t.cards.map((x, j) => (j === i ? { ...x, head: e.target.value } : x)) }))} />
                  <textarea className="rp-input" rows={4} value={c.bullets.join("\n")} onChange={(e) => set((t) => ({ ...t, cards: t.cards.map((x, j) => (j === i ? { ...x, bullets: e.target.value.split("\n") } : x)) }))} />
                  <div className="rp-hint">One bullet per line</div>
                </div>
              ))}
            </div>
            <label className="rp-field" style={{ marginTop: 10 }}>
              <span>Asks for Brad — one per line (“Label: text”, label shows in bold, max 3)</span>
              <textarea className="rp-input" rows={3} value={text.asks.join("\n")} onChange={(e) => set((t) => ({ ...t, asks: e.target.value.split("\n") }))} />
            </label>
          </Section>

          <Section id="titles" title="Slide titles" open={open} setOpen={setOpen}>
            <label className="rp-field"><span>Cover title</span><input className="rp-input" value={text.coverTitle} onChange={(e) => set((t) => ({ ...t, coverTitle: e.target.value }))} /></label>
            <label className="rp-field"><span>Cover subtitle</span><input className="rp-input" value={text.coverSubtitle} onChange={(e) => set((t) => ({ ...t, coverSubtitle: e.target.value }))} /></label>
            {SLIDES.map((s) => (
              <div key={s.key} className="rp-slide-row">
                <div className="rp-eyebrow">{s.eyebrow}</div>
                <input className="rp-input" value={text.titles[s.key]} maxLength={70} onChange={(e) => set((t) => ({ ...t, titles: { ...t.titles, [s.key]: e.target.value } }))} />
                {s.optional ? (
                  <label className="rp-check"><input type="checkbox" checked={text.include[s.optional]} disabled={s.optional === "drivers" && !data.drivers.rows.length}
                    onChange={(e) => set((t) => ({ ...t, include: { ...t.include, [s.optional as "drivers" | "appendix"]: e.target.checked } }))} /> Include</label>
                ) : <span className="rp-check rp-muted">Always</span>}
              </div>
            ))}
            <div className="rp-hint">Keep titles to one line (about 60 characters).</div>
          </Section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="rp-kpi"><div className="rp-kpi-l">{label}</div><div className="rp-kpi-v">{value}</div></div>;
}
function Section({ id, title, open, setOpen, children }: { id: string; title: string; open: Record<string, boolean>; setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void; children: React.ReactNode }) {
  const isOpen = !!open[id];
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <button type="button" className="rp-sec" onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}>
        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {title}
      </button>
      {isOpen && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

const CSS = `
.rp-head{display:flex;flex-direction:column;gap:12px}
.rp-title{display:flex;align-items:center;gap:8px;color:var(--navy);font-size:14px}
.rp-muted{color:var(--text-secondary);font-size:12px}
.rp-row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}
.rp-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--text-secondary)}
.rp-field>span{display:inline-flex;align-items:center;gap:5px;font-weight:600}
.rp-field select,.rp-field input,.rp-input{font:inherit;font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary,#1f2937);min-width:220px}
textarea.rp-input{resize:vertical;line-height:1.45;width:100%;box-sizing:border-box}
.rp-strong{font-weight:600}
.rp-note{font-size:11.5px;color:var(--text-secondary)}
.rp-error{font-size:12.5px;color:#b42318;background:#fde4e2;border-radius:6px;padding:8px 10px}
.rp-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:12px}
.rp-kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
.rp-kpi-l{font-size:11px;color:var(--text-secondary)}
.rp-kpi-v{font-size:16px;font-weight:700;color:var(--navy);margin-top:2px}
.rp-sec{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-weight:700;color:var(--navy);font-size:13px}
.rp-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.rp-card{border:1px solid var(--border);border-left:4px solid;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px}
.rp-card .rp-input{min-width:0;width:100%;box-sizing:border-box}
.rp-tag{font-size:10.5px;font-weight:700;letter-spacing:.04em}
.rp-hint{font-size:11px;color:var(--muted,#94a3b8)}
.rp-slide-row{display:grid;grid-template-columns:170px 1fr 90px;gap:10px;align-items:center;margin-top:8px}
.rp-slide-row .rp-input{min-width:0}
.rp-eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#83AA6E}
.rp-check{display:inline-flex;align-items:center;gap:5px;font-size:12px}
.rp-spin{animation:rpspin 1s linear infinite}
@keyframes rpspin{to{transform:rotate(360deg)}}
@media (max-width:900px){.rp-kpis{grid-template-columns:repeat(3,1fr)}.rp-cards{grid-template-columns:1fr}.rp-slide-row{grid-template-columns:1fr}}
`;
