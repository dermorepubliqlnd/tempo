// 2026-10-02 (Sandra): Approval Center > My Requests -- everyone's own
// submitted requests and their outcome in one place.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import { loadMyRequests, MY_REQUEST_KIND_LABEL, type MyRequestKind, type MyRequestRow, type MyRequestStatus } from "../lib/myRequests";

const STATUS_TONE: Record<MyRequestStatus, string> = { pending: "warning", approved: "success", rejected: "danger" };

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d.length <= 10 ? d + "T00:00:00" : d);
  return dt.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export default function MyRequestsPanel({ meId }: { meId: string }) {
  const [rows, setRows] = useState<MyRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | MyRequestStatus>("all");
  const [kind, setKind] = useState<"all" | MyRequestKind>("all");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setRows(await loadMyRequests(meId));
    setLoading(false);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  const counts = useMemo(
    () => ({
      all: rows.length,
      pending: rows.filter((r) => r.status === "pending").length,
      approved: rows.filter((r) => r.status === "approved").length,
      rejected: rows.filter((r) => r.status === "rejected").length,
    }),
    [rows]
  );
  const visible = useMemo(() => {
    let r = rows;
    if (status !== "all") r = r.filter((x) => x.status === status);
    if (kind !== "all") r = r.filter((x) => x.kind === kind);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((x) => [x.item, x.context, x.refId, x.typeLabel, x.note, x.decidedBy].filter(Boolean).join(" ").toLowerCase().includes(s));
    return r;
  }, [rows, status, kind, q]);

  const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", textAlign: "left" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
  const chip = (active: boolean): CSSProperties => ({
    fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
    border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: active ? "var(--accent-bg, #eaf2fb)" : "var(--surface)",
    color: active ? "var(--accent)" : "var(--text-secondary)",
  });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {([
          ["all", `All (${counts.all})`],
          ["pending", `Pending (${counts.pending})`],
          ["rejected", `Rejected / Declined (${counts.rejected})`],
          ["approved", `Approved (${counts.approved})`],
        ] as ["all" | MyRequestStatus, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setStatus(k)} style={chip(status === k)}>{l}</button>
        ))}
        <select value={kind} onChange={(e) => setKind(e.target.value as "all" | MyRequestKind)} style={{ fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginLeft: 4 }}>
          <option value="all">All types</option>
          {(Object.keys(MY_REQUEST_KIND_LABEL) as MyRequestKind[]).map((k) => (
            <option key={k} value={k}>{MY_REQUEST_KIND_LABEL[k]}</option>
          ))}
        </select>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 180 }}>
          <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, ID, note…" style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px 7px 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
        </div>
        <button onClick={load} title="Refresh" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-secondary)" }}>
          <RefreshCw size={13} />
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "0 0 10px" }}>Everything you've submitted for approval in the last 90 days, newest decision first.</p>

      {loading ? (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>No requests match.</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2, #f5f6f8)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>Type</th>
                <th style={th}>ID</th>
                <th style={th}>Item</th>
                <th style={th}>Request</th>
                <th style={th}>Submitted</th>
                <th style={th}>Status</th>
                <th style={th}>Decided by</th>
                <th style={th}>Decided on</th>
                <th style={th}>Note / Reason</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key} style={{ borderBottom: "1px solid var(--border)", background: r.status === "rejected" ? "var(--danger-bg)" : undefined }}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.typeLabel}</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{r.refId ?? "—"}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: "var(--navy)" }}>{r.item}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{r.context}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.asked}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fmt(r.submittedAt)}</td>
                  <td style={td}>
                    <span className={`status-pill ${STATUS_TONE[r.status]}`} style={{ fontSize: 9.5, whiteSpace: "nowrap" }}>{r.statusLabel}</span>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.status === "pending" ? "—" : r.decidedBy ?? "Auto"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{r.status === "pending" ? "—" : fmt(r.decidedAt)}</td>
                  <td style={{ ...td, maxWidth: 260, whiteSpace: "normal", wordBreak: "break-word" }}>{r.note ?? "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                    <Link to={r.link} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
                      {r.status === "rejected" ? (r.kind === "time" || r.kind === "correction" ? "Edit & resubmit" : "Review") : "Open"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
