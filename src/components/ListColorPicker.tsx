import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabaseClient";
import { CATEGORY_TONE_NAMES, CATEGORY_TONE_ICON_COLOR } from "../lib/categoryIcons";

// 2026-09-29 (phase124, Sandra: "no option to choose colors ... apply to
// all list options that has color coding") -- one reusable color picker
// for every Site Settings list whose options show as a pill on the
// Projects / Tasks lists (Project Types, Planning Types, Phases, Sources,
// Task Types, Output Types). Saves straight to <table>.color, then calls
// onSaved so the drawer reloads. Same palette as Project Categories.
// Popover is portaled to <body> so it never gets clipped by the drawer's
// or the Task Type matrix's scroll containers.
export default function ListColorPicker({
  table,
  id,
  name,
  color,
  onSaved,
}: {
  table: string;
  id: string;
  name: string;
  color: string | null | undefined;
  onSaved: () => void;
}) {
  const tone = color || "neutral";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 230;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  }, [open]);

  async function pick(next: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from(table).update({ color: next }).eq("id", id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setOpen(false);
    onSaved();
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change pill color"
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: "1px solid var(--border)",
          background: CATEGORY_TONE_ICON_COLOR[tone] ?? CATEGORY_TONE_ICON_COLOR.neutral,
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
      />
      {open &&
        createPortal(
          <>
            <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
            <div
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                zIndex: 1000,
                width: 230,
                background: "var(--surface, #fff)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
                padding: 10,
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>
                Pill color
              </div>
              <div style={{ marginBottom: 8 }}>
                <span className={`status-pill ${tone}`}>{name}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {CATEGORY_TONE_NAMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => pick(t)}
                    disabled={busy}
                    title={t}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: tone === t ? "2px solid var(--navy)" : "1px solid var(--border)",
                      background: CATEGORY_TONE_ICON_COLOR[t],
                      cursor: busy ? "default" : "pointer",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
              {error && <div style={{ color: "var(--danger-text)", fontSize: 11, marginTop: 8 }}>{error}</div>}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
