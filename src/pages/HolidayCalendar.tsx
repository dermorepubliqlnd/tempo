import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { archiveItem, ARCHIVE_MOVE_NOTE } from "../lib/archive";
import { InlineText, InlineDate, InlineSelect } from "../components/InlineCell";
import { useConfirm } from "../lib/useConfirm";
import { useSession } from "../lib/useSession";

interface HolidayRow {
  id: string;
  date: string;
  name: string;
  category: "legal_ph" | "local" | "internal";
}

const CATEGORY_LABEL: Record<string, string> = {
  legal_ph: "Legal PH Holiday",
  local: "Local Holiday",
  internal: "Internal Time Off",
};
const CATEGORY_TONE: Record<string, string> = {
  legal_ph: "danger",
  local: "warning",
  internal: "accent",
};
const CATEGORY_OPTIONS = ["Legal PH Holiday", "Local Holiday", "Internal Time Off"];
const CATEGORY_TO_VALUE: Record<string, HolidayRow["category"]> = {
  "Legal PH Holiday": "legal_ph",
  "Local Holiday": "local",
  "Internal Time Off": "internal",
};

// Admin-only (Full Access, enforced via RLS) list of company-wide
// non-working days that block the whole team's grid on the Day Planner.
// PH holiday dates shift every year (proclamations, movable dates), so
// this is a flat per-year list to maintain rather than a recurring rule —
// expect to refresh it annually.
// 2026-09-24 (sidebar cleanup): now shown as the "Holiday Calendar" tab
// inside Time Off & Holidays. View-only for everyone; only Full Access
// can add/edit/delete (RLS already enforces this -- the UI now matches).
export default function HolidayCalendar({ embedded = false }: { embedded?: boolean }) {
  const { person: me } = useSession();
  const canEdit = me?.access_level === "full";
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { confirm, dialog } = useConfirm();

  async function loadAll() {
    setLoading(true);
    const { data } = await supabase.from("holidays").select("*").order("date");
    setHolidays((data as HolidayRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function update(id: string, patch: Partial<HolidayRow>) {
    setHolidays((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
    const { error } = await supabase.from("holidays").update(patch).eq("id", id);
    if (error) {
      window.alert(`Couldn't save: ${error.message}`);
      loadAll();
    }
  }

  async function addHoliday() {
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("holidays").insert({ date: today, name: "New holiday", category: "legal_ph" });
    if (error) {
      window.alert(`Couldn't add: ${error.message}`);
      return;
    }
    loadAll();
  }

  async function remove(h: HolidayRow) {
    const ok = await confirm({
      title: "Delete holiday",
      message: `Delete "${h.name}" (${h.date})? ${ARCHIVE_MOVE_NOTE}`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const { error } = await archiveItem("holiday", h.id);
    if (error) {
      window.alert(`Couldn't delete: ${error.message}`);
      return;
    }
    loadAll();
  }

  return (
    <div>
      {dialog}
      {!embedded && <h1>Holiday calendar</h1>}
      <p className="subtitle">
        Company-wide non-working days for the Day Planner. Legal PH Holidays, Local Holidays, and Internal Time Off (e.g. strat planning, team building) all
        block the whole team's grid for that date, regardless of any task's own start/due window. PH holiday dates shift every year, so refresh this list
        annually rather than relying on it carrying over automatically.
      </p>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>
        ) : (
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 130 }}>Date</th>
                <th>Name</th>
                <th style={{ width: 180 }}>Category</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>
                    No holidays added yet.
                  </td>
                </tr>
              )}
              {holidays.map((h) => (
                <tr key={h.id}>
                  <td>
                    <InlineDate value={h.date} editable={canEdit} onCommit={(v) => v && update(h.id, { date: v })} />
                  </td>
                  <td>
                    <InlineText value={h.name} editable={canEdit} onCommit={(v) => update(h.id, { name: v })} />
                  </td>
                  <td>
                    <InlineSelect
                      value={CATEGORY_LABEL[h.category]}
                      editable={canEdit}
                      options={CATEGORY_OPTIONS}
                      renderReadOnly={() => <span className={`status-pill ${CATEGORY_TONE[h.category]}`}>{CATEGORY_LABEL[h.category]}</span>}
                      onCommit={(v) => update(h.id, { category: CATEGORY_TO_VALUE[v] ?? "legal_ph" })}
                    />
                  </td>
                  <td>
                    {canEdit && (
                      <button className="row-icon-btn" onClick={() => remove(h)} title="Delete holiday">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {canEdit && (
              <tr>
                <td colSpan={4} className="add-row-cell">
                  <div className="add-row-trigger" onClick={addHoliday}>
                    <Plus size={12} />
                    New holiday
                  </div>
                </td>
              </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
