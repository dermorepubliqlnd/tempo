// phase122 (2026-09-25, Sandra): Task completion validation confirm step.
// Three separate dates instead of a paragraph:
//   Target due date           -- current_due_date (includes approved extensions)
//   Reported completion date  -- actual_completion_date (assignee; never changed here)
//   Confirmed completion date -- what the approver signs off (validated_completion_date)
// Schedule variance = Target vs Confirmed. When Confirmed <> Reported (earlier
// OR later) a Reason for adjustment is required -- validate_task_completion
// enforces the same rule server-side.
import { useState, type ReactNode } from "react";
import { X, Calendar, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { calendarDaysBetween, parseLocalDate } from "../lib/taskTiming";

const MAX_REASON = 500;

export function longDate(value: string | null | undefined): string {
  if (!value) return "Not reported";
  const d = parseLocalDate(value.slice(0, 10));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function todayISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

const rowLabel = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" } as const;
const rowValue = { fontSize: 12.5, fontWeight: 600, color: "var(--navy)" } as const;

// Hoisted (not defined inside the modal) so the editable date input
// doesn't remount -- and lose focus -- on every render.
function DateRow({ label, children, highlight }: { label: string; children: ReactNode; highlight?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 12, padding: "7px 0" }}>
      <span style={rowLabel}><Calendar size={14} style={{ color: "var(--muted)", flexShrink: 0 }} />{label}</span>
      <span style={{ ...rowValue, color: highlight ? "var(--warning-text)" : rowValue.color }}>{children}</span>
    </div>
  );
}

export interface ValidateCompletionModalProps {
  taskName: string;
  taskId?: string | null;          // e.g. "T-0123"
  targetDueDate: string | null;
  reportedDate: string | null;
  confirmedDate: string;           // yyyy-mm-dd, chosen before opening
  // Only when the caller has no date picker of its own (Projects table
  // Validate button) -- otherwise the confirmed date is read-only here.
  onChangeConfirmed?: (d: string) => void;
  minDate?: string | null;         // task start date
  busy?: boolean;
  onCancel: () => void;
  onValidate: (reason: string | null) => void;
}

export default function ValidateCompletionModal({
  taskName, taskId, targetDueDate, reportedDate, confirmedDate, onChangeConfirmed, minDate, busy, onCancel, onValidate,
}: ValidateCompletionModalProps) {
  const [reason, setReason] = useState("");
  const reported = reportedDate ? reportedDate.slice(0, 10) : null;
  const confirmed = confirmedDate.slice(0, 10);
  const adjusted = Boolean(reported && confirmed && reported !== confirmed);
  const needsReason = adjusted && reason.trim().length === 0;

  const days = targetDueDate && confirmed
    ? calendarDaysBetween(parseLocalDate(confirmed), parseLocalDate(targetDueDate.slice(0, 10)))
    : null;
  const status =
    days === null ? null
    : days === 0 ? { tone: "success", icon: <CheckCircle2 size={18} />, title: "Completed on time", sub: "No schedule variance." }
    : days > 0 ? { tone: "danger", icon: <Clock size={18} />, title: `${days} day${days === 1 ? "" : "s"} late`, sub: `The confirmed completion date is ${days} day${days === 1 ? "" : "s"} after the target due date.` }
    : { tone: "success", icon: <CheckCircle2 size={18} />, title: `${-days} day${days === -1 ? "" : "s"} early`, sub: `The confirmed completion date is ${-days} day${days === -1 ? "" : "s"} before the target due date.` };

  return (
    <div
      onClick={busy ? undefined : onCancel}
      style={{ position: "fixed", inset: 0, background: "rgba(15,41,66,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Validate task completion"
        style={{ background: "var(--surface)", borderRadius: "var(--radius-md)", boxShadow: "0 12px 32px rgba(15,41,66,0.24)", padding: 20, width: 420, maxWidth: "calc(100vw - 32px)", maxHeight: "90vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)" }}>Validate task completion</div>
          <button onClick={onCancel} disabled={busy} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0 }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>Task{taskId ? ` · ${taskId}` : ""}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--navy)", marginBottom: 12 }}>{taskName}</div>

        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--bg)", padding: "4px 12px", marginBottom: 10 }}>
          <DateRow label="Target due date">{targetDueDate ? longDate(targetDueDate) : "—"}</DateRow>
          <DateRow label="Reported completion date">{longDate(reported)}</DateRow>
          <DateRow label="Confirmed completion date" highlight={adjusted}>
            {onChangeConfirmed ? (
              <input
                type="date"
                value={confirmed}
                max={todayISO()}
                min={minDate ? minDate.slice(0, 10) : undefined}
                onChange={(e) => e.target.value && onChangeConfirmed(e.target.value)}
                style={{ fontSize: 12, padding: "4px 6px", border: `1px solid ${adjusted ? "var(--warning-text)" : "var(--border)"}`, borderRadius: "var(--radius-sm)", color: "var(--navy)", fontWeight: 600 }}
              />
            ) : (
              longDate(confirmed)
            )}
          </DateRow>
        </div>

        {status && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", borderRadius: "var(--radius)", background: `var(--${status.tone}-bg)`, marginBottom: 8 }}>
            <span style={{ color: `var(--${status.tone}-text)`, display: "flex", flexShrink: 0, marginTop: 1 }}>{status.icon}</span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: `var(--${status.tone}-text)` }}>{status.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{status.sub}</div>
            </div>
          </div>
        )}

        {adjusted && (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "9px 12px", borderRadius: "var(--radius)", background: "var(--warning-bg)", marginBottom: 10 }}>
              <AlertTriangle size={16} style={{ color: "var(--warning-text)", flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--warning-text)" }}>Confirmed date differs from the reported date</div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>A justification is required since you are not accepting the assignee's reported date.</div>
              </div>
            </div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--navy)", marginBottom: 4 }}>
              Reason for adjustment <span style={{ color: "var(--danger-text)" }}>*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
              placeholder="Explain why the reported completion date is not being accepted as the confirmed completion date."
              rows={3}
              autoFocus
              style={{ width: "100%", boxSizing: "border-box", fontSize: 12, fontFamily: "inherit", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", resize: "vertical", color: "var(--text)" }}
            />
            <div style={{ textAlign: "right", fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>{reason.length}/{MAX_REASON}</div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 12px", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={() => onValidate(adjusted ? reason.trim() : null)}
            disabled={busy || needsReason || !confirmed}
            title={needsReason ? "Enter a reason for adjustment first" : undefined}
            style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "6px 14px", cursor: busy || needsReason ? "not-allowed" : "pointer", opacity: busy || needsReason ? 0.5 : 1 }}
          >
            {busy ? "Validating…" : "Validate"}
          </button>
        </div>
      </div>
    </div>
  );
}
