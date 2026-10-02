import { useEffect, useState } from "react";
import { Clock, Square, AlertCircle } from "lucide-react";
import { useTimeTracking } from "../lib/TimeTrackingContext";
import ConfirmTimeEntryModal from "./ConfirmTimeEntryModal";

function elapsedLabel(startedAt: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Sits at the bottom of every screen (mounted once in AppLayout) so a
// running timer stays visible while navigating anywhere else in the app --
// otherwise it'd be easy to forget a timer is running once you've clicked
// away from the Tasks table. Also surfaces a quiet reminder if there are
// unconfirmed entries waiting (stopped or auto-stopped, not yet locked
// in), since those don't block anything and could otherwise sit forgotten.
// phase127i (Sandra 2026-10-01: "the timer kinda overlaps with the bottom
// part and it's hard to see... move the timer into the navigation panel,
// just under the logo"). Was a fixed bottom bar (left: 208 hard-coded, so it
// also mis-aligned when the sidebar was collapsed, and it covered the last
// rows of every page). Now a card rendered INSIDE the sticky sidebar, right
// under the Tempo logo. `collapsed` mirrors the sidebar's own state.
export default function TimeTrackerBar({ collapsed = false }: { collapsed?: boolean }) {
  const { running, pendingConfirm, busy, requestStop, refresh, openConfirmModalFor, setOpenConfirmModalFor, bumpVersion } = useTimeTracking();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const modalEntry = pendingConfirm.find((e) => e.id === openConfirmModalFor) ?? null;

  if (!running && pendingConfirm.length === 0) return null;

  const elapsed = running ? elapsedLabel(running.started_at, now) : "";
  const unconfirmedLabel = `${pendingConfirm.length} unconfirmed ${pendingConfirm.length === 1 ? "entry" : "entries"}`;

  const card = collapsed ? (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, margin: "0 0 14px", padding: "8px 0", borderRadius: 10, background: "rgba(255,255,255,0.08)" }}>
      {running && (
        <>
          <span title={`Timing ${running.task_name}${running.is_non_project ? " · Non-project" : ""}`} style={{ display: "inline-flex" }}>
            <Clock size={15} color="var(--teal, #4fd1c5)" className="timer-pulse" />
          </span>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{elapsed}</span>
          <button
            onClick={() => requestStop()}
            disabled={busy}
            title="Stop timer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, background: "var(--danger-bg)", border: "1px solid #f5c6c3", borderRadius: 6, cursor: "pointer", padding: 0 }}
          >
            <Square size={10} fill="#e0352b" color="#e0352b" />
          </button>
        </>
      )}
      {pendingConfirm.length > 0 && (
        <button
          onClick={() => setOpenConfirmModalFor(pendingConfirm[0].id)}
          title={unconfirmedLabel}
          style={{ display: "flex", alignItems: "center", gap: 2, background: "none", border: "none", color: "#ffd479", fontSize: 10, fontWeight: 700, cursor: "pointer", padding: 0 }}
        >
          <AlertCircle size={13} />
          {pendingConfirm.length}
        </button>
      )}
    </div>
  ) : (
    <div style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", color: "#fff" }}>
      {running && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Clock size={13} color="var(--teal, #4fd1c5)" className="timer-pulse" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#9BA8BB" }}>Timing</span>
            <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{elapsed}</span>
          </div>
          <div
            title={running.task_name}
            style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", wordBreak: "break-word" }}
          >
            {running.task_name}
          </div>
          {running.is_non_project && <div style={{ fontSize: 10.5, color: "#9BA8BB", marginTop: 1 }}>Non-project</div>}
          <button
            onClick={() => requestStop()}
            disabled={busy}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", marginTop: 8, background: "var(--danger-bg)", color: "var(--danger-text)", border: "1px solid #f5c6c3", borderRadius: "var(--radius-sm)", padding: "6px 0", fontWeight: 700, fontSize: 12, cursor: busy ? "default" : "pointer" }}
          >
            <Square size={10} fill="#e0352b" color="#e0352b" />
            Stop
          </button>
        </>
      )}
      {pendingConfirm.length > 0 && (
        <button
          onClick={() => setOpenConfirmModalFor(pendingConfirm[0].id)}
          style={{ display: "flex", alignItems: "center", gap: 5, marginTop: running ? 8 : 0, background: "none", border: "none", color: "#ffd479", fontSize: 11.5, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" }}
        >
          <AlertCircle size={13} style={{ flexShrink: 0 }} />
          {unconfirmedLabel}
        </button>
      )}
    </div>
  );

  return (
    <>
      {card}
      {modalEntry && (
        <ConfirmTimeEntryModal
          entry={modalEntry}
          onDone={() => {
            setOpenConfirmModalFor(null);
            refresh();
            bumpVersion();
          }}
          onContinue={() => {
            setOpenConfirmModalFor(null);
            refresh();
          }}
          onDiscarded={() => {
            setOpenConfirmModalFor(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
