import type { ReactNode } from "react";
import { X } from "lucide-react";

// 2026-10-23 (Sandra's mock-ups): shared header and summary band for the
// hand-off dialogs (Submit for Review / Pass QA / Approve / Request Revision).
export function DialogHeader({ icon, title, subtitle, onClose }: { icon: ReactNode; title: string; subtitle?: ReactNode; onClose?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
      <span aria-hidden="true" style={{ flexShrink: 0, width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--accent-soft, #e8f1fc)", color: "var(--accent)" }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        <h2 style={{ margin: 0, fontSize: 20, lineHeight: 1.2, color: "var(--navy)", fontFamily: "var(--font-heading)" }}>{title}</h2>
        {subtitle && <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>{subtitle}</div>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2, width: "auto" }}>
          <X size={18} />
        </button>
      )}
    </div>
  );
}

export function SummaryBand({ items }: { items: { label: string; value: ReactNode; hint?: ReactNode }[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, background: "var(--surface-2, #f4f6f9)", borderRadius: 10, padding: "12px 4px" }}>
      {items.map((it, i) => (
        <div key={it.label} style={{ padding: "2px 14px", borderLeft: i ? "1px solid var(--border)" : "none", minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{it.label}</div>
          <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>{it.value}</div>
          {it.hint && <div style={{ marginTop: 3, fontSize: 11, color: "var(--muted)" }}>{it.hint}</div>}
        </div>
      ))}
    </div>
  );
}
