// 2026-10-14 (Sandra): "Complete task" pop-up -- the ONE place a task is
// marked Done. Everything needed to finish a task is filled in here instead
// of being sent back to the table: Reported Completion, Output Count (pre-
// filled, editable), with Due date, Work Type and Output Type shown for a
// final check, and a Log time link for the logged-hours requirement.
import { useEffect, useState } from "react";
import Modal from "./Modal";
import { formatDate } from "../lib/formatDate";

export interface CompleteTaskInfo {
  name: string;
  dueDate: string | null;
  workTypeName: string | null;
  outputTypeName: string | null;
  /** false = "No Deliverable" output type: Output Count is always 0. */
  countsDeliverable: boolean;
  estimatedHours: number | null;
  /** Final (confirmed/approved) hours on this task: what counts for Done. */
  loggedHours: number;
  /** Hours logged but still waiting for approval (shown, not counted). */
  pendingHours: number;
  /** phase189: when set, Work Type / Output Type are editable (changes go to the Audit Trail). */
  typeEdit?: {
    workTypeId: string | null;
    outputTypeId: string | null;
    workTypes: { id: string; name: string; is_active?: boolean }[];
    outputTypes: { id: string; name: string; is_active?: boolean; counts_deliverable?: boolean }[];
    links: { work_type_id: string; output_type_id: string }[];
  };
}

interface Props {
  info: CompleteTaskInfo;
  initialDate: string;
  initialCount: number | null;
  today: string;
  /** Wording of the confirm button and title (e.g. "Ready for Review"). */
  actionLabel?: string;
  onLogTime: () => void;
  onCancel: () => void;
  /** Save and mark Done. Return an error message to keep the pop-up open. */
  onConfirm: (date: string, outputCount: number, types?: { workTypeId: string | null; outputTypeId: string | null }) => Promise<string | null>;
}

const label: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", fontWeight: 600 };
const value: React.CSSProperties = { fontSize: 12.5, color: "var(--text)" };
const input: React.CSSProperties = { fontSize: 12.5, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontFamily: "inherit", width: "100%", boxSizing: "border-box" };

export default function CompleteTaskModal({ info, initialDate, initialCount, today, actionLabel = "Mark Done", onLogTime, onCancel, onConfirm }: Props) {
  const te = info.typeEdit;
  const [wtId, setWtId] = useState<string>(te?.workTypeId ?? "");
  const [otId, setOtId] = useState<string>(te?.outputTypeId ?? "");
  const selOt = te ? te.outputTypes.find((o) => o.id === otId) : null;
  const countsDeliverable = te ? !!selOt && selOt.counts_deliverable !== false : info.countsDeliverable;
  const outputTypeName = te ? selOt?.name ?? null : info.outputTypeName;
  const mapped = te && wtId ? new Set(te.links.filter((m) => m.work_type_id === wtId).map((m) => m.output_type_id)) : null;
  const pickableOt = te
    ? te.outputTypes.filter((o) => (o.is_active !== false || o.id === otId) && (!mapped || mapped.size === 0 || mapped.has(o.id) || o.id === otId))
    : [];
  const typesChanged = !!te && ((te.workTypeId ?? "") !== wtId || (te.outputTypeId ?? "") !== otId);
  const [date, setDate] = useState(initialDate);
  const [count, setCount] = useState(countsDeliverable ? (initialCount != null && initialCount > 0 ? String(initialCount) : "") : "0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setError(""), [date, count, info.loggedHours, wtId, otId]);
  useEffect(() => {
    if (!countsDeliverable) setCount("0");
    else if (count === "0") setCount("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsDeliverable]);

  const hoursOk = info.loggedHours > 0;
  const countNum = Number(count);
  const countOk = !countsDeliverable || (count.trim() !== "" && Number.isInteger(countNum) && countNum >= 1);
  const dateOk = !!date && date <= today;

  async function submit() {
    const problems: string[] = [];
    if (!dateOk) problems.push(date ? "Reported Completion can't be in the future." : "Enter the Reported Completion date.");
    if (countsDeliverable && !countOk) problems.push(`Enter how many ${outputTypeName ?? "outputs"} this task produced (1 or more).`);
    if (!hoursOk) problems.push(info.pendingHours > 0 ? "Your logged time is still waiting for approval. It counts once approved." : "Log your time on this task first.");
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    setBusy(true);
    if (te && !otId) {
      setError("Pick an Output Type.");
      setBusy(false);
      return;
    }
    const err = await onConfirm(date, countsDeliverable ? countNum : 0, typesChanged ? { workTypeId: wtId || null, outputTypeId: otId || null } : undefined);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Modal title={actionLabel === "Mark Done" ? "Complete task" : actionLabel} onClose={() => (busy ? undefined : onCancel())} width={480}>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{info.name}</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ display: "grid", gap: 4 }}>
            <span style={label}>Due date</span>
            <span style={value}>{info.dueDate ? formatDate(info.dueDate) : "—"}</span>
          </div>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={label}>Reported Completion *</span>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} style={input} />
          </label>
          {te ? (
            <>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Work Type</span>
                <select value={wtId} onChange={(e) => setWtId(e.target.value)} style={input}>
                  <option value="">—</option>
                  {te.workTypes.filter((w) => w.is_active !== false || w.id === wtId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={label}>Output Type</span>
                <select value={otId} onChange={(e) => setOtId(e.target.value)} style={input}>
                  <option value="">—</option>
                  {pickableOt.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <div style={{ display: "grid", gap: 4 }}>
                <span style={label}>Work Type</span>
                <span style={value}>{info.workTypeName ?? "—"}</span>
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                <span style={label}>Output Type</span>
                <span style={value}>{outputTypeName ?? "—"}</span>
              </div>
            </>
          )}
          <label style={{ display: "grid", gap: 4 }}>
            <span style={label}>Output Count{countsDeliverable ? " *" : ""}</span>
            {countsDeliverable ? (
              <input type="number" min={1} step={1} value={count} onChange={(e) => setCount(e.target.value)} placeholder="1" style={input} />
            ) : (
              <span style={{ ...value, color: "var(--muted)" }} title="This output type has no deliverable, so the count is always 0.">0 · no deliverable</span>
            )}
          </label>
          <div style={{ display: "grid", gap: 4 }}>
            <span style={label}>Logged hours *</span>
            <span style={{ ...value, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ color: hoursOk ? "var(--text)" : "var(--danger-text)", fontWeight: 600 }}>{info.loggedHours.toFixed(2)}h</span>
              {info.estimatedHours != null && <span style={{ color: "var(--muted)" }}>of {info.estimatedHours}h est.</span>}
              <button type="button" onClick={onLogTime} style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>
                + Log time
              </button>
            </span>
            {info.pendingHours > 0 && <span style={{ fontSize: 11, color: "var(--muted)" }}>{info.pendingHours.toFixed(2)}h waiting for approval</span>}
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
          Check the details, then confirm. Status moves to Done.{typesChanged ? " The Work Type / Output Type change is recorded in the Audit Trail." : ""}
        </div>
        {error && <div style={{ color: "var(--danger-text)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : actionLabel}</button>
        </div>
      </div>
    </Modal>
  );
}
