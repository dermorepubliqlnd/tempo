import { useState } from "react";
import Modal from "./Modal";
import { confirmTimeEntry, resumeTimer, discardTimerEntry, formatDuration, DISCARD_TIMER_MAX_SECONDS } from "../lib/timeTracking";

// The one edit-once step between "timer stopped" and "this time entry is
// permanently locked in". Shown automatically the moment a stop or an
// idle auto-stop produces a pending_confirm row (see TimeTrackingContext).
// Exactly two choices, no third "decide later" escape hatch (Sandra
// explicitly removed that): Continue work resumes the same entry from its
// original start time (undoes the stop); Confirm locks it in. Closing the
// modal any other way (X, backdrop, Escape) is treated the same as
// Continue work -- there's no dismiss action that leaves an entry
// dangling unconfirmed.
//
// Start/end use separate date + time fields rather than a single
// <input type="datetime-local"> -- that control's displayed time format
// (12-hour vs 24-hour, ":" vs "." separator) is rendered by the browser
// using the OS locale, which on some locales shows a period instead of a
// colon. Plain <input type="time"> is far more consistently colon-separated
// across browsers/locales.

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ConfirmTimeEntryModal({
  entry,
  onDone,
  onContinue,
  onDiscarded,
}: {
  entry: { id: string; task_name: string; started_at: string; ended_at: string; duration_minutes: number; auto_stopped: boolean; is_non_project?: boolean; notes?: string | null };
  onDone: () => void;
  onContinue: () => void;
  onDiscarded?: () => void;
}) {
  // 2026-09-29 (phase123): a non-project timer must have notes before it
  // can be confirmed (DB-enforced too). Until then it stays an
  // unconfirmed/Pending log and shows in Needs My Attention.
  const notesRequired = Boolean(entry.is_non_project);
  // Accidental start: under 2 minutes of ACTUAL timer time (not the
  // adjustable fields below) can be discarded without notes.
  const canDiscard = new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime() < DISCARD_TIMER_MAX_SECONDS * 1000;
  const [discarding, setDiscarding] = useState(false);
  const [startDate, setStartDate] = useState(toDateInputValue(entry.started_at));
  const [startTime, setStartTime] = useState(toTimeInputValue(entry.started_at));
  const [endDate, setEndDate] = useState(toDateInputValue(entry.ended_at));
  const [endTime, setEndTime] = useState(toTimeInputValue(entry.ended_at));
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startDt = new Date(`${startDate}T${startTime}`);
  const endDt = new Date(`${endDate}T${endTime}`);
  const previewMinutes = Math.max(1, Math.round((endDt.getTime() - startDt.getTime()) / 60000));

  async function handleDiscard() {
    setDiscarding(true);
    setError(null);
    const res = await discardTimerEntry(entry.id);
    setDiscarding(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    (onDiscarded ?? onDone)();
  }

  async function handleConfirm() {
    if (notesRequired && !notes.trim()) {
      setError("Add a note describing what this non-project time was for.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await confirmTimeEntry(entry.id, {
      startedAt: startDt.toISOString(),
      endedAt: endDt.toISOString(),
      notes: notes.trim() || undefined,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone();
  }

  async function handleContinue() {
    setResuming(true);
    setError(null);
    const res = await resumeTimer(entry.id);
    setResuming(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onContinue();
  }

  return (
    <Modal title="Confirm time entry" onClose={handleContinue}>
      <div style={{ fontSize: 12.5 }}>
        {entry.auto_stopped && (
          <div className="status-pill warning" style={{ marginBottom: 10, display: "inline-block" }}>
            Auto-stopped after being idle -- please check these times
          </div>
        )}
        <p style={{ margin: "0 0 12px", color: "var(--muted)" }}>
          {entry.is_non_project ? "Non-project timer" : "Timer"} on <strong style={{ color: "var(--navy)" }}>{entry.task_name}</strong>. Still working on this? Choose Continue work. Otherwise you
          can adjust the times once below, then Confirm.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <label style={{ display: "block", flex: 1 }}>
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
            />
          </label>
          <label style={{ display: "block", width: 100 }}>
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Start time</span>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
            />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <label style={{ display: "block", flex: 1 }}>
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>End date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
            />
          </label>
          <label style={{ display: "block", width: 100 }}>
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>End time</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
            />
          </label>
        </div>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ display: "block", fontSize: 11, color: notesRequired ? "var(--navy)" : "var(--muted)", fontWeight: notesRequired ? 600 : 400, marginBottom: 3 }}>
            {notesRequired ? "Notes (required) -- what was this for?" : "Note (optional)"}
          </span>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            autoFocus={notesRequired}
            placeholder={notesRequired ? "e.g. Weekly team huddle -- Q4 training calendar" : "e.g. forgot to stop for lunch"}
            style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
          />
        </label>

        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--navy)", marginBottom: 12 }}>Total: {formatDuration(previewMinutes)}</div>

        {error && <div style={{ color: "var(--danger-text)", fontSize: 11.5, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {canDiscard && (
            <button
              onClick={handleDiscard}
              disabled={saving || resuming || discarding}
              title="Started by accident? Under 2 minutes can be discarded without notes."
              style={{ marginRight: "auto", fontSize: 12, fontWeight: 600, color: "var(--danger-text)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 14px", cursor: "pointer" }}
            >
              {discarding ? "Discarding…" : "Discard (started by accident)"}
            </button>
          )}
          <button
            onClick={handleContinue}
            disabled={saving || resuming || discarding}
            style={{ fontSize: 12, fontWeight: 600, color: "var(--navy)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 14px", cursor: "pointer" }}
          >
            {resuming ? "Resuming…" : "Continue work"}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || resuming || discarding || (notesRequired && !notes.trim())}
            style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 14px", cursor: "pointer" }}
          >
            {saving ? "Confirming…" : "Confirm -- lock it in"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
