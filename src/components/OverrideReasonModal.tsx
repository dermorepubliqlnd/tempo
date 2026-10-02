// phase130: required reason before deciding an item routed to someone else.
import { useState } from "react";
import Modal from "./Modal";

export default function OverrideReasonModal({
  itemLabel,
  approverName,
  onCancel,
  onConfirm,
}: {
  itemLabel: string;
  approverName: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length > 0;
  return (
    <Modal title="Override approval" onClose={onCancel} width={440}>
      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 0 }}>
        <strong style={{ color: "var(--navy)" }}>{itemLabel}</strong> is routed to{" "}
        <strong style={{ color: "var(--navy)" }}>{approverName ?? "another approver"}</strong>. Deciding it yourself is logged as an override.
      </p>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--navy)", marginBottom: 4 }}>
        Reason for override <span style={{ color: "var(--danger, #c0392b)" }}>*</span>
      </label>
      <textarea
        autoFocus
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        placeholder="e.g. Joseph is out and this is blocking payroll cut-off"
        style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", resize: "vertical" }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onCancel} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)" }}>
          Cancel
        </button>
        <button
          disabled={!ok}
          onClick={() => onConfirm(reason.trim())}
          style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", opacity: ok ? 1 : 0.5, cursor: ok ? "pointer" : "not-allowed" }}
        >
          Continue to decide
        </button>
      </div>
    </Modal>
  );
}
