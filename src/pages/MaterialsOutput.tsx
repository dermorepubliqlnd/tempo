// Materials Output (full list) -- Phase 54, 2026-09-21.
//
// Sandra, after the Team Dashboard's Materials Output card was capped to
// its top 5 Output Types (so its height would line up with Portfolio
// Movement's fixed chart height): "so how do we see the remainder of the
// materials output?" -- confirmed she wants a dedicated page for it
// ("yes please"), same idea flagged as a probable follow-up in that
// earlier commit's comments.
//
// Same Period/Owner/Source filter bar and closed-vs-tentative Output
// Type rollup as the Dashboard card (duplicated here rather than shared,
// matching this codebase's existing per-page self-contained data-fetch
// convention -- see ClosedProjectReportPanel.tsx's own note on this),
// just unbounded (no top-5 cap) and rendered as both the same bar-list
// visual (reused from Dashboard.tsx) AND a plain table underneath, for
// easy copy/paste into Excel for a stakeholder update.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import type { ProjectRow, TaskRow } from "./Projects";
import { MaterialsOutputBarList, type OutputTypeRow } from "./Dashboard";

interface PersonRow {
  id: string;
  name: string;
}
interface SourceRow {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

const TODAY = new Date();
const TODAY_ISO = TODAY.toISOString().slice(0, 10);

const selectStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--navy)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 10px",
  background: "var(--surface)",
};

export default function MaterialsOutput() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [outputTypes, setOutputTypes] = useState<OutputTypeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [periodFilter, setPeriodFilter] = useState<"all" | "month" | "quarter" | "year">("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const [
        { data: projectData },
        { data: taskData },
        { data: peopleData },
        { data: sourceData },
        { data: outputTypeData },
      ] = await Promise.all([
        supabase.from("projects").select("*").eq("is_archived", false),
        supabase.from("tasks").select("*").eq("is_archived", false),
        supabase.from("people").select("id,name").eq("is_active", true),
        supabase.from("project_sources").select("id,name,is_active,sort_order").order("sort_order"),
        supabase.from("output_types").select("id,name,is_active,sort_order").order("sort_order"),
      ]);
      setProjects((projectData as ProjectRow[]) ?? []);
      setTasks((taskData as TaskRow[]) ?? []);
      setPeople((peopleData as PersonRow[]) ?? []);
      setSources((sourceData as SourceRow[]) ?? []);
      setOutputTypes((outputTypeData as OutputTypeRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const periodMatches = (p: ProjectRow): boolean => {
    if (periodFilter === "all" || !p.start_date) return true;
    const start = p.start_date.slice(0, 10);
    if (periodFilter === "month") return start.slice(0, 7) === TODAY_ISO.slice(0, 7);
    if (periodFilter === "quarter") {
      const startDate = new Date(start + "T00:00:00");
      const q = Math.floor(startDate.getMonth() / 3);
      const nowQ = Math.floor(TODAY.getMonth() / 3);
      return startDate.getFullYear() === TODAY.getFullYear() && q === nowQ;
    }
    return start.slice(0, 4) === TODAY_ISO.slice(0, 4); // year
  };

  const filteredProjects = useMemo(
    () =>
      projects.filter(
        (p) =>
          periodMatches(p) &&
          (ownerFilter === "all" || p.owner_id === ownerFilter) &&
          (sourceFilter === "all" || p.source_id === sourceFilter)
      ),
    [projects, periodFilter, ownerFilter, sourceFilter]
  );

  const filteredProjectIds = useMemo(() => new Set(filteredProjects.map((p) => p.id)), [filteredProjects]);

  const projectClosedById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const p of filteredProjects) m.set(p.id, p.wbs_status === "closed");
    return m;
  }, [filteredProjects]);

  // Same closed-vs-tentative rollup as Dashboard.tsx's materialsOutputRows
  // -- see that file's own comment for why Cancelled tasks and untyped
  // output are handled the way they are. Unbounded here: every Output
  // Type with data, not just the top 5.
  const materialsOutputRows = useMemo(() => {
    const closedCounts: Record<string, number> = {};
    const tentativeCounts: Record<string, number> = {};
    let untypedClosed = 0;
    let untypedTentative = 0;
    for (const t of tasks) {
      if (!filteredProjectIds.has(t.project_id)) continue;
      if (t.status === "Cancelled") continue;
      const n = t.output_count ?? 0;
      if (n <= 0) continue;
      const isClosed = projectClosedById.get(t.project_id) ?? false;
      if (!t.output_type_id) {
        if (isClosed) untypedClosed += n;
        else untypedTentative += n;
        continue;
      }
      if (isClosed) closedCounts[t.output_type_id] = (closedCounts[t.output_type_id] ?? 0) + n;
      else tentativeCounts[t.output_type_id] = (tentativeCounts[t.output_type_id] ?? 0) + n;
    }
    const rows = outputTypes
      .filter((o) => closedCounts[o.id] || tentativeCounts[o.id])
      .map((o) => ({ label: o.name, closed: closedCounts[o.id] ?? 0, tentative: tentativeCounts[o.id] ?? 0 }));
    if (untypedClosed || untypedTentative) rows.push({ label: "Untyped", closed: untypedClosed, tentative: untypedTentative });
    return rows.sort((a, b) => b.closed + b.tentative - (a.closed + a.tentative));
  }, [tasks, filteredProjectIds, projectClosedById, outputTypes]);

  const totals = useMemo(
    () =>
      materialsOutputRows.reduce(
        (acc, r) => ({ closed: acc.closed + r.closed, tentative: acc.tentative + r.tentative }),
        { closed: 0, tentative: 0 }
      ),
    [materialsOutputRows]
  );
  const grandTotal = totals.closed + totals.tentative;

  if (loading) {
    return (
      <div>
        <h1>Materials Output</h1>
        <p className="subtitle">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <Link to="/team-dashboard" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--muted)", textDecoration: "none", marginBottom: 8 }}>
        <ChevronLeft size={14} /> Back to Team Dashboard
      </Link>
      <h1 style={{ marginBottom: 4 }}>Materials Output</h1>
      <p className="subtitle" style={{ marginBottom: 16 }}>
        Every Output Type with logged Output Count, closed vs. tentative -- same rollup as the Team Dashboard card, unbounded.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as typeof periodFilter)} style={selectStyle}>
          <option value="all">Period: All Time</option>
          <option value="month">Period: This Month</option>
          <option value="quarter">Period: This Quarter</option>
          <option value="year">Period: This Year</option>
        </select>
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={selectStyle}>
          <option value="all">Owner: All Owners</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              Owner: {p.name}
            </option>
          ))}
        </select>
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={selectStyle}>
          <option value="all">Source: All Sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              Source: {s.name}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
        <div className="card">
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 6 }}>Output Types</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)" }}>{materialsOutputRows.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 6 }}>Closed (counted)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--success-text)" }}>{totals.closed}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 6 }}>Tentative (not yet closed)</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{totals.tentative}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>By Output Type</div>
        <MaterialsOutputBarList rows={materialsOutputRows} total={grandTotal} hiddenCount={0} />
      </div>

      <div className="card">
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>Full List</div>
        {materialsOutputRows.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--muted)" }}>No output logged yet -- set Output Type + Output Count on tasks in WBS Planning.</div>
        ) : (
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Output Type</th>
                <th>Closed</th>
                <th>Tentative</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {materialsOutputRows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td>{r.closed}</td>
                  <td>{r.tentative}</td>
                  <td style={{ fontWeight: 600 }}>{r.closed + r.tentative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
