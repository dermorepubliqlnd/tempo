import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Search, RotateCcw, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { restoreItem, ARCHIVE_KIND_LABEL, ARCHIVE_RETENTION_DAYS, type ArchiveKind } from "../lib/archive";

// 2026-09-23 (phase104, Sandra: "create a separate archive page... like a
// recycle bin. Core rule -- no hard deletes in the app, always route to
// archive"). Everyone can SEE everything here; only the person who
// archived an item or Full Access can RESTORE it. Items are purged
// automatically 90 days after archiving (pg_cron, server-side). A project
// or parent task shows as ONE row -- its bundled tasks/time entries come
// back together when it's restored.

interface ArchiveRow {
  kind: ArchiveKind;
  id: string;
  label: string;
  ref: string | null;
  context: string | null;
  archived_at: string;
  archived_by: string | null;
  archived_by_name: string | null;
  archive_reason: string | null;
  archive_batch_id: string;
  purge_at: string;
  bundled_tasks: number;
  bundled_time_entries: number;
  bundled_kb_entries: number;
}

type TypeFilter = "all" | "project" | "task" | "time_entry" | "kb" | "holiday" | "settings";

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "project", label: "Projects" },
  { key: "task", label: "Tasks" },
  { key: "time_entry", label: "Time Entries" },
  { key: "kb", label: "Knowledge Base" },
  { key: "holiday", label: "Holidays" },
  { key: "settings", label: "Settings" },
];

function filterGroup(kind: ArchiveKind): TypeFilter {
  if (kind === "project" || kind === "task" || kind === "time_entry" || kind === "holiday") return kind;
  if (kind === "kb_category" || kind === "kb_entry") return "kb";
  return "settings";
}

const KIND_TONE: Record<TypeFilter, string> = {
  all: "neutral",
  project: "purple",
  task: "accent",
  time_entry: "mint",
  kb: "gold",
  holiday: "skyblue",
  settings: "slate",
};

function formatDateTime(v: string): string {
  const d = new Date(v);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function bundleText(r: ArchiveRow): string | null {
  const parts: string[] = [];
  if (r.bundled_tasks > 0) parts.push(`${r.bundled_tasks} task${r.bundled_tasks === 1 ? "" : "s"}`);
  if (r.bundled_time_entries > 0) parts.push(`${r.bundled_time_entries} time entr${r.bundled_time_entries === 1 ? "y" : "ies"}`);
  if (r.bundled_kb_entries > 0) parts.push(`${r.bundled_kb_entries} entr${r.bundled_kb_entries === 1 ? "y" : "ies"}`);
  return parts.length ? parts.join(", ") : null;
}

export default function Archive() {
  const { person: me } = useSession();
  const { confirm, alert, dialog } = useConfirm();
  const [rows, setRows] = useState<ArchiveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");
  const [restoringKey, setRestoringKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("archive_items").select("*").order("archived_at", { ascending: false });
    if (error) await alert(`Couldn't load the Archive: ${error.message}`);
    setRows((data as ArchiveRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c: Record<TypeFilter, number> = { all: rows.length, project: 0, task: 0, time_entry: 0, kb: 0, holiday: 0, settings: 0 };
    rows.forEach((r) => (c[filterGroup(r.kind)] += 1));
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== "all" && filterGroup(r.kind) !== typeFilter) return false;
      if (!q) return true;
      return [r.label, r.ref, r.context, r.archived_by_name, r.archive_reason, ARCHIVE_KIND_LABEL[r.kind]]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, typeFilter, search]);

  const isFullAccess = me?.access_level === "full";
  const canRestore = (r: ArchiveRow) => isFullAccess || (!!me && r.archived_by === me.id);

  async function handleRestore(r: ArchiveRow) {
    const bundle = bundleText(r);
    const ok = await confirm({
      title: "Restore from Archive",
      message: `Restore ${ARCHIVE_KIND_LABEL[r.kind]} **${r.label}**${bundle ? ` together with its ${bundle}` : ""}? It goes back exactly where it was.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    const key = `${r.kind}-${r.id}`;
    setRestoringKey(key);
    const { error } = await restoreItem(r.kind, r.id);
    setRestoringKey(null);
    if (error) {
      await alert(`Couldn't restore: ${error.message}`);
      return;
    }
    load();
  }

  const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", textAlign: "left" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };

  return (
    <div>
      {dialog}
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ marginBottom: 2 }}>Archive</h1>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}>
          Everything deleted in Tempo lands here first. Items are permanently removed {ARCHIVE_RETENTION_DAYS} days after archiving unless restored.
          Only the person who archived an item, or Full Access, can restore it.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TYPE_FILTERS.map((f) => {
            const active = typeFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setTypeFilter(f.key)}
                style={{
                  fontSize: 11.5, fontWeight: 600, padding: "6px 10px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: active ? "var(--accent)" : "var(--surface)",
                  color: active ? "#fff" : "var(--text-secondary)",
                }}
              >
                {f.label} <span style={{ opacity: 0.75 }}>({counts[f.key]})</span>
              </button>
            );
          })}
        </div>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
          <input
            type="text"
            placeholder="Search archive..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px 7px 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
          />
        </div>
        <button
          onClick={() => load()}
          title="Refresh"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, color: "var(--text-secondary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {loading ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "var(--muted)", padding: "10px 0" }}>{rows.length === 0 ? "The Archive is empty." : "Nothing matches these filters."}</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2, #f5f6f8)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>Type</th>
                <th style={th}>Item</th>
                <th style={th}>Context</th>
                <th style={th}>Includes</th>
                <th style={th}>Archived By</th>
                <th style={th}>Archived On</th>
                <th style={th}>Reason</th>
                <th style={th}>Auto-deletes</th>
                <th style={{ ...th, textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const key = `${r.kind}-${r.id}`;
                const daysLeft = Math.max(0, Math.ceil((new Date(r.purge_at).getTime() - Date.now()) / 86400000));
                const bundle = bundleText(r);
                return (
                  <tr key={key} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span className={`status-pill ${KIND_TONE[filterGroup(r.kind)]}`} style={{ fontSize: 9.5 }}>{ARCHIVE_KIND_LABEL[r.kind]}</span>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: "var(--navy)" }}>{r.label}</div>
                      {r.ref && <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{r.ref}</div>}
                    </td>
                    <td style={td}>{r.context ?? "—"}</td>
                    <td style={td}>{bundle ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{r.archived_by_name ?? "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDateTime(r.archived_at)}</td>
                    <td style={{ ...td, maxWidth: 220, whiteSpace: "normal", wordBreak: "break-word" }}>{r.archive_reason ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <div>{new Date(r.purge_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                      <div style={{ fontSize: 10, color: daysLeft <= 7 ? "var(--danger-text)" : "var(--muted)", fontWeight: daysLeft <= 7 ? 700 : 400 }}>
                        {daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {canRestore(r) ? (
                        <button
                          onClick={() => handleRestore(r)}
                          disabled={restoringKey === key}
                          title="Restore"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", padding: "5px 9px", cursor: "pointer", whiteSpace: "nowrap" }}
                        >
                          <RotateCcw size={12} />
                          Restore
                        </button>
                      ) : (
                        <span style={{ fontSize: 10.5, color: "var(--muted)" }} title="Only the person who archived this, or Full Access, can restore it">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
