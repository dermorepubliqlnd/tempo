import { useEffect, useState } from "react";

// Shared "Cancel task" reason dialog -- reused by the Tasks page (single
// row + bulk edit) and WBS Planning so cancelling a task always goes
// through the same UI, rather than three independently-built ones. Modeled
// directly on WbsPlanning.tsx's "Reject Start Project Request" dialog
// (predefined reasons via Site Settings' task_cancellation_reasons list,
// optional note that becomes REQUIRED the moment "Other" is picked) --
// same convention as that dialog and as baseline_decline_reasons before it.
// The single final string (the picked reason's name, or the typed note
// when "Other" is picked) is what gets written to tasks.cancellation_reason.
export interface CancelTaskDialogProps {
  open: boolean;
  taskLabel: string; // e.g. a task name, or "3 tasks" for a bulk action
  reasons: string[];
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function CancelTaskDialog({ open, taskLabel, reasons, busy, onClose, onConfirm }: CancelTaskDialogProps) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
    }
  }, [open]);

  if (!open) return null;

  const isOther = reason === "Other";
  const finalReason = isOther ? note.trim() : reason;
  const canConfirm = Boolean(finalReason) && !busy;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,41,66,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: "var(--radius-md)", boxShadow: "0 12px 32px rgba(15,41,66,0.24)", padding: 20, width: 380, maxWidth: "calc(100vw - 32px)" }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--navy)", marginBottom: 4 }}>Cancel {taskLabel}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 14 }}>
          Cancelling keeps the task and its logged hours -- it just stops counting toward scheduling, Output Count, and the Active/donut breakdowns. A
          reason is required. This can be undone later (Uncancel restores it to In Progress).
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Reason</div>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: "100%", padding: "7px 8px", fontSize: 12.5, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)" }}
          >
            <option value="">Select a reason...</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {isOther && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>Note (required)</div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Why is this task being cancelled?"
              style={{ width: "100%", padding: "7px 8px", fontSize: 12.5, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: isOther ? 0 : 16 }}>
          <button
            onClick={onClose}
            style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 12px", cursor: "pointer" }}
          >
            Back
          </button>
          <button
            onClick={() => canConfirm && onConfirm(finalReason)}
            disabled={!canConfirm}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              background: "var(--danger-text)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              padding: "6px 12px",
              cursor: canConfirm ? "pointer" : "default",
              opacity: canConfirm ? 1 : 0.6,
            }}
          >
            Cancel task
          </button>
        </div>
      </div>
    </div>
  );
}
