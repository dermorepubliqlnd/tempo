// phase130 (Sandra): "if Joseph is going on leave, assign approver".
// While a delegation covers today, the delegator's routed items move to
// the delegate's "Mine to approve" tab (tagged "Acting for ...").
import { useState } from "react";
import Modal from "./Modal";
import { supabase } from "../lib/supabaseClient";
import { formatDate } from "../lib/formatDate";
import { manilaToday, type ApprovalDelegation } from "../lib/approvalRouting";

export default function DelegateApprovalsModal({
  meId,
  isFullAccess,
  people,
  delegations,
  onClose,
  onChanged,
}: {
  meId: string;
  isFullAccess: boolean;
  people: { id: string; name: string }[];
  delegations: ApprovalDelegation[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const today = manilaToday();
  const [delegator, setDelegator] = useState(meId);
  const [delegate, setDelegate] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? "—";
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const visible = delegations.filter((d) => !d.cancelled_at && d.end_date >= today && (isFullAccess || d.delegator_id === meId || d.delegate_id === meId));
  const valid = delegate && delegate !== delegator && start && end && end >= start && end >= today;

  async function save() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("approval_delegations").insert({ delegator_id: delegator, delegate_id: delegate, start_date: start, end_date: end });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDelegate("");
    onChanged();
  }

  async function cancel(id: string) {
    setBusy(true);
    const { error } = await supabase.from("approval_delegations").update({ cancelled_at: new Date().toISOString() }).eq("id", id);
    setBusy(false);
    if (error) setError(error.message);
    else onChanged();
  }

  const label = { display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--navy)", marginBottom: 4 } as const;
  const input = { width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" } as const;

  return (
    <Modal title="Delegate approvals" onClose={onClose} width={480}>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 0 }}>
        For the dates below, items routed to the approver go to the delegate instead. Without a delegate, approvals for someone on leave (Time Off) move up to their manager automatically.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {isFullAccess && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={label}>Approvals of</label>
            <select value={delegator} onChange={(e) => setDelegator(e.target.value)} style={input}>
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>{p.id === meId ? `${p.name} (me)` : p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={label}>Delegate to</label>
          <select value={delegate} onChange={(e) => setDelegate(e.target.value)} style={input}>
            <option value="">Select a person…</option>
            {sorted.filter((p) => p.id !== delegator).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>From</label>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={input} />
        </div>
        <div>
          <label style={label}>To</label>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={input} />
        </div>
      </div>
      {error && <div style={{ fontSize: 11.5, color: "var(--danger, #c0392b)", marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button
          disabled={!valid || busy}
          onClick={save}
          style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", opacity: valid && !busy ? 1 : 0.5 }}
        >
          Save delegation
        </button>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>Active and upcoming</div>
        {visible.length === 0 ? (
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>No delegations.</div>
        ) : (
          visible.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <strong style={{ color: "var(--navy)" }}>{name(d.delegator_id)}</strong> → {name(d.delegate_id)}
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {formatDate(d.start_date)} – {formatDate(d.end_date)}
                  {d.start_date <= today && <span className="status-pill success" style={{ fontSize: 9, marginLeft: 6 }}>Active</span>}
                </div>
              </div>
              {(isFullAccess || d.delegator_id === meId) && (
                <button onClick={() => cancel(d.id)} disabled={busy} style={{ fontSize: 11.5, color: "var(--danger, #c0392b)", background: "none", border: "none", cursor: "pointer" }}>
                  Cancel
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
