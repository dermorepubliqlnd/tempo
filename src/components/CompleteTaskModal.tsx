// 2026-10-14 (Sandra): "Complete task" pop-up -- the ONE place a task is
// marked Done. Everything needed to finish a task is filled in here instead
// of being sent back to the table: Reported Completion, Output Count (pre-
// filled, editable), with Due date, Work Type and Output Type shown for a
// final check, and a Log time link for the logged-hours requirement.
import { useEffect, useState } from "react";
import DateInput from "./DateInput";
import Modal from "./Modal";
import { DialogHeader, InfoTip, SummaryBand } from "./DialogHeader";
import { BadgeCheck, CalendarDays, CircleCheck, Clock3, Send, ShieldCheck, SquareCheckBig } from "lucide-react";
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
  /** Hours logged since the task last came back For Revision (null = it never did). */
  revisionHours?: number | null;
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
  /** Review steps: send the work back instead of passing it. */
  onRevision?: () => void;
  onConfirm: (date: string, outputCount: number, types?: { workTypeId: string | null; outputTypeId: string | null }) => Promise<string | null>;
  /** What confirming does, in plain words (e.g. "Sends it to Joseph for review."). */
  outcome?: string;
  /** Green confirmation shown in the pop-up, e.g. after time was logged. */
  notice?: string;
  /** New projects (2026-10-22): completion date is today, set automatically; no validation step. */
  autoDate?: boolean;
  /** One line under the title, e.g. "Confirm the work details before sending this task to … for review." */
  subtitle?: string;
}

const label: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", fontWeight: 600 };
const value: React.CSSProperties = { fontSize: 12.5, color: "var(--text)" };
const input: React.CSSProperties = { fontSize: 12.5, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontFamily: "inherit", width: "100%", boxSizing: "border-box" };

export default function CompleteTaskModal({ info, initialDate, initialCount, today, actionLabel = "Mark Done", onLogTime, onCancel, onConfirm, onRevision, outcome, notice, autoDate, subtitle }: Props) {
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
  // phase199: System Configuration always counts as 1 output.
  const fixedOne = outputTypeName === "System Configuration";
  const [count, setCount] = useState(fixedOne ? "1" : countsDeliverable ? (initialCount != null && initialCount > 0 ? String(initialCount) : "") : "0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setError(""), [date, count, info.loggedHours, wtId, otId]);
  useEffect(() => {
    if (fixedOne) setCount("1");
    else if (!countsDeliverable) setCount("0");
    else if (count === "0") setCount("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsDeliverable, fixedOne]);

  // 2026-10-23 (Sandra): after For Revision, time must be logged again before resubmitting.
  const needsRevisionTime = info.revisionHours != null && info.revisionHours <= 0;
  const hoursOk = info.loggedHours > 0 && !needsRevisionTime;
  const countNum = Number(count);
  const countOk = !countsDeliverable || (count.trim() !== "" && Number.isInteger(countNum) && countNum >= 1);
  const dateOk = autoDate || (!!date && date <= today);

  async function submit() {
    const problems: string[] = [];
    if (!dateOk) problems.push(date ? "Reported Completion can't be in the future." : "Enter the Reported Completion date.");
    if (countsDeliverable && !countOk) problems.push(`Enter how many ${outputTypeName ?? "outputs"} this task produced (1 or more).`);
    if (!hoursOk) problems.push(needsRevisionTime ? "Log the time you spent on the revision first." : info.pendingHours > 0 ? "Your logged time is still waiting for approval. It counts once approved." : "Log your time on this task first.");
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
    const err = await onConfirm(autoDate ? today : date, countsDeliverable ? countNum : 0, typesChanged ? { workTypeId: wtId || null, outputTypeId: otId || null } : undefined);
    setBusy(false);
    if (err) setError(err);
  }

  // 2026-10-23 (Sandra's mock-up): header with icon, summary band, clearer fields.
  const head =
    actionLabel === "Ready for Review"
      ? { title: "Submit for Review", button: "Submit for Review", icon: <SquareCheckBig size={22} /> }
      : actionLabel === "Pass QA"
        ? { title: "Pass QA", button: "Pass QA", icon: <ShieldCheck size={22} /> }
        : actionLabel === "Approve"
          ? { title: "Approve", button: "Approve", icon: <BadgeCheck size={22} /> }
          : { title: "Complete task", button: "Mark Done", icon: <CircleCheck size={22} /> };
  const fieldLabel: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--text)" };
  const box: React.CSSProperties = { ...input, fontSize: 13.5, padding: "9px 12px", borderRadius: 8 };
  const helper: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)" };

  return (
    <Modal title={head.title} hideHeader onClose={() => (busy ? undefined : onCancel())} width={600}>
      <div style={{ display: "grid", gap: 18, padding: "4px 4px 0" }}>
        <DialogHeader icon={head.icon} title={head.title} subtitle={subtitle ?? outcome} onClose={busy ? undefined : onCancel} />

        <SummaryBand
          items={[
            { label: "Task", value: <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={info.name}>{info.name}</span> },
            { label: "Due date", value: <><CalendarDays size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />{info.dueDate ? formatDate(info.dueDate) : "—"}</> },
            autoDate
              ? { label: "Completion date", value: <><CalendarDays size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />{formatDate(today)}<InfoTip text="Set automatically on submission." /></> }
              : { label: "Reported completion *", value: <DateInput value={date} max={today} onChange={(e) => setDate(e.target.value)} style={{ ...input, fontWeight: 400 }} /> },
          ]}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 18px" }}>
          {te ? (
            <>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabel}>Work type</span>
                <select value={wtId} onChange={(e) => {
                  const next = e.target.value;
                  setWtId(next);
                  // Clear an Output Type that doesn't belong to the new Work Type.
                  const allowed = next ? te.links.filter((m) => m.work_type_id === next).map((m) => m.output_type_id) : [];
                  if (otId && allowed.length && !allowed.includes(otId)) setOtId(allowed.length === 1 ? allowed[0] : "");
                  else if (!otId && allowed.length === 1) setOtId(allowed[0]);
                }} style={box}>
                  <option value="">—</option>
                  {te.workTypes.filter((w) => w.is_active !== false || w.id === wtId).map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabel}>Output type</span>
                <select value={otId} onChange={(e) => setOtId(e.target.value)} style={!otId ? { ...box, borderColor: "var(--warning-text, #b45309)", background: "var(--warning-bg, #fff8e6)" } : box}>
                  <option value="">Please select output type</option>
                  {pickableOt.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabel}>Work type</span>
                <span style={value}>{info.workTypeName ?? "—"}</span>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <span style={fieldLabel}>Output type</span>
                <span style={value}>{outputTypeName ?? "—"}</span>
              </div>
            </>
          )}
          <label style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span style={fieldLabel}>Output count{countsDeliverable && !fixedOne ? <span style={{ color: "var(--danger-text)" }}> *</span> : null}</span>
            {countsDeliverable ? (
              fixedOne ? (
                <span style={{ ...box, color: "var(--muted)", background: "var(--surface-2, #f4f6f9)" }} title="System Configuration always counts as 1 output.">1 · system configuration</span>
              ) : (
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  placeholder="Enter quantity"
                  title="How many outputs this task produced (1 or more)"
                  // Light blue = type here (a grey "1" looked like a real entry).
                  style={{ ...box, background: "#eaf3fe", borderColor: "#9cc3f0" }}
                />
              )
            ) : (
              <span style={{ ...box, color: "var(--muted)", background: "var(--surface-2, #f4f6f9)" }} title="This output type has no deliverable, so the count is always 0.">0 · no deliverable</span>
            )}
            {countsDeliverable && !fixedOne && <span style={helper}>Enter the total number of outputs completed for this task.</span>}
          </label>
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            <span style={fieldLabel}>Time logged <span style={{ color: "var(--danger-text)" }}>*</span></span>
            {needsRevisionTime ? (
              // 2026-10-23 (Sandra's mock-up): total so far, soft red "0h since revision request".
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingTop: 2 }}>
                <Clock3 size={20} style={{ color: "var(--muted)", flexShrink: 0, marginTop: 1 }} />
                <div style={{ display: "grid", gap: 2, fontSize: 13 }}>
                  <strong style={{ color: "var(--text)" }}>{info.loggedHours.toFixed(2)}h total</strong>
                  <span style={{ color: "#c2410c", fontSize: 12.5 }}>0h since revision request</span>
                  {info.estimatedHours != null && <span style={{ color: "var(--muted)", fontSize: 12.5 }}>of {info.estimatedHours}h est.</span>}
                </div>
              </div>
            ) : hoursOk ? (
              <>
                <span style={{ ...box, display: "flex", alignItems: "center", gap: 8 }}>
                  <CircleCheck size={17} style={{ color: "var(--success-text)", flexShrink: 0 }} />
                  <strong style={{ color: "var(--success-text)" }}>{info.loggedHours.toFixed(2)}h logged</strong>
                  {info.estimatedHours != null && <span style={{ color: "var(--muted)" }}>of {info.estimatedHours}h est.</span>}
                </span>
                <button type="button" onClick={onLogTime} title="Worked on it since your last log? Add that time too." style={{ justifySelf: "start", background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", fontSize: 12.5, textDecoration: "underline", width: "auto" }}>
                  Log additional time
                </button>
              </>
            ) : (
              <span style={{ ...box, color: "var(--danger-text)", fontWeight: 700 }}>0h · needed to finish</span>
            )}
          </div>
        </div>

        {!hoursOk && (
          <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--warning-border, #f3d48b)", background: "var(--warning-bg, #fff8e6)", fontSize: 12.5 }}>
            {needsRevisionTime ? (
              <>
                <span aria-hidden="true" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: "#f59e0b", color: "#fff", fontWeight: 800, fontSize: 15 }}>!</span>
                <span style={{ flex: 1, minWidth: 200, display: "grid", gap: 2 }}>
                  <strong style={{ fontSize: 13.5, color: "var(--text)" }}>Revision time required</strong>
                  <span style={{ color: "var(--text-secondary)" }}>Log time spent on revisions before resubmitting.</span>
                </span>
                <button type="button" className="btn-secondary" onClick={onLogTime} style={{ padding: "7px 16px", fontSize: 12.5, background: "#fff" }}>Log time</button>
              </>
            ) : info.pendingHours > 0 ? (
              <span style={{ flex: 1, minWidth: 200 }}>Your {info.pendingHours.toFixed(2)}h is waiting for approval. You can finish once it's approved.</span>
            ) : (
              <>
                <span style={{ flex: 1, minWidth: 200 }}><strong>No time logged on this task yet.</strong> Log your time first, then finish.</span>
                <button type="button" className="btn-primary" onClick={onLogTime} style={{ padding: "5px 12px", fontSize: 12 }}>Log time</button>
              </>
            )}
          </div>
        )}

        {typesChanged && <div style={helper}>The Work Type / Output Type change is recorded in the Audit Trail.</div>}
        {notice && !error && <div role="status" style={{ color: "var(--success-text)", background: "var(--success-bg, rgba(22,163,74,.08))", borderRadius: 6, padding: "6px 8px", fontSize: 12, fontWeight: 600 }}>✓ {notice}</div>}
        {error && <div style={{ color: "var(--danger-text)", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <button className="btn-secondary" disabled={busy} onClick={onCancel} style={{ padding: "9px 20px" }}>Cancel</button>
          {onRevision && (
            <button className="btn-secondary" disabled={busy} onClick={onRevision} style={{ padding: "9px 16px", color: "var(--warning-text)", display: "inline-flex", alignItems: "center", gap: 6 }} title="Send the work back to its owner with a comment">
              ↺ For Revision
            </button>
          )}
          <button className="btn-primary" disabled={busy || !hoursOk} title={!hoursOk ? "Log your time on this task first" : undefined} onClick={() => void submit()} style={{ padding: "9px 20px", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {actionLabel === "Ready for Review" ? <Send size={15} /> : <CircleCheck size={15} />}
            {busy ? "Saving…" : head.button}
          </button>
        </div>
      </div>
    </Modal>
  );
}
