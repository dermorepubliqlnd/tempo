import { Fragment, useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, Lightbulb, Clock, CheckCircle2, XCircle, Search } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import Modal from "../components/Modal";
import { useConfirm } from "../lib/useConfirm";

// 2026-10-04 (Sandra): capture enhancement requests / feedback.
// Data: Name (submitter), Submitted date, Subject, Details. Everyone can
// see every request and its status; Full Access (admins) change the status
// and write a response.
interface FeedbackRow {
  id: string;
  request_number: number;
  person_id: string;
  subject: string;
  details: string;
  status: Status;
  created_at: string;
  admin_response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  target_release_date?: string | null;
  released_on?: string | null;
}
type Status = "New" | "Under review" | "Planned" | "Done" | "Declined" | "Cancelled";
// Admin-settable statuses. "Cancelled" is set only by the submitter (while New).
const STATUSES: Status[] = ["New", "Under review", "Planned", "Done", "Declined"];
const STATUS_TONE: Record<Status, string> = { New: "accent", "Under review": "warning", Planned: "purple", Done: "success", Declined: "neutral", Cancelled: "slate" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function Feedback() {
  const { person: me } = useSession();
  const isFullAccess = me?.access_level === "full";
  const { confirm, dialog } = useConfirm();
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "All">("All");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [fb, ppl] = await Promise.all([
      supabase.from("feedback_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("people").select("id,name"),
    ]);
    setRows((fb.data as FeedbackRow[]) ?? []);
    setPeople((ppl.data as { id: string; name: string }[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);
  const [responseDraft, setResponseDraft] = useState<Record<string, string>>({});

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Unknown";
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (scope === "mine" ? r.person_id === me?.id : true))
      .filter((r) => statusFilter === "All" || r.status === statusFilter)
      .filter((r) => !q || r.subject.toLowerCase().includes(q) || r.details.toLowerCase().includes(q) || nameOf(r.person_id).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, scope, statusFilter, search, me?.id, people]);
  const scoped = rows.filter((r) => (scope === "mine" ? r.person_id === me?.id : true));
  const count = (s: Status) => scoped.filter((r) => r.status === s).length;

  async function submit() {
    const sj = subject.trim();
    const dt = details.trim();
    if (!sj) return setFormError("Add a subject for your request.");
    if (sj.length > 150) return setFormError("Keep the subject under 150 characters.");
    if (!dt) return setFormError("Add the details of your request.");
    if (!me?.id) return;
    setSaving(true);
    const { error } = await supabase.from("feedback_requests").insert({ person_id: me.id, subject: sj, details: dt });
    setSaving(false);
    if (error) return setFormError(`Couldn't submit: ${error.message}`);
    setFormOpen(false);
    setSubject("");
    setDetails("");
    setFormError(null);
    setNotice("Thanks! Your request was submitted.");
    window.setTimeout(() => setNotice(null), 4000);
    load();
  }

  async function setStatus(r: FeedbackRow, status: Status) {
    const today = new Date().toISOString().slice(0, 10);
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status, released_on: status === "Done" && !x.released_on ? today : x.released_on } : x)));
    const { error } = await supabase.from("feedback_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) {
      setNotice(`Couldn't update status: ${error.message}`);
      load();
    }
  }

  async function cancelRequest(r: FeedbackRow) {
    const { error } = await supabase.rpc("cancel_feedback_request", { p_id: r.id });
    if (error) {
      setNotice(error.message);
      return;
    }
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: "Cancelled" } : x)));
    setNotice(`FB-${String(r.request_number).padStart(4, "0")} was cancelled.`);
    window.setTimeout(() => setNotice(null), 4000);
  }

  async function saveResponse(r: FeedbackRow) {
    const text = (responseDraft[r.id] ?? "").trim();
    if (!text || !me?.id) return;
    const patch = { admin_response: text, responded_by: me.id, responded_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
    setResponseDraft((d) => ({ ...d, [r.id]: "" }));
    const { error } = await supabase.from("feedback_requests").update(patch).eq("id", r.id);
    if (error) {
      setNotice(`Couldn't save response: ${error.message}`);
      load();
    }
  }

  // 2026-10-09 (Sandra): target release + released date, shown to everyone.
  async function setReleaseDate(r: FeedbackRow, field: "target_release_date" | "released_on", value: string) {
    const v = value || null;
    setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, [field]: v } : x)));
    const { error } = await supabase.from("feedback_requests").update({ [field]: v, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { setNotice(`Couldn't save the date: ${error.message}`); load(); }
  }
  const releaseCell = (r: FeedbackRow) =>
    r.released_on ? (
      <span className="status-pill success" title="Released">Released {fmtDate(r.released_on + "T00:00:00")}</span>
    ) : r.target_release_date ? (
      <span className="status-pill purple" title="Target release">Target {fmtDate(r.target_release_date + "T00:00:00")}</span>
    ) : (
      <span style={{ color: "var(--muted)" }}>—</span>
    );

  const cards: { label: string; value: number; icon: typeof Lightbulb; color: string; bg: string }[] = [
    { label: "New", value: count("New"), icon: Lightbulb, color: "#2563eb", bg: "#eaf2ff" },
    { label: "Under review", value: count("Under review"), icon: Clock, color: "#b45309", bg: "#fff7e6" },
    { label: "Planned", value: count("Planned"), icon: MessageSquarePlus, color: "#7c3aed", bg: "#f1ecff" },
    { label: "Done", value: count("Done"), icon: CheckCircle2, color: "#16a34a", bg: "#e8f7ee" },
    { label: "Declined", value: count("Declined"), icon: XCircle, color: "#64748b", bg: "#f1f5f9" },
  ];

  return (
    <div>
      {dialog}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Feedback &amp; Requests</h1>
        <button
          onClick={() => {
            setFormError(null);
            setFormOpen(true);
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 999, padding: "9px 16px", cursor: "pointer", whiteSpace: "nowrap", width: "auto" }}
        >
          <MessageSquarePlus size={14} /> Submit a request
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 14 }}>
        Suggest an enhancement, report something that's confusing, or share an idea to make Tempo better.
      </div>
      {notice && (
        <div role="status" style={{ fontSize: 12.5, background: "#e8f7ee", color: "#15803d", borderRadius: 8, padding: "8px 12px", marginBottom: 12 }}>
          {notice}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
        {cards.map((c) => {
          const Icon = c.icon;
          const active = statusFilter === c.label;
          return (
            <button
              key={c.label}
              type="button"
              className="card"
              onClick={() => setStatusFilter(active ? "All" : (c.label as Status))}
              style={{ padding: "12px 14px", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, minWidth: 0, border: active ? "1.5px solid var(--accent)" : undefined }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: "50%", background: c.bg, color: c.color, flexShrink: 0 }}>
                <Icon size={16} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{c.label}</span>
                <span style={{ display: "block", fontSize: 20, fontWeight: 700, color: "var(--navy)" }}>{c.value}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {(
            <div style={{ display: "flex", gap: 4 }}>
              {(["all", "mine"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setScope(k)}
                  style={{ fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 999, border: "1px solid var(--border)", background: scope === k ? "var(--navy)" : "var(--surface)", color: scope === k ? "#fff" : "var(--navy)", cursor: "pointer", width: "auto" }}
                >
                  {k === "all" ? "All requests" : "My requests"}
                </button>
              ))}
            </div>
          )}
          {statusFilter !== "All" && (
            <button type="button" onClick={() => setStatusFilter("All")} style={{ fontSize: 11.5, border: "none", background: "var(--hover-bg)", borderRadius: 999, padding: "4px 10px", cursor: "pointer", width: "auto" }}>
              Status: {statusFilter} ×
            </button>
          )}
          <div style={{ position: "relative", marginLeft: "auto", width: 240 }}>
            <Search size={13} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input
              placeholder="Search requests..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", fontSize: 12, padding: "6px 8px 6px 26px", border: "1px solid var(--border)", borderRadius: 8 }}
            />
          </div>
        </div>
        <table className="data-table" style={{ width: "100%", tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ width: 80 }}>ID</th>
              <th style={{ width: 170 }}>Name</th>
              <th style={{ width: 120 }}>Submitted</th>
              <th>Subject</th>
              <th style={{ width: 210 }}>Status</th>
              <th style={{ width: 170 }}>Release</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ color: "var(--muted)" }}>Loading…</td>
              </tr>
            )}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: "var(--muted)" }}>
                  {rows.length === 0 ? "No requests yet. Use “Submit a request” to share an idea." : "No requests match."}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const open = openId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr onClick={() => setOpenId(open ? null : r.id)} style={{ cursor: "pointer" }}>
                    <td>FB-{String(r.request_number).padStart(4, "0")}</td>
                    <td>{nameOf(r.person_id)}</td>
                    <td>{fmtDate(r.created_at)}</td>
                    <td style={{ fontWeight: 600, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.subject}>
                      {r.subject}
                      {r.admin_response && <span className="status-pill success" style={{ marginLeft: 8, fontSize: 9.5 }}>Responded</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {isFullAccess && r.status !== "Cancelled" ? (
                          <select value={r.status} onChange={(e) => setStatus(r, e.target.value as Status)} style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)", flex: 1, minWidth: 0 }}>
                            {STATUSES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`status-pill ${STATUS_TONE[r.status]}`}>{r.status}</span>
                        )}
                        {r.person_id === me?.id && r.status === "New" && (
                          <button
                            type="button"
                            title="Cancel this request (only while it's New)"
                            onClick={async () => {
                              const ok = await confirm({
                                title: "Cancel this request?",
                                message: `FB-${String(r.request_number).padStart(4, "0")} "${r.subject}" will be marked Cancelled. You can't undo this.`,
                                confirmLabel: "Cancel request",
                                cancelLabel: "Keep it",
                                danger: true,
                              });
                              if (ok) void cancelRequest(r);
                            }}
                            style={{ fontSize: 11, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--danger-text)", borderRadius: 6, padding: "2px 8px", cursor: "pointer", width: "auto", flexShrink: 0 }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                    <td>{releaseCell(r)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} style={{ background: "var(--hover-bg)", fontSize: 12.5, lineHeight: 1.5, padding: "12px 14px" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Details</div>
                        <div style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>{r.details}</div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Release</div>
                        {isFullAccess ? (
                          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 12 }}>
                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              Target release
                              <input type="date" value={r.target_release_date ?? ""} onChange={(e) => setReleaseDate(r, "target_release_date", e.target.value)} style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 6 }} />
                            </label>
                            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              Released on
                              <input type="date" value={r.released_on ?? ""} onChange={(e) => setReleaseDate(r, "released_on", e.target.value)} style={{ fontSize: 12, padding: "3px 6px", border: "1px solid var(--border)", borderRadius: 6 }} />
                            </label>
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>Setting the status to Done fills in Released on with today.</span>
                          </div>
                        ) : (
                          <div style={{ marginBottom: 12 }}>{releaseCell(r)}</div>
                        )}
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Admin response</div>
                        {r.admin_response ? (
                          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", marginBottom: isFullAccess ? 8 : 0 }}>
                            <div style={{ whiteSpace: "pre-wrap" }}>{r.admin_response}</div>
                            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                              {r.responded_by ? nameOf(r.responded_by) : "Admin"}
                              {r.responded_at ? ` · ${fmtDate(r.responded_at)}` : ""}
                            </div>
                          </div>
                        ) : (
                          !isFullAccess && <div style={{ color: "var(--muted)" }}>No response yet.</div>
                        )}
                        {isFullAccess && (
                          <div style={{ display: "grid", gap: 6 }}>
                            <textarea
                              rows={3}
                              placeholder={r.admin_response ? "Update your response…" : "Write a response the submitter and team will see…"}
                              value={responseDraft[r.id] ?? ""}
                              onChange={(e) => setResponseDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                              style={{ fontSize: 12.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "inherit", resize: "vertical", background: "var(--surface)" }}
                            />
                            <div>
                              <button
                                type="button"
                                disabled={!(responseDraft[r.id] ?? "").trim()}
                                onClick={() => saveResponse(r)}
                                style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", opacity: (responseDraft[r.id] ?? "").trim() ? 1 : 0.5, width: "auto" }}
                              >
                                {r.admin_response ? "Update response" : "Post response"}
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <Modal title="Submit a request" onClose={() => setFormOpen(false)} width={520}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 3 }}>Name</div>
                <div style={{ fontWeight: 600 }}>{me?.name ?? "—"}</div>
              </div>
              <div>
                <div style={{ color: "var(--muted)", marginBottom: 3 }}>Submitted</div>
                <div style={{ fontWeight: 600 }}>{fmtDate(new Date().toISOString())}</div>
              </div>
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>
              Subject
              <input
                autoFocus
                value={subject}
                maxLength={150}
                placeholder="Add a Due date filter to My Tasks"
                onChange={(e) => {
                  setSubject(e.target.value);
                  setFormError(null);
                }}
                style={{ fontSize: 13, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontWeight: 400 }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>
              Details
              <textarea
                value={details}
                rows={7}
                placeholder="What would you like to change, and why would it help? Include the page and an example if you can."
                onChange={(e) => {
                  setDetails(e.target.value);
                  setFormError(null);
                }}
                style={{ fontSize: 13, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, fontWeight: 400, fontFamily: "inherit", resize: "vertical" }}
              />
            </label>
            {formError && <div style={{ fontSize: 12, color: "var(--danger-text)" }}>{formError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button
                type="button"
                disabled={saving}
                onClick={submit}
                style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 8, padding: "8px 16px", cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, width: "auto" }}
              >
                {saving ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
