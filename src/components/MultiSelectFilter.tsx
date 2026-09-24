import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search, X } from "lucide-react";

// 2026-09-24 (Sandra): generic searchable multi-select filter used by Time
// Tracking, Approval Center, Utilization and Productivity. `selected` is a
// list of ids; an EMPTY list means "no filter" (everything shows).
export interface MultiSelectOption {
  id: string;
  name: string;
}

interface Props {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** plural noun, e.g. "projects" -> "All projects" / "3 projects" */
  noun: string;
  /** singular label prefix for a single selection, e.g. "Project" */
  singular: string;
  width?: number;
}

export default function MultiSelectFilter({ options, selected, onChange, noun, singular, width = 260 }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selSet = new Set(selected);
  const active = selected.length > 0;
  const label = !active
    ? `All ${noun}`
    : selected.length === 1
      ? `${singular}: ${options.find((o) => o.id === selected[0])?.name ?? "1 selected"}`
      : `${selected.length} ${noun}`;
  const filtered = options.filter((o) => o.name.toLowerCase().includes(search.trim().toLowerCase()));

  function toggle(id: string) {
    onChange(selSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const rect = btnRef.current?.getBoundingClientRect();
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 12,
          padding: "6px 10px",
          borderRadius: "var(--radius-sm)",
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          background: active ? "#eaf1fb" : "var(--surface)",
          color: active ? "var(--accent)" : "var(--navy)",
          fontWeight: active ? 600 : 400,
          cursor: "pointer",
          maxWidth: 260,
          whiteSpace: "nowrap",
        }}
        title={active ? options.filter((o) => selSet.has(o.id)).map((o) => o.name).join(", ") : `Filter by ${singular.toLowerCase()}`}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {active ? (
          <X
            size={12}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
          />
        ) : (
          <ChevronDown size={12} />
        )}
      </button>
      {open &&
        createPortal(
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setOpen(false)} />
            <div
              className="card"
              style={{
                position: "absolute",
                top: (rect?.bottom ?? 0) + window.scrollY + 4,
                left: Math.min(rect?.left ?? 0, window.innerWidth - width - 12),
                width,
                maxHeight: 340,
                display: "flex",
                flexDirection: "column",
                zIndex: 201,
                padding: 8,
                boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <Search size={13} style={{ color: "var(--muted)", flexShrink: 0 }} />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${noun}...`}
                  style={{ flex: 1, fontSize: 12, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 6px" }}
                />
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 6, fontSize: 11 }}>
                <button type="button" onClick={() => onChange([])} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontWeight: 600 }}>
                  Clear (show all)
                </button>
                {search && filtered.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange(Array.from(new Set([...selected, ...filtered.map((o) => o.id)])))}
                    style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontWeight: 600 }}
                  >
                    Select matches
                  </button>
                )}
              </div>
              <div style={{ overflowY: "auto" }}>
                {filtered.length === 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", padding: "6px 2px" }}>No matches.</div>}
                {filtered.map((o) => (
                  <label key={o.id} className="row-menu-item" style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 4px", fontSize: 12, cursor: "pointer", borderRadius: 4 }}>
                    <input type="checkbox" checked={selSet.has(o.id)} onChange={() => toggle(o.id)} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </>,
          document.body
        )}
    </span>
  );
}
