// 2026-10-02 (Sandra): Approval Center > My Requests -- everyone's own
// submitted requests and their outcome, laid out like the approval tabs:
// KPI cards per type, status filter (default Pending), grouped sections.
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { CalendarClock, ChevronRight, Clock, FilePen, FolderCheck, ListChecks, RefreshCw, Search, ShieldCheck, Timer } from "lucide-react";
import { loadMyRequests, type MyRequestKind, type MyRequestRow, type MyRequestStatus } from "../lib/myRequests";

type Group = "extension" | "time" | "correction" | "baseline" | "closure" | "task_completion";
const GROUP_OF: Record<MyRequestKind, Group> = {
  time: "time",
  correction: "correction",
  extension: "extension",
  project_extension: "extension",
  baseline: "baseline",
  closure: "closure",
  task_completion: "task_completion",
};
const GROUP_META: Record<Group, { label: string; plural: string; tone: string; icon: JSX.Element }> = {
  extension: { label: "Extension", plural: "Extension Requests", tone: "gold", icon: <CalendarClock size={13} /> },
  time: { label: "Time Entry", plural: "Time Entries", tone: "accent", icon: <Timer size={13} /> },
  correction: { label: "Time Correction", plural: "Time Corrections", tone: "skyblue", icon: <FilePen size={13} /> },
  baseline: { label: "Project Start", plural: "Project Start", tone: "purple", icon: <ShieldCheck size={13} /> },
  closure: { label: "Project Close", plural: "Project Close", tone: "mint", icon: <FolderCheck size={13} /> },
  task_completion: { label: "Task Validation", plural: "Task Validations", tone: "success", icon: <ListChecks size={13} /> },
};
const GROUP_ORDER: Group[] = ["extension", "time", "correction", "baseline", "closure", "task_completion"];
const STATUS_TONE: Record<MyRequestStatus, string> = { pending: "warning", approved: "success", rejected: "danger" };

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? d + "T00:00:00" : d);
  return dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export default function MyRequestsPanel({ meId }: { meId: string }) {
  const [rows, setRows] = useState<MyRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | MyRequestStatus>("pending");
  const [group, setGroup] = useState<Group | null>(null);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<Group>>(new Set(GROUP_ORDER));

  async function load() {
    setLoading(true);
    setRows(await loadMyRequests(meId));
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  const statusRows = useMemo(() => (status === "all" ? rows : rows.filter((r) => r.status === status)), [rows, status]);
  const statusCounts = useMemo(
    () => ({ all: rows.length, pending: rows.filter((r) => r.status === "pending").length, rejected: rows.filter((r) => r.status === "rejected").length, approved: rows.filter((r) => r.status === "approved").length }),
    [rows]
  );
  const visible = useMemo(() => {
    let r = statusRows;
    if (group) r = r.filter((x) => GROUP_OF[x.kind] === group);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => [x.item, x.context, x.refId, x.typeLabel, x.note, x.decidedBy].filter(Boolean).join(" ").toLowerCase().includes(s));
    return r;
  }, [statusRows, group, q]);

  const card = (active: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 12, flex: "1 1 200px", minWidth: 200, textAlign: "left", padding: "14px 16px",
    borderRadius: "var(--radius)", border: active ? "2px solid var(--accent)" : "1px solid var(--border)", background: "var(--surface)", cursor: "pointer",
  });
  const chip = (active: boolean): CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
    border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: active ? "var(--accent-bg, #eaf2fb)" : "var(--surface)",
    color: active ? "var(--accent)" : "var(--text-secondary)",
  });
  const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", textAlign: "left" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
  const statusWord = status === "all" ? "in total" : status === "pending" ? "awaiting a decision" : status === "approved" ? "approved" : "rejected / declined";

  return (
    <div>
      {/* KPI cards -- count follows the status filter; click to filter by type */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => setGroup(null)} style={card(group === null)}>
          <span className="status-pill slate" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, flexShrink: 0 }}>
            <Clock size={15} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>All My Requests</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", lineHeight: 1.15 }}>{statusRows.length}</div>
            <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{statusWord}</div>
          </div>
          <ChevronRight size={16} style={{ color: "var(--muted)" }} />
        </button>
        {GROUP_ORDER.map((g) => {
          const m = GROUP_META[g];
          const n = statusRows.filter((r) => GROUP_OF[r.kind] === g).length;
          return (
            <button key={g} onClick={() => setGroup((prev) => (prev === g ? null : g))} style={card(group === g)}>
              <span className={`status-pill ${m.tone}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, flexShrink: 0 }}>
                {m.icon}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>{m.plural}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", lineHeight: 1.15 }}>{n}</div>
                <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{statusWord}</div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--muted)" }} />
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {([
          ["pending", `Pending (${statusCounts.pending})`],
          ["rejected", `Rejected / Declined (${statusCounts.rejected})`],
          ["approved", `Approved (${statusCounts.approved})`],
          ["all", `All (${statusCounts.all})`],
        ] as ["all" | MyRequestStatus, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)} style={chip(status === k)}>{l}</button>
        ))}
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 180 }}>
          <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, ID, note…" style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px 7px 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
        </div>
        <button onClick={load} title="Refresh" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-secondary)" }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>{status === "pending" ? "Nothing waiting on a decision." : "No requests match."}</p>
      ) : (
        GROUP_ORDER.map((g) => {
          const gr = visible.filter((r) => GROUP_OF[r.kind] === g);
          if (gr.length === 0) return null;
          const m = GROUP_META[g];
          const open = expanded.has(g);
          return (
            <Fragment key={g}>
              <div style={{ marginBottom: 12 }}>
                <button
                  onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; })}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer", marginBottom: open ? 8 : 0 }}
                >
                  <ChevronRight size={14} style={{ color: "var(--muted)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
                  <span className={`status-pill ${m.tone}`} style={{ fontSize: 10 }}>{m.plural}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>({gr.length})</span>
                </button>
                {open && (
                  <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--surface-2, #f5f6f8)", borderBottom: "1px solid var(--border)" }}>
                          <th style={th}>ID</th>
                          <th style={th}>Item</th>
                          <th style={th}>Type</th>
                          <th style={th}>Request</th>
                          <th style={th}>Submitted</th>
                          <th style={th}>Status</th>
                          <th style={th}>Approver</th>
                          <th style={th}>Decided on</th>
                          <th style={th}>Note / Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gr.map((r) => (
                          <tr key={r.key} style={{ borderBottom: "1px solid var(--border)", background: r.status === "rejected" ? "var(--danger-bg)" : undefined }}>
                            <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{r.refId ?? "—"}</td>
                            <td style={td}>
                              <div style={{ fontWeight: 700, color: "var(--navy)" }}>{r.item}</div>
                              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{r.context}</div>
                            </td>
                            <td style={td}>
                              <span className={`status-pill ${m.tone}`} style={{ fontSize: 9.5, whiteSpace: "nowrap" }}>{r.typeLabel}</span>
                            </td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{r.asked}</td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{fmt(r.submittedAt)}</td>
                            <td style={td}>
                              <span className={`status-pill ${STATUS_TONE[r.status]}`} style={{ fontSize: 9.5, whiteSpace: "nowrap" }}>{r.statusLabel}</span>
                            </td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>
                              {r.status === "pending" ? <span title="Waiting on">{r.pendingWith ?? "—"}</span> : r.decidedBy ?? "Auto"}
                            </td>
                            <td style={{ ...td, whiteSpace: "nowrap" }}>{r.status === "pending" ? "—" : fmt(r.decidedAt)}</td>
                            <td style={{ ...td, maxWidth: 280, whiteSpace: "normal", wordBreak: "break-word" }}>{r.note ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Fragment>
          );
        })
      )}
    </div>
  );
}
