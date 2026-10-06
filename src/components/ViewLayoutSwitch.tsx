import { Calendar, GanttChart, Kanban, Table2 } from "lucide-react";
import type { ViewType } from "../lib/tableTypes";

// phase157 (2026-10-06, Sandra -- View Management): switch the CURRENT view's
// layout in place. On a Personal View this updates the same view (no new
// view is created); on a System View it is a temporary change.
const OPTIONS: { type: ViewType; label: string; Icon: typeof Table2 }[] = [
  { type: "table", label: "Table", Icon: Table2 },
  { type: "board", label: "Board", Icon: Kanban },
  { type: "timeline", label: "Timeline", Icon: GanttChart },
  { type: "calendar", label: "Calendar", Icon: Calendar },
];

export function ViewLayoutSwitch({ value, onChange }: { value: ViewType; onChange: (t: ViewType) => void }) {
  return (
    <div role="group" aria-label="Layout" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
      {OPTIONS.map(({ type, label, Icon }) => {
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            title={`Show this view as ${label}`}
            aria-pressed={active}
            onClick={() => !active && onChange(type)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 28,
              border: "none",
              borderLeft: type === "table" ? "none" : "1px solid var(--border)",
              background: active ? "var(--accent-soft, #e8f1fe)" : "transparent",
              color: active ? "var(--accent)" : "var(--muted)",
              cursor: active ? "default" : "pointer",
            }}
          >
            <Icon size={14} style={{ flexShrink: 0 }} />
          </button>
        );
      })}
    </div>
  );
}

export function ViewModifiedBar({ viewName, onSave, onDiscard }: { viewName: string; onSave: () => void; onDiscard: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "7px 14px",
        background: "var(--warning-bg)",
        borderTop: "1px solid var(--border)",
        fontSize: 11.5,
        color: "var(--warning-text)",
      }}
    >
      <span>
        <strong>{viewName}</strong> is a System View — your changes are temporary and won't be kept.
      </span>
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
        <button type="button" className="btn-secondary" onClick={onDiscard} style={{ fontSize: 11.5, padding: "4px 10px" }}>
          Discard Changes
        </button>
        <button type="button" className="btn-primary" onClick={onSave} style={{ fontSize: 11.5, padding: "4px 10px" }}>
          Save as Personal View
        </button>
      </span>
    </div>
  );
}
