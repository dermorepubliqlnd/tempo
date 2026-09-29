import { useEffect, useState } from "react";
import { Timer, ChevronDown } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useTimeTracking } from "../lib/TimeTrackingContext";
import { useConfirm } from "../lib/useConfirm";
import { buildHolidayNameMap, nonWorkingDayConfirmMessage, toISO, type HolidayNameMap } from "../lib/workingDays";

// 2026-09-29 (phase123, Sandra: quick start for non-project timers) --
// one-click "Start non-project timer" on My Dashboard, so a meeting can
// be timed the moment it starts instead of plotted after the fact.
// Pick an Activity Type -> weekend/holiday soft check -> timer runs in
// the bottom tracker bar. Notes are forced when it stops; no approval.
export default function NonProjectTimerQuickStart() {
  const { running, busy, startNonProject } = useTimeTracking();
  const { confirm, alert, dialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<{ id: string; name: string }[]>([]);
  const [holidayNames, setHolidayNames] = useState<HolidayNameMap>(new Map());

  useEffect(() => {
    Promise.all([
      supabase.from("non_project_activity_types").select("id,name,is_active,is_archived").order("sort_order"),
      supabase.from("holidays").select("date,name"),
    ]).then(([{ data: t }, { data: h }]) => {
      setTypes(((t as { id: string; name: string; is_active: boolean; is_archived?: boolean }[] | null) ?? []).filter((x) => x.is_active && !x.is_archived));
      setHolidayNames(buildHolidayNameMap((h as { date: string; name: string }[] | null) ?? []));
    });
  }, []);

  const disabled = busy || Boolean(running);

  async function startFor(t: { id: string; name: string }) {
    setOpen(false);
    const warnMsg = nonWorkingDayConfirmMessage(toISO(new Date()), holidayNames);
    if (warnMsg && !(await confirm({ message: warnMsg, confirmLabel: "Yes, start" }))) return;
    const res = await startNonProject(t);
    if (res.error) await alert(`Couldn't start timer: ${res.error}`);
  }

  return (
    <div style={{ position: "relative" }}>
      {dialog}
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={running ? `Stop the timer running on "${running.task_name}" first` : "Time a meeting, admin work, coaching or training as it happens"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600,
          color: "var(--accent)", background: "var(--surface)", border: "1px solid var(--accent)",
          borderRadius: 999, padding: "8px 14px", cursor: disabled ? "default" : "pointer", whiteSpace: "nowrap",
          opacity: running ? 0.45 : 1,
        }}
      >
        <Timer size={14} /> Start non-project timer <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 19 }} />
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-card, 0 6px 16px rgba(15,41,66,0.12))", minWidth: 190, overflow: "hidden" }}>
            <div style={{ padding: "8px 14px 4px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>Activity type</div>
            {types.map((t) => (
              <button
                key={t.id}
                onClick={() => startFor(t)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover-bg)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", fontSize: 12.5, color: "var(--navy)", border: "none", cursor: "pointer", background: "none" }}
              >
                {t.name}
              </button>
            ))}
            {types.length === 0 && <div style={{ padding: "9px 14px", fontSize: 12, color: "var(--muted)" }}>No active activity types</div>}
          </div>
        </>
      )}
    </div>
  );
}
