import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { OptionGroup } from "../lib/notionOptions";
import { formatDate } from "../lib/formatDate";

interface BaseProps {
  editable: boolean;
  emptyLabel?: string;
}

interface InlineTextProps extends BaseProps {
  value: string;
  onCommit: (value: string) => void;
  bold?: boolean;
  onEnter?: () => void;
  dataNavId?: string;
}

export function InlineText({ value, onCommit, editable, bold, onEnter, dataNavId, emptyLabel = "—" }: InlineTextProps) {
  const [draft, setDraft] = useState(value);
  if (!editable) return <span style={bold ? { fontWeight: 600, color: "var(--navy)" } : undefined}>{value || emptyLabel}</span>;
  return (
    <input
      className="inline-cell"
      data-wbs-nav-id={dataNavId}
      spellCheck={false}
      autoComplete="off"
      style={bold ? { fontWeight: 600, color: "var(--navy)" } : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(value)}
      onBlur={() => {
        if (draft !== value && draft.trim()) onCommit(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          if (onEnter) window.setTimeout(onEnter, 0);
        }
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface InlineSelectProps extends BaseProps {
  value: string;
  onCommit: (value: string) => void;
  options: string[] | OptionGroup[];
  allowEmpty?: boolean;
  renderReadOnly?: (value: string) => React.ReactNode;
  alwaysSelect?: boolean;
  searchable?: boolean;
  // Optional display-text mapper for each <option> in the edit dropdown
  // (e.g. Priority prefixing "Low" -> "↓ Low") -- the underlying stored
  // value/onCommit argument is always the raw option string, only the
  // visible label changes.
  labelFor?: (value: string) => string;
}

function isGrouped(options: string[] | OptionGroup[]): options is OptionGroup[] {
  return options.length > 0 && typeof options[0] !== "string";
}

export function InlineSelect({ value, onCommit, options, editable, allowEmpty, emptyLabel = "—", renderReadOnly, alwaysSelect = false, searchable = false, labelFor }: InlineSelectProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [searchDraft, setSearchDraft] = useState(value);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    setSearchDraft(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && selectRef.current) {
      selectRef.current.focus();
      // Progressive enhancement: open the native picker immediately on click
      // (Chrome 121+/similar). Falls back silently to a focused, unopened
      // select on browsers without showPicker() for <select>.
      const el = selectRef.current as HTMLSelectElement & { showPicker?: () => void };
      try {
        el.showPicker?.();
      } catch {
        // ignore — requires a user gesture in some browsers, focus is enough
      }
    }
  }, [isEditing]);

  if (!editable) return <>{renderReadOnly ? renderReadOnly(value) : value || emptyLabel}</>;

  if (!alwaysSelect && !isEditing) {
    return (
      <span className="inline-select-trigger" onClick={() => setIsEditing(true)}>
        {renderReadOnly ? renderReadOnly(value) : value || emptyLabel}
      </span>
    );
  }

  const grouped = isGrouped(options);
  const flatOptions = grouped ? (options as OptionGroup[]).flatMap((g) => g.options) : (options as string[]);

  if (searchable) {
    const query = searchDraft.trim().toLowerCase();
    const filteredOptions = flatOptions.filter((o) => !query || o.toLowerCase().includes(query));
    const visibleOptions = filteredOptions.slice(0, 80);
    const rect = searchRef.current?.getBoundingClientRect();
    const selectSearchOption = (next: string) => {
      setSearchDraft(next);
      setSearchOpen(false);
      setActiveIndex(0);
      if (next !== value) onCommit(next);
    };

    return (
      <div style={{ position: "relative", width: "100%", minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            minWidth: 0,
            borderRadius: 5,
          }}
        >
          <input
            ref={searchRef}
            className="inline-cell"
            value={searchDraft}
            placeholder={emptyLabel}
            autoComplete="off"
            role="combobox"
            aria-expanded={searchOpen}
            aria-autocomplete="list"
            onFocus={(e) => {
              setSearchDraft(value);
              setSearchOpen(true);
              setActiveIndex(0);
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setSearchDraft(e.target.value);
              setSearchOpen(true);
              setActiveIndex(0);
            }}
            onBlur={() => {
              window.setTimeout(() => {
                setSearchOpen(false);
                if (searchDraft === "" && allowEmpty) {
                  if (value !== "") onCommit("");
                  return;
                }
                const exact = flatOptions.find((o) => o.toLowerCase() === searchDraft.trim().toLowerCase());
                if (exact) {
                  if (exact !== value) onCommit(exact);
                  setSearchDraft(exact);
                } else {
                  setSearchDraft(value);
                }
              }, 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSearchOpen(true);
                setActiveIndex((i) => Math.min(i + 1, Math.max(visibleOptions.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Escape") {
                e.preventDefault();
                setSearchDraft(value);
                setSearchOpen(false);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const exact = flatOptions.find((o) => o.toLowerCase() === searchDraft.trim().toLowerCase());
                const selected = exact ?? visibleOptions[activeIndex];
                if (selected) selectSearchOption(selected);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSearchOpen(true);
            }}
            style={{ width: "100%", minWidth: 0 }}
          />
        </div>
        {searchOpen &&
          rect &&
          createPortal(
            <div
              role="listbox"
              style={{
                position: "fixed",
                left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8),
                top: Math.min(rect.bottom + 4, window.innerHeight - 280),
                width: Math.max(rect.width, 220),
                maxWidth: 320,
                maxHeight: 260,
                overflowY: "auto",
                zIndex: 1600,
                padding: 4,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 8px 24px rgba(15,41,66,.16)",
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {allowEmpty && !query && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchDraft("");
                    setSearchOpen(false);
                    if (value !== "") onCommit("");
                  }}
                  style={{
                    display: "flex",
                    width: "100%",
                    padding: "7px 9px",
                    border: "none",
                    borderRadius: 5,
                    background: !value ? "#eef6ff" : "transparent",
                    color: "var(--muted)",
                    fontSize: 12,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {emptyLabel}
                </button>
              )}
              {visibleOptions.length === 0 ? (
                <div style={{ padding: "8px 9px", fontSize: 11.5, color: "var(--muted)" }}>No matching options</div>
              ) : (
                visibleOptions.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    role="option"
                    aria-selected={o === value}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSearchOption(o);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      width: "100%",
                      padding: "7px 9px",
                      border: "none",
                      borderRadius: 5,
                      background: i === activeIndex ? "#eef6ff" : o === value ? "#f5f9ff" : "transparent",
                      color: "var(--text)",
                      fontSize: 12,
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {labelFor ? labelFor(o) : o}
                    </span>
                    {o === value && <span style={{ color: "var(--accent)", fontWeight: 800 }}>✓</span>}
                  </button>
                ))
              )}
            </div>,
            document.body
          )}
      </div>
    );
  }

  return (
    <select
      ref={alwaysSelect ? undefined : selectRef}
      className="inline-cell"
      value={value}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => {
        onCommit(e.target.value);
        if (!alwaysSelect) setIsEditing(false);
      }}
      onBlur={() => {
        if (!alwaysSelect) setIsEditing(false);
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {grouped
        ? (options as OptionGroup[]).map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o} value={o}>
                  {labelFor ? labelFor(o) : o}
                </option>
              ))}
            </optgroup>
          ))
        : (options as string[]).map((o) => (
            <option key={o} value={o}>
              {labelFor ? labelFor(o) : o}
            </option>
          ))}
    </select>
  );
}

interface InlineDateProps extends BaseProps {
  value: string | null;
  onCommit: (value: string) => void;
}

export function InlineDate({ value, onCommit, editable, emptyLabel = "—" }: InlineDateProps) {
  // Same box (padding + transparent 1px border) as the editable <input>
  // below, via the shared .inline-cell.readonly class -- otherwise the
  // read-only rendering (a locked parent task's computed date, or a
  // Locked project's frozen due date) sits flush against the cell edge
  // while an editable sibling row's <input> sits ~5px further in, and the
  // whole column visibly zig-zags between rows (Sandra, 2026-07-23:
  // sub-task dates "kind of not good in the eye to see them misaligned"
  // next to their locked parent row).
  if (!editable) return <span className="inline-cell readonly">{formatDate(value, emptyLabel)}</span>;
  return (
    <input
      className="inline-cell"
      type="date"
      value={value ?? ""}
      onChange={(e) => onCommit(e.target.value)}
      onClick={(e) => {
        // Root-cause fix for the native calendar icon overlapping the cell
        // border in narrow WBS date columns (Sandra, 2026-08-25): a native
        // <input type="date"> has a fixed browser-enforced minimum
        // intrinsic width (~150px in Chrome) that CSS width:auto can't
        // shrink below, so in a narrow column the icon renders past the
        // cell's edge. Rather than fight that, the icon itself is hidden
        // via CSS (see .inline-cell[type="date"]::-webkit-calendar-picker-
        // indicator) and clicking anywhere on the input opens the native
        // picker directly instead, same pattern as InlineSelect's
        // showPicker() progressive enhancement above.
        e.stopPropagation();
        const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
        try {
          el.showPicker?.();
        } catch {
          // ignore -- requires a user gesture in some browsers, focus is enough
        }
      }}
    />
  );
}

interface InlineNumberProps extends BaseProps {
  value: number | null;
  onCommit: (value: number | null) => void;
  step?: number;
}

export function InlineNumber({ value, onCommit, editable, step = 0.5, emptyLabel = "—" }: InlineNumberProps) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  // Same alignment fix as InlineDate above -- a locked parent task's
  // computed Est. hrs rollup needs to sit in the exact same box as its
  // freely-editable sub-tasks' own <input> cells in the same column.
  if (!editable) return <span className="inline-cell readonly">{value ?? emptyLabel}</span>;
  return (
    <input
      className="inline-cell"
      type="number"
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(value === null ? "" : String(value))}
      onBlur={() => {
        const num = draft === "" ? null : Number(draft);
        if (num !== value) onCommit(num);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

interface InlineTextAreaProps extends BaseProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
}

// Added 2026-09-07 (Sandra: "add project description in the WBS...
// required before starting a project or locking baseline") -- same
// commit-on-blur pattern as InlineText above (won't commit an
// empty/whitespace-only draft, so the field can't be blanked out once
// set -- matches the existing convention rather than introducing a new
// clearable-field behavior), just a multi-line <textarea> instead of a
// single-line <input> since a project description needs more room.
export function InlineTextArea({ value, onCommit, editable, emptyLabel = "—", placeholder }: InlineTextAreaProps) {
  const [draft, setDraft] = useState(value);
  if (!editable) return <span style={{ whiteSpace: "pre-wrap" }}>{value || emptyLabel}</span>;
  return (
    <textarea
      className="inline-cell"
      spellCheck={false}
      rows={2}
      placeholder={placeholder}
      style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(value)}
      onBlur={() => {
        if (draft !== value && draft.trim()) onCommit(draft.trim());
        else setDraft(value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
