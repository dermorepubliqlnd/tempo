import { useState } from "react";
import { GripVertical, Search, ArrowUp, ArrowDown, EyeOff, Plus } from "lucide-react";

// 2026-10-04 (Sandra): Board cards are a deliberately constrained surface.
// Title is fixed; up to `max` Primary properties (prominent rows under the
// title) and up to `max` Secondary properties (one compact chip line).
// Everything else is Hidden. Drag to reorder within / between sections.
export interface CardLayoutField {
  key: string;
  label: string;
}

interface Props {
  fields: CardLayoutField[];
  primary: string[];
  secondary: string[];
  max: number;
  // Field that can't be placed on the card right now (e.g. the board's
  // grouping field -- the column already shows it).
  excludedKey?: string | null;
  onChange: (primary: string[], secondary: string[]) => void;
}

type Section = "primary" | "secondary" | "hidden";

export default function CardLayoutEditor({ fields, primary, secondary, max, excludedKey, onChange }: Props) {
  const [search, setSearch] = useState("");
  const [drag, setDrag] = useState<{ key: string; from: Section } | null>(null);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const labelOf = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const known = new Set(fields.map((f) => f.key));
  const p = primary.filter((k) => known.has(k));
  const s = secondary.filter((k) => known.has(k) && !p.includes(k));
  const hidden = fields.map((f) => f.key).filter((k) => !p.includes(k) && !s.includes(k));
  const q = search.trim().toLowerCase();

  function place(key: string, to: Section, beforeKey?: string) {
    let np = p.filter((k) => k !== key);
    let ns = s.filter((k) => k !== key);
    const insert = (list: string[]) => {
      const idx = beforeKey ? list.indexOf(beforeKey) : -1;
      const next = [...list];
      next.splice(idx >= 0 ? idx : next.length, 0, key);
      return next;
    };
    if (to === "primary") {
      if (!p.includes(key) && p.length >= max) {
        setLimitMsg(`Primary property limit reached. Board cards support up to ${max} primary properties. Remove one before adding another.`);
        return;
      }
      np = insert(np);
    } else if (to === "secondary") {
      if (!s.includes(key) && s.length >= max) {
        setLimitMsg(`Secondary property limit reached. You can display up to ${max} secondary properties on a board card.`);
        return;
      }
      ns = insert(ns);
    }
    setLimitMsg(null);
    onChange(np, ns);
  }

  function onDrop(to: Section, beforeKey?: string) {
    if (!drag) return;
    place(drag.key, to, beforeKey);
    setDrag(null);
  }

  const btn = (title: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, padding: 0, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", borderRadius: 5 }}
    >
      {icon}
    </button>
  );

  function row(key: string, section: Section) {
    const excluded = key === excludedKey;
    return (
      <div
        key={key}
        draggable={!excluded}
        onDragStart={() => setDrag({ key, from: section })}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.stopPropagation();
          if (section !== "hidden") onDrop(section, key);
          else onDrop("hidden");
        }}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px", borderRadius: 6, fontSize: 12, opacity: drag?.key === key ? 0.4 : excluded ? 0.5 : 1, background: "var(--surface)" }}
        title={excluded ? "Shown by the board's columns already" : undefined}
      >
        <GripVertical size={12} style={{ color: "var(--muted)", cursor: excluded ? "default" : "grab", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(key)}</span>
        {!excluded && section === "primary" && (
          <>
            {btn("Move to secondary", <ArrowDown size={12} />, () => place(key, "secondary"))}
            {btn("Hide", <EyeOff size={12} />, () => place(key, "hidden"))}
          </>
        )}
        {!excluded && section === "secondary" && (
          <>
            {btn("Move to primary", <ArrowUp size={12} />, () => place(key, "primary"))}
            {btn("Hide", <EyeOff size={12} />, () => place(key, "hidden"))}
          </>
        )}
        {!excluded && section === "hidden" && (
          <>
            <button type="button" onClick={() => place(key, "primary")} style={{ fontSize: 10.5, border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 999, padding: "1px 7px", cursor: "pointer", color: "var(--text-secondary)", width: "auto" }}>
              <Plus size={10} /> Primary
            </button>
            <button type="button" onClick={() => place(key, "secondary")} style={{ fontSize: 10.5, border: "1px solid var(--border)", background: "var(--surface)", borderRadius: 999, padding: "1px 7px", cursor: "pointer", color: "var(--text-secondary)", width: "auto" }}>
              <Plus size={10} /> Secondary
            </button>
          </>
        )}
      </div>
    );
  }

  const header = (label: string, count?: number) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.4, margin: "8px 2px 4px" }}>
      <span>{label}</span>
      {count !== undefined && (
        <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: count >= max ? "var(--warning-text, #b45309)" : "var(--muted)" }}>
          {count} of {max} selected
        </span>
      )}
    </div>
  );

  const dropZone = (section: Section, list: string[]) => (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(section)}
      style={{ minHeight: 28, border: "1px dashed var(--border)", borderRadius: 8, padding: 2, display: "grid", gap: 1 }}
    >
      {list.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)", padding: "5px 6px" }}>Drag a property here</div>}
      {list.map((k) => row(k, section))}
    </div>
  );

  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", padding: "0 2px" }}>
        The title is always shown. The board's column (and its colour stripe) already shows the grouped field.
      </div>
      {limitMsg && (
        <div role="alert" style={{ fontSize: 11, color: "var(--warning-text, #b45309)", background: "var(--warning-bg, #fffbeb)", borderRadius: 6, padding: "6px 8px", marginTop: 6 }}>
          {limitMsg}
        </div>
      )}
      {header("Primary properties", p.length)}
      {dropZone("primary", p)}
      {header("Secondary properties", s.length)}
      {dropZone("secondary", s)}
      {header("Hidden properties")}
      <div style={{ position: "relative", marginBottom: 4 }}>
        <Search size={12} style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
        <input
          placeholder="Search properties..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          style={{ width: "100%", fontSize: 12, padding: "5px 8px 5px 24px", border: "1px solid var(--border)", borderRadius: 6, fontFamily: "inherit" }}
        />
      </div>
      <div onDragOver={(e) => e.preventDefault()} onDrop={() => onDrop("hidden")} style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 1 }}>
        {hidden.filter((k) => !q || labelOf(k).toLowerCase().includes(q)).map((k) => row(k, "hidden"))}
      </div>
    </div>
  );
}
