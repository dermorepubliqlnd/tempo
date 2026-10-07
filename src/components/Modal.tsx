import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  /** When true, no X button and no close on backdrop click: the person must use a button inside. */
  requireChoice?: boolean;
}

// 2026-10-02 (Sandra: timer confirm "broken" behind the Projects table) --
// rendered through a portal on <body>, so a modal opened from inside a
// stacking context (e.g. the sticky sidebar's timer) can't be painted over
// by sticky table cells/headers elsewhere on the page.
export default function Modal({ title, onClose, children, width = 480, requireChoice = false }: ModalProps) {
  return createPortal(
    <div
      onClick={requireChoice ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,41,66,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width, maxHeight: "85vh", overflowY: "auto", background: "var(--surface)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 14, color: "var(--navy)" }}>{title}</h2>
          {!requireChoice && (
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}>
              <X size={16} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  , document.body);
}
