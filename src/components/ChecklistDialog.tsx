// 2026-10-08 (Sandra, item F): one dialog that lists every Start Project
// problem at once (grouped), instead of one pop-up per rule. Promise-based
// like useConfirm: `await showChecklist({...})` resolves to what the person
// chose.
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, XCircle } from "lucide-react";
import { checklistBlocks, type ChecklistGroup } from "../lib/startProjectChecklist";

export type ChecklistChoice = "proceed" | "cancel" | "review";

export interface ChecklistOptions {
  title: string;
  message: string;
  groups: ChecklistGroup[];
  /** Overridable groups don't block this person (Full Access on request, approver on approval). */
  canOverride: boolean;
  /** Button that goes ahead when nothing blocks, e.g. "Start anyway". */
  proceedLabel: string;
  /** Cancel button when the only problems are warnings / overridable ones. */
  cancelLabel?: string;
  /** Shows a "Review plan in WBS" button (Approval Center). */
  reviewLabel?: string;
}

const MAX_ITEMS = 8;

export function useChecklistDialog() {
  const [pending, setPending] = useState<(ChecklistOptions & { resolve: (c: ChecklistChoice) => void }) | null>(null);
  const showChecklist = useCallback(
    (opts: ChecklistOptions) => new Promise<ChecklistChoice>((resolve) => setPending({ ...opts, resolve })),
    []
  );
  function respond(c: ChecklistChoice) {
    pending?.resolve(c);
    setPending(null);
  }
  const dialog = pending ? <ChecklistDialog {...pending} onChoose={respond} /> : null;
  return { showChecklist, dialog };
}

function ChecklistDialog({ title, message, groups, canOverride, proceedLabel, cancelLabel, reviewLabel, onChoose }: ChecklistOptions & { onChoose: (c: ChecklistChoice) => void }) {
  const blocked = checklistBlocks(groups, canOverride);
  const onlyPastDates = !blocked && groups.every((g) => g.key === "past_dates");
  const btn = { fontSize: 12, borderRadius: "var(--radius-sm)", padding: "6px 12px", cursor: "pointer" } as const;
  const secondary = { ...btn, fontWeight: 500, color: "var(--text-secondary)", background: "var(--bg)", border: "1px solid var(--border)" };
  const primary = { ...btn, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none" };
  return createPortal(
    <div onClick={() => onChoose("cancel")} style={{ position: "fixed", inset: 0, background: "rgba(15,41,66,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--surface)", borderRadius: "var(--radius-md)", boxShadow: "0 12px 32px rgba(15,41,66,0.24)", padding: 20, width: 460, maxWidth: "calc(100vw - 32px)", maxHeight: "85vh", overflowY: "auto" }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--navy)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 10 }}>{message}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {groups.map((g) => {
            const stops = g.blocking && !(g.overridable && canOverride);
            const color = stops ? "var(--danger-text)" : "var(--warning-text, #9a6700)";
            const shown = g.items.slice(0, MAX_ITEMS);
            const more = g.items.length - shown.length;
            return (
              <div key={g.key} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--navy)" }}>
                  {stops ? <XCircle size={14} style={{ color, flexShrink: 0 }} /> : <AlertTriangle size={14} style={{ color, flexShrink: 0 }} />}
                  <span>{g.label}{g.items.length ? ` (${g.items.length})` : ""}</span>
                  {g.blocking && g.overridable && canOverride && (
                    <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color }}>You can override</span>
                  )}
                </div>
                {g.hint && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{g.hint}</div>}
                {shown.length > 0 && (
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {shown.map((it, i) => <li key={i}>{it}</li>)}
                    {more > 0 && <li style={{ listStyle: "none", marginLeft: -18, color: "var(--muted)" }}>and {more} more</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {reviewLabel && (
            <button onClick={() => onChoose("review")} style={blocked ? primary : secondary}>
              {reviewLabel}
            </button>
          )}
          {blocked ? (
            <button onClick={() => onChoose("cancel")} style={reviewLabel ? secondary : primary}>
              Close
            </button>
          ) : (
            <>
              <button onClick={() => onChoose("cancel")} style={secondary}>
                {cancelLabel ?? (onlyPastDates ? "Re-plan dates" : "Keep editing")}
              </button>
              <button onClick={() => onChoose("proceed")} style={primary}>
                {proceedLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
