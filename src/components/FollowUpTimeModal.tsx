import { useState, type CSSProperties } from "react";
import Modal from "./Modal";
import { submitFollowUpTimeEntry, FOLLOW_UP_REASON_LABEL, type FollowUpReason } from "../lib/timeTracking";

// 2026-09-24 (phase110): "Log follow-up time" on a Done / validated task.
// The task stays Done; the entry goes to the Approval Center tagged as a
// follow-up with its reason, so rework hours can be reported separately.
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function FollowUpTimeModal({
  taskName,
  taskId,
  onBehalfOf,
  onClose,
  onSaved,
}: {
  taskName: string;
  taskId: string;
  onBehalfOf: string | null; // assignee's name when Full Access logs for someone else
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [reason, setReason] = useState<FollowUpReason | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const start = new Date(`${date}T${startTime}`);
  const end = new Date(`${date}T${endTime}`);
  const minutes = isNaN(start.getTime()) || isNaN(end.getTime()) ? 0 : Math.round((end.getTime() - start.getTime()) / 60000);

  async function submit() {
    setError(null);
    if (!reason) return setError("Choose a follow-up reason.");
    if (minutes <= 0) return setError("End time must be after start time.");
    if (end.getTime() > Date.now()) return setError("Future time entry not allowed -- time entries can only cover time that has already passed.");
    if (onBehalfOf && !notes.trim()) return setError(`Add a note explaining why you're logging this on ${onBehalfOf}'s behalf.`);
    setSaving(true);
    const res = await submitFollowUpTimeEntry(taskId, start.toISOString(), end.toISOString(), reason, notes.trim());
    setSaving(false);
    if (res.error) return setError(res.error);
    onSaved();
  }

  const input: CSSProperties = { fontSize: 12.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" };
  const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, display: "block" };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;

  return (
    <Modal title="Log follow-up time" onClose={onClose} width={480}>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 0 }}>
        For extra work on <strong>{taskName}</strong> after it was marked Done. The task stays Done and keeps its validated date. This entry goes to
        your approver in the Approval Center.
      </p>
      {onBehalfOf && (
        <div className="status-pill warning" style={{ display: "inline-block", fontSize: 11, marginBottom: 10 }}>
          Logging on behalf of {onBehalfOf}
        </div>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <span style={label}>When</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={input} />
            <span style={{ fontSize: 12, color: "var(--muted)" }}>to</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={input} />
            <span style={{ fontSize: 12, fontWeight: 700, color: minutes > 0 ? "var(--navy)" : "var(--danger-text)" }}>
              {minutes > 0 ? `= ${h > 0 ? `${h}h ` : ""}${m}m` : "—"}
            </span>
          </div>
        </div>
        <div>
          <span style={label}>Reason (required)</span>
          <select value={reason} onChange={(e) => setReason(e.target.value as FollowUpReason)} style={{ ...input, width: "100%" }}>
            <option value="">Choose a reason…</option>
            {(Object.keys(FOLLOW_UP_REASON_LABEL) as FollowUpReason[]).map((k) => (
              <option key={k} value={k}>
                {FOLLOW_UP_REASON_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span style={label}>What was done{onBehalfOf ? " (required)" : " (optional)"}</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Revised copy for temporary shutdown" style={{ ...input, width: "100%" }} />
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--danger-text)", whiteSpace: "pre-wrap" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={submit}>{saving ? "Submitting…" : "Submit for approval"}</button>
        </div>
      </div>
    </Modal>
  );
}
