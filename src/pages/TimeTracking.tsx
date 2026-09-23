import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ShieldCheck, ChevronRight, ChevronLeft, ChevronDown, Pencil, Timer, Trash2, Archive, RotateCcw, Plus, Search, X, CalendarDays, AlertCircle, ListChecks } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { formatDate } from "../lib/formatDate";
import { formatDuration, submitManualTimeEntry, submitNonProjectTimeEntry, correctTimeEntry, editPendingManualTimeEntry, deletePendingManualTimeEntry, archiveTimeEntry, unarchiveTimeEntry } from "../lib/timeTracking";
import { useSearchParams } from "react-router-dom";
import Modal from "../components/Modal";

interface PersonLite {
  id: string;
  name: string;
  reports_to: string | null;
}

// Time Logging Reasons (Phase 37, 2026-09-03) -- admin-configurable via
// Site Settings (was a fixed TIME_ENTRY_REASON_OPTIONS array in
// timeTracking.ts). Only manual entries need a reason -- the Start/Stop
// timer never asks for one.
interface TimeEntryReasonRow {
  id: string;
  name: string;
  is_active: boolean;
}

// Non-Project Activity Types (Phase 59, 2026-09-22) -- admin-configurable
// via Site Settings, same id/name/sort_order/is_active shape as Work
// Types/Output Types/Time Logging Reasons.
interface NonProjectActivityTypeRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface TaskLite {
  id: string;
  name: string;
  assignee_id: string | null;
  project_id: string;
  current_due_date: string | null;
  status: string | null;
  project: { id: string; name: string; owner_id: string | null; timelines_locked: boolean; wbs_status: string } | null;
  // Phase 67 (2026-09-23): sequential Task ID, see supabase/phase67_migration.sql.
  task_number: number;
}

interface EntryRow {
  id: string;
  // 2026-09-22: null on a non-project entry -- see activity_type below.
  task_id: string | null;
  activity_type_id: string | null;
  person_id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  source: "timer" | "manual" | "legacy";
  status: "running" | "pending_confirm" | "confirmed" | "pending_approval" | "approved" | "rejected";
  requested_by: string | null;
  reason_category: string | null;
  reason_notes: string | null;
  auto_stopped: boolean;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  corrected_by: string | null;
  corrected_at: string | null;
  original_duration_minutes: number | null;
  correction_notes: string | null;
  created_at: string;
  // 2026-09-23 (phase63): admin soft-delete, reversible, excluded from
  // every hour rollup.
  is_archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  // 2026-09-23 (phase75): sequence-backed ID for a non-project entry
  // (activity_type_id set), same padding convention as task_number's
  // "T-0007" -- displayed "NP-0007". Always null on a project-task entry.
  non_project_entry_number: number | null;
  task: TaskLite | null;
  activity_type: { id: string; name: string } | null;
  person: { id: string; name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  pending_confirm: "Awaiting confirmation",
  confirmed: "Confirmed",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_TONE: Record<string, string> = {
  running: "accent",
  pending_confirm: "warning",
  confirmed: "success",
  pending_approval: "warning",
  approved: "success",
  rejected: "danger",
};

const SOURCE_LABEL: Record<string, string> = { timer: "Timer", manual: "Manual", legacy: "Legacy" };

// 2026-09-15 (Sandra: "I want to see the date and time when logs were
// logged especially for the manual time entries") -- formatDate() only
// ever renders the date part (see formatDate.ts), so a separate
// date+time formatter is needed for created_at (when the ROW was
// inserted -- i.e. when the person actually made the log entry) as
// distinct from started_at/ended_at (the WORK period the entry covers).
function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

// 2026-09-22 (Sandra: on a non-project entry, "why do the request not
// show the start and end time? ... this one is just showing dates which
// does not make sense") -- the row's date+duration line used to render
// formatDate(started_at) -- formatDate(ended_at), which for a same-day
// entry is two identical dates side by side and tells you nothing about
// when the work actually happened. This shows the log date once, plus
// the actual start/end clock times (or, on the rare cross-midnight
// entry, a full date+time for each side).
function formatTimeRange(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  if (isNaN(start.getTime())) return formatDate(startedAt);
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endedAt) return `${formatDate(startedAt)}, ${startTime} -- in progress`;
  const end = new Date(endedAt);
  if (isNaN(end.getTime())) return formatDate(startedAt);
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = start.toDateString() === end.toDateString();
  return sameDay
    ? `${formatDate(startedAt)}, ${startTime} -- ${endTime}`
    : `${formatDate(startedAt)} ${startTime} -- ${formatDate(endedAt)} ${endTime}`;
}

// 2026-09-22 (Sandra: revamped "Needs your decision" table) -- Time-only
// counterpart to formatTimeRange, for the table's separate Time column
// (Work Date already carries the date).
function formatClockRange(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  if (isNaN(start.getTime())) return "—";
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endedAt) return `${startTime} -- in progress`;
  const end = new Date(endedAt);
  if (isNaN(end.getTime())) return startTime;
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${startTime} -- ${endTime}`;
}

// 2026-09-23 (Sandra: "flag time entries that has timing overlaps... i
// see this mostly applicable when logging manual entries... if someone
// is claiming hours worked and there is an existing task (pending or
// approved, confirmed) - flag it") -- a running entry has no ended_at
// yet, so it's treated as ongoing (blocks anything starting before
// "now"). Rejected/archived entries never block -- they're not a real
// claim on that time.
const OVERLAP_BLOCKING_STATUSES = new Set(["pending_confirm", "pending_approval", "confirmed", "approved"]);
function findOverlappingEntry(entries: EntryRow[], personId: string, startIso: string, endIso: string, excludeId?: string): EntryRow | null {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  for (const row of entries) {
    if (row.person_id !== personId || row.id === excludeId || row.is_archived) continue;
    if (!OVERLAP_BLOCKING_STATUSES.has(row.status)) continue;
    const rs = new Date(row.started_at).getTime();
    const re = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
    if (s < re && rs < e) return row;
  }
  return null;
}
function overlapTaskIdLabel(row: EntryRow): string {
  return row.task?.task_number
    ? `T-${String(row.task.task_number).padStart(4, "0")}`
    : row.non_project_entry_number
    ? `NP-${String(row.non_project_entry_number).padStart(4, "0")}`
    : "—";
}
function overlapTitle(row: EntryRow): string {
  return row.activity_type_id ? row.activity_type?.name ?? "Non-project" : row.task?.name ?? "Untitled task";
}
function overlapMessageText(row: EntryRow): string {
  return `Time overlap detected\n\nYou already have a logged entry for this period:\nTask ID: ${overlapTaskIdLabel(row)}\nTask: ${overlapTitle(row)}\nTime: ${formatClockRange(row.started_at, row.ended_at)}\nStatus: ${STATUS_LABEL[row.status]}\n\nPlease adjust the start or end time.`;
}

function formatWorkDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${datePart} (${weekday})`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Small searchable combobox (Sandra, 2026-08-26: "allow project selection
// in the time tracker then next will be task... allow search too for both
// options") -- a plain <select> got unwieldy once Project became its own
// step ahead of Task. Filters options client-side as you type; click a row
// or the input's current match to select. Local to this file since Task
// Tracking is the only place a project-then-task cascade like this exists
// so far.
function SearchSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        disabled={disabled}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: "100%",
          fontSize: 12,
          padding: "6px 8px",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          boxSizing: "border-box",
          background: disabled ? "var(--bg)" : "var(--surface)",
        }}
      />
      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            maxHeight: 180,
            overflowY: "auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 4px 16px rgba(15,41,66,0.14)",
            zIndex: 50,
          }}
        >
          {filtered.length === 0 && <div style={{ padding: "6px 8px", fontSize: 11.5, color: "var(--muted)" }}>No matches</div>}
          {filtered.map((o) => (
            <button
              key={o.id}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
                setQuery("");
              }}
              style={{ display: "block", width: "100%", textAlign: "left", fontSize: 12, padding: "6px 8px", background: "none", border: "none", cursor: "pointer" }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Separate date + time fields rather than <input type="datetime-local">:
// that control's displayed time format is rendered per the OS locale,
// which on some systems shows a period instead of a colon between hours
// and minutes. Plain <input type="time"> is consistently colon-separated.
function toDateInputValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeInputValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Date-range browser helpers (2026-09-23). Monday-start week, matching
// the 5-day (Mon-Fri) workweek daily_capacity_hours is meant to cover.
function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
// Given a preset + anchor date, returns the [start, end] local date keys
// (YYYY-MM-DD, inclusive) that preset covers.
function rangeForPreset(preset: "today" | "this_week" | "last_week" | "this_month" | "custom", anchor: Date, customStart: string, customEnd: string): [string, string] {
  if (preset === "custom") return [customStart, customEnd];
  if (preset === "today") return [toDateInputValue(anchor), toDateInputValue(anchor)];
  if (preset === "this_week") {
    const s = startOfWeek(anchor);
    return [toDateInputValue(s), toDateInputValue(addDays(s, 6))];
  }
  if (preset === "last_week") {
    const s = addDays(startOfWeek(anchor), -7);
    return [toDateInputValue(s), toDateInputValue(addDays(s, 6))];
  }
  // this_month
  return [toDateInputValue(startOfMonth(anchor)), toDateInputValue(endOfMonth(anchor))];
}
// Steps the anchor by one preset-unit (day/week/month) in either
// direction, used by the range browser's < > arrows.
function stepAnchor(preset: "today" | "this_week" | "last_week" | "this_month" | "custom", anchor: Date, dir: 1 | -1): Date {
  if (preset === "today") return addDays(anchor, dir);
  if (preset === "this_week" || preset === "last_week") return addDays(anchor, dir * 7);
  if (preset === "this_month") {
    const r = new Date(anchor);
    r.setMonth(r.getMonth() + dir);
    return r;
  }
  return anchor;
}
function formatRangeLabel(startKey: string, endKey: string): string {
  const s = new Date(startKey + "T00:00:00");
  const e = new Date(endKey + "T00:00:00");
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  if (startKey === endKey) {
    return s.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  const startLabel = s.toLocaleDateString(undefined, sameMonth ? { month: "short", day: "numeric" } : { month: "short", day: "numeric" });
  const endLabel = e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

// 2026-09-23 (phase66, live bug: "type one letter then the next key
// press routes to the bottom of the page") -- EntriesTable/DecisionTable
// are defined INSIDE TimeTracking's render body, so every keystroke that
// updated a lifted draft (notesDraft/correctDraft/editDraft/archiveNotes)
// re-rendered TimeTracking, which redefined those tables as brand-new
// function values -- React saw a different component `type` on every
// keystroke and remounted the whole table, dropping input focus (the
// very next keystroke then fell through to the page itself, and the
// browser's default spacebar/arrow-key handling on a focus-less document
// scrolled it to the bottom). Fix: each inline edit form below owns its
// OWN local draft state and only reports upward via onSubmit/onConfirm
// when the person clicks the action button -- so typing never touches
// TimeTracking's state and never forces a remount.

function ArchiveForm({ onSubmit, onCancel }: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input
        type="text"
        placeholder="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ flex: "1 1 220px", fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
      />
      <button
        onClick={() => onSubmit(reason)}
        style={{ fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--danger-text)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Archive
      </button>
      <button onClick={onCancel} style={{ fontSize: 11.5, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
        Cancel
      </button>
    </div>
  );
}

function EditForm({
  row,
  isNonProject,
  reasonOptions,
  nonProjectActivityTypes,
  saving,
  onSubmit,
  onCancel,
}: {
  row: EntryRow;
  isNonProject: boolean;
  reasonOptions: TimeEntryReasonRow[];
  nonProjectActivityTypes: NonProjectActivityTypeRow[];
  saving: boolean;
  onSubmit: (v: { date: string; startTime: string; endTime: string; reasonCategory: string; activityTypeId: string; notes: string }) => void;
  onCancel: () => void;
}) {
  const start = new Date(row.started_at);
  const end = row.ended_at ? new Date(row.ended_at) : start;
  const [date, setDate] = useState(toDateInputValue(start));
  const [startTime, setStartTime] = useState(toTimeInputValue(start));
  const [endTime, setEndTime] = useState(toTimeInputValue(end));
  const [reasonCategory, setReasonCategory] = useState(row.reason_category ?? "");
  const [activityTypeId, setActivityTypeId] = useState(row.activity_type_id ?? "");
  const [notes, setNotes] = useState(row.reason_notes ?? "");
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
      <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>to</span>
      <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
      {isNonProject ? (
        <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} style={{ width: 150, fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          {nonProjectActivityTypes.filter((a) => a.is_active || a.id === activityTypeId).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      ) : (
        <select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)} style={{ width: 150, fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          <option value="">No reason</option>
          {reasonOptions.filter((r) => r.is_active || r.name === reasonCategory).map((r) => (
            <option key={r.id} value={r.name}>{r.name}</option>
          ))}
        </select>
      )}
      <input type="text" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ flex: "1 1 160px", fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
      <button
        onClick={() => onSubmit({ date, startTime, endTime, reasonCategory, activityTypeId, notes })}
        disabled={saving}
        style={{ fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Save changes
      </button>
      <button onClick={onCancel} style={{ fontSize: 11.5, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
        Cancel
      </button>
    </div>
  );
}

function CorrectForm({
  row,
  reasonOptions,
  nonProjectActivityTypes,
  onSubmit,
  onCancel,
}: {
  row: EntryRow;
  reasonOptions: TimeEntryReasonRow[];
  nonProjectActivityTypes: NonProjectActivityTypeRow[];
  onSubmit: (v: { hours: string; notes: string; reasonCategory: string; activityTypeId: string }) => void;
  onCancel: () => void;
}) {
  const [hours, setHours] = useState(String(Math.round(((row.duration_minutes ?? 0) / 60) * 100) / 100));
  const [notes, setNotes] = useState("");
  const [reasonCategory, setReasonCategory] = useState(row.reason_category ?? "");
  const [activityTypeId, setActivityTypeId] = useState(row.activity_type_id ?? "");
  const isNonProject = Boolean(row.activity_type_id);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="number" step="0.25" placeholder="Corrected hours" value={hours} onChange={(e) => setHours(e.target.value)} style={{ width: 110, fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
      {isNonProject ? (
        <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} style={{ width: 150, fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          {nonProjectActivityTypes.filter((a) => a.is_active || a.id === activityTypeId).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      ) : (
        <select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)} style={{ width: 150, fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
          <option value="">No reason</option>
          {reasonOptions.filter((r) => r.is_active || r.name === reasonCategory).map((r) => (
            <option key={r.id} value={r.name}>{r.name}</option>
          ))}
        </select>
      )}
      <input type="text" placeholder="Correction notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ flex: "1 1 160px", fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
      <button
        onClick={() => onSubmit({ hours, notes, reasonCategory, activityTypeId })}
        style={{ fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Save correction
      </button>
      <button onClick={onCancel} style={{ fontSize: 11.5, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
        Cancel
      </button>
    </div>
  );
}

export default function TimeTracking() {
  const { person: me } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterProjectId = searchParams.get("project") || "";
  const { confirm, alert, dialog: confirmDialog } = useConfirm();
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [myTasks, setMyTasks] = useState<TaskLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  // 2026-09-22 (Sandra: "let's allow the assignee or requestor to delete
  // or make changes with the manual time entry log" while it's still
  // pending_approval) -- separate from correctingId above, which is the
  // Full-Access-only correction flow for an already-decided entry.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  // Status filter (2026-09-19, Sandra: "fix the time tracking page to not
  // make it boring") -- same clickable metric-card filter as the
  // Extension Requests and Approval Center pages.
  const [statusFilter, setStatusFilter] = useState<"all" | "pending_approval" | "approved" | "rejected">("all");
  // 2026-09-23 (Sandra: "My Time / Team Time / All Time" -- reworked the
  // old flat My entries/Other visible entries split into three scopes
  // that adapt to who's looking. My Time is everyone's default. Team
  // Time only appears for someone who manages at least one person
  // (walking the reports_to chain all the way down, not just direct
  // reports -- see myTeamIds below). All Time only appears for Full
  // Access, reusing the same access_level check used everywhere else.
  const [scope, setScope] = useState<"mine" | "team" | "all">("mine");

  // 2026-09-23 (Sandra: mockup-driven redesign -- search/filters/sort,
  // date-range browsing, group-by-date, a single Add Time button) --
  // Source/search/sort/grouping are new; statusFilter above is reused
  // but now driven by a real <select> in the filter row instead of the
  // old clickable status-count cards (those cards are gone -- replaced
  // by the Today/This Week/Total Entries/Needs Attention KPI row).
  const [sourceFilter, setSourceFilter] = useState<"all" | "manual" | "timer">("all");
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "duration_desc" | "duration_asc">("date_desc");
  const [groupByDate, setGroupByDate] = useState(false);
  const [groupOrder, setGroupOrder] = useState<"newest" | "oldest">("newest");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Date-range browser (Today/This Week/Last Week/This Month/Custom +
  // prev/next arrows), same idea as a calendar app's range picker.
  // datePreset drives which range function applies to rangeAnchor;
  // clicking a preset button resets the anchor to today, the arrows
  // step the anchor by that preset's unit (day/week/month). This is
  // separate from the Today/This Week KPI cards below, which always
  // reflect the real current day/week regardless of what's being
  // browsed here.
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "last_week" | "this_month" | "custom">("this_week");
  const [rangeAnchor, setRangeAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(() => toDateInputValue());
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue());

  // Add Time (2026-09-23, Sandra: "let's revert to one button with
  // dropdown so they can select if it's Project or Non project") --
  // replaces the old always-visible "Log time" card + inline Project
  // task/Non-project toggle with a single button, a small dropdown to
  // pick the mode, and the same form fields now inside a Modal.
  const [addTimeMenuOpen, setAddTimeMenuOpen] = useState(false);

  // 2026-09-22 (Sandra: non-project time -- meetings, team huddles --
  // shouldn't have to fake a task under a real project): toggle at the
  // top of this same form swaps the Project/Task pickers for an
  // Activity Type picker instead. Everything else (date/start/end,
  // notes, the pending_approval lifecycle) is unchanged.
  const [logMode, setLogMode] = useState<"project" | "non_project" | null>(null);
  const [nonProjectActivityTypes, setNonProjectActivityTypes] = useState<NonProjectActivityTypeRow[]>([]);
  const [logActivityTypeId, setLogActivityTypeId] = useState("");
  const [logProjectId, setLogProjectId] = useState("");
  const [logTaskId, setLogTaskId] = useState("");
  const [logStartDate, setLogStartDate] = useState(toDateInputValue());
  const [logStartTime, setLogStartTime] = useState(toTimeInputValue());
  const [logEndTime, setLogEndTime] = useState(toTimeInputValue());
  const [reasonOptions, setReasonOptions] = useState<TimeEntryReasonRow[]>([]);
  const [logReasonCategory, setLogReasonCategory] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logError, setLogError] = useState<string | null>(null);
  // 2026-09-23 (Sandra: overlap flagging) -- holds the conflicting entry
  // so the Add Time modal can render her exact "Time overlap detected"
  // message format (bold heading + field lines) instead of a plain string.
  const [logOverlapEntry, setLogOverlapEntry] = useState<EntryRow | null>(null);
  const [logSaving, setLogSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [{ data: entryData }, { data: peopleData }, { data: taskData }, { data: reasonData }, { data: activityTypeData }] = await Promise.all([
      supabase
        .from("time_entries")
        .select(
          `id, task_id, activity_type_id, person_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_category, reason_notes, auto_stopped,
           decided_by, decided_at, decision_notes, corrected_by, corrected_at, original_duration_minutes, correction_notes, created_at,
           is_archived, archived_at, archived_by, archive_reason, non_project_entry_number,
           task:tasks ( id, name, assignee_id, project_id, task_number, project:projects ( id, name, owner_id ) ),
           activity_type:non_project_activity_types ( id, name ),
           person:people!time_entries_person_id_fkey ( id, name )`
        )
        .order("started_at", { ascending: false }),
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("tasks").select("id,name,assignee_id,project_id,current_due_date,status,task_number,project:projects(id,name,owner_id,timelines_locked,wbs_status)").eq("is_archived", false),
      supabase.from("time_entry_reasons").select("id,name,is_active").order("sort_order"),
      supabase.from("non_project_activity_types").select("id,name,is_active").order("sort_order"),
    ]);
    setEntries(((entryData as unknown as EntryRow[]) ?? []));
    setPeople((peopleData as PersonLite[]) ?? []);
    setMyTasks((((taskData as unknown as TaskLite[]) ?? [])).filter((t) => t.assignee_id === me?.id));
    const reasons = (reasonData as TimeEntryReasonRow[]) ?? [];
    setReasonOptions(reasons);
    const activityTypes = (activityTypeData as NonProjectActivityTypeRow[]) ?? [];
    setNonProjectActivityTypes(activityTypes);
    setLogActivityTypeId((current) => current || activityTypes.find((a) => a.is_active)?.id || "");
    // Default the manual-entry form to the first active reason -- only set
    // once (on first successful load, or if the field's still blank), so
    // it doesn't stomp on a choice already made mid-edit.
    setLogReasonCategory((current) => current || reasons.find((r) => r.is_active)?.name || "");
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  async function submitCorrection(row: EntryRow, v: { hours: string; notes: string; reasonCategory: string; activityTypeId: string }) {
    const hours = parseFloat(v.hours);
    if (!hours || hours <= 0) {
      await alert("Enter a corrected duration greater than zero.");
      return;
    }
    const ok = await confirm({
      message: `Correct this entry to ${hours}h? The original value (${formatDuration(row.duration_minutes)}) stays on record.`,
      confirmLabel: "Correct",
    });
    if (!ok) return;
    // 2026-09-23 (phase63): a non-project entry's correctable field is
    // its Activity Type, not Reason -- Reason was never asked of the
    // person for these in the first place (see handleSubmitManual).
    const isNonProject = Boolean(row.activity_type_id);
    const res = await correctTimeEntry(
      row.id,
      Math.round(hours * 60),
      v.notes.trim() || "Corrected by Full Access",
      isNonProject ? undefined : v.reasonCategory || undefined,
      isNonProject ? v.activityTypeId || undefined : undefined
    );
    if (res.error) {
      await alert(`Couldn't correct this entry: ${res.error}`);
      return;
    }
    setCorrectingId(null);
    loadAll();
  }

  // 2026-09-23 (phase63, Sandra: "can admin delete timelogs that have
  // been approved -- can be soft first and archived") -- reversible
  // soft-delete for a confirmed/approved entry. Excluded from every
  // hour rollup once archived; the row itself and its trail stay
  // visible here for audit.
  async function submitArchive(row: EntryRow, reason: string) {
    const label = row.activity_type_id ? row.activity_type?.name ?? "this non-project entry" : `"${row.task?.name}"`;
    const ok = await confirm({
      message: `Archive this ${formatDuration(row.duration_minutes)} entry for ${label}? It stays on record but stops counting toward Spent Hrs, Scoped vs Logged, and dashboard totals. You can restore it anytime.`,
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    const res = await archiveTimeEntry(row.id, reason.trim() || undefined);
    if (res.error) {
      await alert(`Couldn't archive this entry: ${res.error}`);
      return;
    }
    setArchivingId(null);
    loadAll();
  }

  async function submitUnarchive(row: EntryRow) {
    const ok = await confirm({ message: "Restore this entry? It'll count toward Spent Hrs and other totals again.", confirmLabel: "Restore" });
    if (!ok) return;
    const res = await unarchiveTimeEntry(row.id);
    if (res.error) {
      await alert(`Couldn't restore this entry: ${res.error}`);
      return;
    }
    loadAll();
  }

  // A manual entry (project or non-project) still sitting in
  // pending_approval, OR already Rejected, can be edited or deleted by
  // whoever logged it or requested it -- Full Access too, same as
  // everything else. 2026-09-23 (Sandra: "what happens if it's rejected
  // -- have the same action as pending") -- editing a Rejected one
  // resubmits it to pending_approval server-side (phase74_migration.sql
  // clears the old decision stamp too). Once it's Approved, this stops
  // applying and only Full Access's Correct flow above can touch it.
  function canEditDeletePending(row: EntryRow): boolean {
    if (!me) return false;
    if (row.source !== "manual" || (row.status !== "pending_approval" && row.status !== "rejected")) return false;
    return row.person_id === me.id || row.requested_by === me.id || me.access_level === "full";
  }

  async function submitEdit(row: EntryRow, v: { date: string; startTime: string; endTime: string; reasonCategory: string; activityTypeId: string; notes: string }) {
    const start = new Date(`${v.date}T${v.startTime}`);
    const end = new Date(`${v.date}T${v.endTime}`);
    if (end <= start) {
      await alert("End time must be after start time.");
      return;
    }
    const overlap = findOverlappingEntry(entries, row.person_id, start.toISOString(), end.toISOString(), row.id);
    if (overlap) {
      await alert(overlapMessageText(overlap));
      return;
    }
    setEditSaving(true);
    const res = await editPendingManualTimeEntry(row.id, start.toISOString(), end.toISOString(), {
      reasonCategory: row.activity_type_id ? undefined : v.reasonCategory || undefined,
      activityTypeId: row.activity_type_id ? v.activityTypeId || undefined : undefined,
      notes: v.notes,
    });
    setEditSaving(false);
    if (res.error) {
      await alert(`Couldn't save these changes: ${res.error}`);
      return;
    }
    setEditingId(null);
    loadAll();
  }

  async function handleDeletePending(row: EntryRow) {
    const label = row.activity_type_id ? row.activity_type?.name ?? "this non-project entry" : `"${row.task?.name}"`;
    const ok = await confirm({ message: `Delete this time entry for ${label}? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const res = await deletePendingManualTimeEntry(row.id);
    if (res.error) {
      await alert(`Couldn't delete this entry: ${res.error}`);
      return;
    }
    loadAll();
  }

  async function handleSubmitManual() {
    setLogError(null);
    setLogOverlapEntry(null);
    if (logMode === "non_project") {
      // 2026-09-22 (Sandra: "notes be optional except when Others is
      // selected, where they will be required to specify"). Reason
      // (Time Logging Reasons) doesn't apply here -- that field answers
      // "why a manual entry instead of the timer", which isn't relevant
      // to logging non-project time in the first place.
      if (!logActivityTypeId) {
        setLogError("Choose an activity type.");
        return;
      }
      const activityType = nonProjectActivityTypes.find((a) => a.id === logActivityTypeId);
      if (activityType?.name === "Others" && !logNotes.trim()) {
        setLogError('Please add a note specifying what this was when "Others" is selected.');
        return;
      }
      const start = new Date(`${logStartDate}T${logStartTime}`);
      let end = new Date(`${logStartDate}T${logEndTime}`);
      let clampedAtMidnight = false;
      if (end <= start) {
        end = new Date(`${logStartDate}T23:59:59`);
        clampedAtMidnight = true;
      }
      const overlap = findOverlappingEntry(entries, me?.id ?? "", start.toISOString(), end.toISOString());
      if (overlap) {
        setLogOverlapEntry(overlap);
        return;
      }
      setLogSaving(true);
      const res = await submitNonProjectTimeEntry(me?.id ?? "", logActivityTypeId, start.toISOString(), end.toISOString(), logNotes.trim());
      setLogSaving(false);
      if (res.error) {
        setLogError(res.error);
        return;
      }
      setLogMode(null);
      setLogNotes("");
      await alert(
        clampedAtMidnight
          ? "Time entry submitted -- your end time was before the start time, so it was clamped to 11:59 PM the same day. It goes to your manager for approval."
          : "Time entry submitted -- it goes to your manager for approval."
      );
      loadAll();
      return;
    }
    if (!logTaskId) {
      setLogError("Choose a task.");
      return;
    }
    if (!logReasonCategory) {
      setLogError("Choose a reason.");
      return;
    }
    if (logReasonCategory === "Other" && !logNotes.trim()) {
      setLogError('Please specify a reason when "Other" is selected.');
      return;
    }
    const start = new Date(`${logStartDate}T${logStartTime}`);
    let end = new Date(`${logStartDate}T${logEndTime}`);
    // Manual entries are assumed same-day (Sandra, 2026-08-26: "the
    // assumption is that it's been worked in the same day, just date and
    // start and end time") -- there's no separate End date field anymore.
    // If the end time reads as before/equal to the start time, that means
    // the session ran past midnight; per Sandra's confirmed choice
    // ("Clamp/split at midnight"), clamp the logged entry to end of the
    // start day rather than reject the entry outright or silently wrap
    // it to the next day.
    let clampedAtMidnight = false;
    if (end <= start) {
      end = new Date(`${logStartDate}T23:59:59`);
      clampedAtMidnight = true;
    }
    const overlap = findOverlappingEntry(entries, me?.id ?? "", start.toISOString(), end.toISOString());
    if (overlap) {
      setLogOverlapEntry(overlap);
      return;
    }
    setLogSaving(true);
    const res = await submitManualTimeEntry(logTaskId, start.toISOString(), end.toISOString(), logReasonCategory, logNotes.trim() || logReasonCategory);
    setLogSaving(false);
    if (res.error) {
      setLogError(res.error);
      return;
    }
    setLogMode(null);
    setLogProjectId("");
    setLogTaskId("");
    setLogNotes("");
    setLogReasonCategory(reasonOptions.find((r) => r.is_active)?.name || "");
    await alert(
      clampedAtMidnight
        ? "Time entry submitted -- your end time was before the start time, so it was clamped to 11:59 PM the same day. It goes to your project owner (or their manager, if you own the project) for approval."
        : "Time entry submitted -- it goes to your project owner (or their manager, if you own the project) for approval."
    );
    loadAll();
  }

  // Sandra, 2026-08-26: a Done task shouldn't accept more logged time --
  // it's already gated the other direction too (marking Done requires
  // logged hours, see [[project_capaciq_wbs_batch_2026_08_26_part2]]), so
  // once it's Done, time tracking against it is finished.
  // Phase 26 (2026-08-28): ...and neither should a task whose project has
  // already been closed -- its Final Scope snapshot is frozen, so hours
  // logged after close-out would never show up anywhere. Mirrors
  // enforce_time_entry_baseline_lock's new closed-project branch.
  const loggableTasks = myTasks.filter((t) => t.project?.timelines_locked && t.project?.wbs_status !== "closed" && t.status !== "Done");
  const loggableProjectOptions = (() => {
    const seen = new Map<string, string>();
    for (const t of loggableTasks) {
      if (t.project && !seen.has(t.project.id)) seen.set(t.project.id, t.project.name);
    }
    return Array.from(seen, ([id, label]) => ({ id, label }));
  })();
  const loggableTasksForProject = loggableTasks.filter((t) => t.project_id === logProjectId).map((t) => ({ id: t.id, label: t.name }));

  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";

  // Every person who eventually reports up to me, at any depth -- not
  // just direct reports. Built once from the already-loaded active
  // `people` list (id/reports_to), same "walk the chain" idea
  // Approval Center already uses for decision authority, just breadth-
  // first downward instead of one hop upward.
  const myTeamIds = useMemo(() => {
    if (!me) return new Set<string>();
    const childrenOf = new Map<string, string[]>();
    for (const p of people) {
      if (p.reports_to) {
        const list = childrenOf.get(p.reports_to) ?? [];
        list.push(p.id);
        childrenOf.set(p.reports_to, list);
      }
    }
    const result = new Set<string>();
    const queue = [me.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const childId of childrenOf.get(current) ?? []) {
        if (!result.has(childId)) {
          result.add(childId);
          queue.push(childId);
        }
      }
    }
    return result;
  }, [me, people]);
  const isFullAccessPage = me?.access_level === "full";
  const hasTeam = myTeamIds.size > 0;

  // 2026-09-15 (Sandra: "add a filter by project in time tracking") --
  // narrows all three sections (Needs your decision / My entries / Team)
  // down to one project at a time. Reads/writes the ?project= URL param
  // so a link from elsewhere (e.g. Projects table's Spent Hrs cell) can
  // land here pre-filtered, and the filter stays bookmarkable/shareable.
  const entryProjectOptions = (() => {
    const seen = new Map<string, string>();
    for (const e of entries) {
      const proj = e.task?.project;
      if (proj && !seen.has(proj.id)) seen.set(proj.id, proj.name);
    }
    return Array.from(seen.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();
  const projectFilteredEntries = filterProjectId
    ? entries.filter((e) => e.task?.project?.id === filterProjectId)
    : entries;
  // 2026-09-23 (Sandra: "My Time / Team Time / All Time") -- the scope
  // tab narrows down to a set of people BEFORE the status cards/filter
  // are computed, so switching tabs re-scopes everything below it (the
  // KPI cards, the status filter counts, and the table) rather than just
  // the table rows.
  const scopeFilteredEntries =
    scope === "mine"
      ? projectFilteredEntries.filter((e) => e.person_id === me?.id)
      : scope === "team"
      ? projectFilteredEntries.filter((e) => myTeamIds.has(e.person_id))
      : projectFilteredEntries;
  const archivedFilteredEntries = showArchived ? scopeFilteredEntries : scopeFilteredEntries.filter((e) => !e.is_archived);

  // 2026-09-23 (Sandra, mockup redesign): Today/This Week KPI cards
  // always reflect the real current day/week -- unaffected by whatever
  // range someone's currently browsing in the date-range picker below.
  const todayKey = toDateInputValue();
  const thisWeekStartKey = toDateInputValue(startOfWeek(new Date()));
  const thisWeekEndKey = toDateInputValue(addDays(startOfWeek(new Date()), 6));
  const kpiCountedStatuses = new Set(["confirmed", "approved"]);
  const todayMinutes = archivedFilteredEntries
    .filter((e) => toDateInputValue(new Date(e.started_at)) === todayKey && kpiCountedStatuses.has(e.status))
    .reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
  const thisWeekMinutes = archivedFilteredEntries
    .filter((e) => {
      const key = toDateInputValue(new Date(e.started_at));
      return key >= thisWeekStartKey && key <= thisWeekEndKey && kpiCountedStatuses.has(e.status);
    })
    .reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
  const dailyTargetMinutes = (me?.daily_capacity_hours ?? 0) * 60;
  const weeklyTargetMinutes = dailyTargetMinutes * 5;

  // Date-range browser -- narrows the table + Total Entries/Needs
  // Attention KPIs (Today/This Week above are exempt, see comment).
  const [dateRangeStart, dateRangeEnd] = rangeForPreset(datePreset, rangeAnchor, customStart, customEnd);
  const dateFilteredEntries = archivedFilteredEntries.filter((e) => {
    const key = toDateInputValue(new Date(e.started_at));
    return key >= dateRangeStart && key <= dateRangeEnd;
  });

  // Needs Attention (Sandra: "combination of those not approved yet or
  // rejected -- anything except approved/confirmed, so they can see if
  // there's anything that's not been approved yet") -- everything still
  // in flight: awaiting the person's own confirmation, awaiting
  // approval, or rejected. Confirmed/approved are both "done" (just via
  // different lifecycles for timer vs manual entries), so neither counts.
  const needsAttentionStatuses = new Set(["pending_confirm", "pending_approval", "rejected"]);
  const needsAttentionCount = dateFilteredEntries.filter((e) => needsAttentionStatuses.has(e.status)).length;

  const statusCounts = {
    all: dateFilteredEntries.length,
    pending_approval: dateFilteredEntries.filter((e) => e.status === "pending_approval").length,
    approved: dateFilteredEntries.filter((e) => e.status === "approved").length,
    rejected: dateFilteredEntries.filter((e) => e.status === "rejected").length,
  };
  const statusFilteredEntries = statusFilter === "all" ? dateFilteredEntries : dateFilteredEntries.filter((e) => e.status === statusFilter);
  const sourceFilteredEntries = sourceFilter === "all" ? statusFilteredEntries : statusFilteredEntries.filter((e) => e.source === sourceFilter);
  const searchLower = searchText.trim().toLowerCase();
  const searchFilteredEntries = !searchLower
    ? sourceFilteredEntries
    : sourceFilteredEntries.filter((e) => {
        const haystack = [e.task?.name, e.task?.project?.name, e.activity_type?.name, e.reason_notes, e.reason_category, e.person?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(searchLower);
      });
  // Sort by (2026-09-23) -- when Group by date is on, this only controls
  // duration ordering within a day (date/time ordering is instead
  // governed by groupOrder + the always-chronological-within-day rule
  // below), so "date" sort options are hidden from the dropdown in that
  // mode (see render).
  const sortedEntries = [...searchFilteredEntries].sort((a, b) => {
    if (sortBy === "duration_desc") return (b.duration_minutes ?? 0) - (a.duration_minutes ?? 0);
    if (sortBy === "duration_asc") return (a.duration_minutes ?? 0) - (b.duration_minutes ?? 0);
    const at = new Date(a.started_at).getTime();
    const bt = new Date(b.started_at).getTime();
    return sortBy === "date_asc" ? at - bt : bt - at;
  });
  const filteredEntries = sortedEntries;

  // Group by date (Sandra: "allow them to group by dates -- always make
  // sure this is either newest to oldest or oldest to newest -- but time
  // should always be in chronological order from am to PM") -- the
  // group order (newest/oldest first) is a separate toggle from time
  // WITHIN a group, which is always ascending (earliest first, i.e. AM
  // before PM) regardless of groupOrder or the Sort by dropdown above.
  const groupedEntries: { dateKey: string; rows: EntryRow[] }[] = [];
  if (groupByDate) {
    const byDate = new Map<string, EntryRow[]>();
    for (const e of filteredEntries) {
      const key = toDateInputValue(new Date(e.started_at));
      const list = byDate.get(key) ?? [];
      list.push(e);
      byDate.set(key, list);
    }
    for (const rows of byDate.values()) {
      rows.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
    }
    const keys = Array.from(byDate.keys()).sort();
    if (groupOrder === "newest") keys.reverse();
    for (const key of keys) groupedEntries.push({ dateKey: key, rows: byDate.get(key)! });
  }

  // 2026-09-23 (Sandra: "task ID as the first column and immovable...
  // task/project, work date, time, duration, details, source, status,
  // action") -- rebuilt from the old fixed 9-column shape (which buried
  // the task number inside the Task/Project cell's subtitle and folded
  // Source into a small pill there too) into this explicit column list.
  // Assignee is included but only shown on Team Time/All Time -- on My
  // Time it's always you, so it'd be dead weight. This is a plain
  // hand-built table (not the reorderable DataTable), so "immovable"
  // for Task ID is just the default -- there's no drag-reorder here to
  // begin with.
  const ENTRY_TABLE_COL_WIDTHS_WITH_ASSIGNEE = ["8%", "16%", "10%", "9%", "11%", "7%", "17%", "7%", "8%", "7%"];
  const ENTRY_TABLE_COL_WIDTHS_NO_ASSIGNEE = ["8%", "20%", "10%", "12%", "8%", "20%", "8%", "8%", "6%"];
  function EntryTableColGroup({ showAssignee }: { showAssignee: boolean }) {
    const widths = showAssignee ? ENTRY_TABLE_COL_WIDTHS_WITH_ASSIGNEE : ENTRY_TABLE_COL_WIDTHS_NO_ASSIGNEE;
    return (
      <colgroup>
        {widths.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
      </colgroup>
    );
  }

  // 2026-09-23 (Sandra: "task ID as the first column and immovable...
  // task/project, work date, time, duration, details, source, status,
  // action") -- Task ID is its own column now instead of being buried in
  // the Task/Project cell's subtitle, and Source (Manual/Timer) is its
  // own column instead of a small pill there. Assignee only renders on
  // Team Time/All Time (see showAssignee) -- on My Time it's always you.
  // There's still no decision to make here (see Approval Center for
  // that), so Action shows the status pill + who/when it was decided,
  // plus the Correct button (Full Access only, on a confirmed/approved
  // entry) -- correcting expands an inline row below. Edit/Delete now
  // also cover a Rejected entry, not just a Pending one (see
  // canEditDeletePending) -- editing a Rejected entry resubmits it to
  // Pending server-side (phase74_migration.sql).
  function EntriesTable({ rows, showAssignee }: { rows: EntryRow[]; showAssignee: boolean }) {
    if (rows.length === 0) return null;
    const isFullAccess = me?.access_level === "full";
    const colCount = showAssignee ? 10 : 9;
    const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
    const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
    return (
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <EntryTableColGroup showAssignee={showAssignee} />
          <thead>
            <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Task ID</th>
              <th style={th}>Task / Project</th>
              {showAssignee && <th style={th}>Assignee</th>}
              <th style={th}>Work Date</th>
              <th style={th}>Time</th>
              <th style={th}>Duration</th>
              <th style={th}>Details</th>
              <th style={th}>Source</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canCorrect = isFullAccess && (row.status === "confirmed" || row.status === "approved") && !row.is_archived;
              const correcting = correctingId === row.id;
              const canEditDelete = canEditDeletePending(row);
              const editing = editingId === row.id;
              // 2026-09-23 (phase63): admin soft-delete for a
              // confirmed/approved entry, reversible.
              const canArchive = isFullAccess && (row.status === "confirmed" || row.status === "approved") && !row.is_archived;
              const canUnarchive = isFullAccess && row.is_archived;
              const archiving = archivingId === row.id;
              const isNonProject = Boolean(row.activity_type_id);
              const title = isNonProject ? row.activity_type?.name ?? "Non-project" : row.task?.name ?? "Untitled task";
              const subtitle = isNonProject ? "Non-project" : row.task?.project?.name ?? "—";
              const taskIdLabel = row.task?.task_number
                ? `T-${String(row.task.task_number).padStart(4, "0")}`
                : row.non_project_entry_number
                ? `NP-${String(row.non_project_entry_number).padStart(4, "0")}`
                : "—";
              const assigneeName = row.person?.name ?? personName(row.person_id);
              const details = row.reason_notes?.trim() || row.reason_category || "—";
              return (
                <Fragment key={row.id}>
                  <tr style={{ borderBottom: correcting || editing || archiving ? "none" : "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{taskIdLabel}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: "var(--navy)" }}>{title}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{subtitle}</div>
                    </td>
                    {showAssignee && (
                      <td style={td}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              display: "flex", alignItems: "center", justifyContent: "center",
                              width: 22, height: 22, borderRadius: "50%",
                              background: "var(--accent-bg, #eaf2fb)", color: "var(--accent)",
                              fontSize: 9.5, fontWeight: 700, flexShrink: 0,
                            }}
                          >
                            {initials(assigneeName)}
                          </span>
                          {assigneeName}
                        </div>
                      </td>
                    )}
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatWorkDate(row.started_at)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {formatClockRange(row.started_at, row.ended_at)}
                      {row.auto_stopped && (
                        <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2 }}>Auto-stopped after being idle</div>
                      )}
                    </td>
                    <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>
                      {formatDuration(row.duration_minutes)}
                      {row.corrected_at && row.original_duration_minutes !== row.duration_minutes && (
                        <span title={`Originally ${formatDuration(row.original_duration_minutes)}`} style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 600, color: "var(--muted)" }}>
                          (corrected)
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, maxWidth: 260, whiteSpace: "normal", wordBreak: "break-word" }}>
                      {details}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span className="status-pill neutral" style={{ fontSize: 9 }}>{SOURCE_LABEL[row.source]}</span>
                    </td>
                    <td style={{ ...td, minWidth: 140 }}>
                      <span className={`status-pill ${STATUS_TONE[row.status]}`}>{STATUS_LABEL[row.status]}</span>
                      {row.is_archived && (
                        <span className="status-pill slate" style={{ marginLeft: 4, fontSize: 9, padding: "1px 5px" }}>
                          Archived
                        </span>
                      )}
                      {row.status !== "pending_approval" && row.status !== "running" && row.status !== "pending_confirm" && row.decided_by && (
                        <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 4 }}>
                          by {personName(row.decided_by)} on {formatDate(row.decided_at)}
                          {row.decision_notes && <> — "{row.decision_notes}"</>}
                        </div>
                      )}
                      {row.corrected_at && (
                        <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 4 }}>
                          {row.original_duration_minutes !== row.duration_minutes ? (
                            <>Corrected from {formatDuration(row.original_duration_minutes)} to {formatDuration(row.duration_minutes)} by </>
                          ) : (
                            <>Reason corrected by </>
                          )}
                          {personName(row.corrected_by)} on {formatDate(row.corrected_at)}
                          {row.correction_notes && <> — "{row.correction_notes}"</>}
                        </div>
                      )}
                      {row.is_archived && (
                        <div style={{ fontSize: 9.5, color: "var(--danger-text)", marginTop: 4 }}>
                          Archived by {personName(row.archived_by)} on {formatDate(row.archived_at)}
                          {row.archive_reason && <> — "{row.archive_reason}"</>}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {(canCorrect || canArchive) && !correcting && !archiving && (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          {canCorrect && (
                            <button
                              onClick={() => setCorrectingId(row.id)}
                              title="Correct"
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                            >
                              <Pencil size={13} />
                            </button>
                          )}
                          {canArchive && (
                            <button
                              onClick={() => setArchivingId(row.id)}
                              title="Archive"
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--danger-text)", background: "none", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                            >
                              <Archive size={13} />
                            </button>
                          )}
                        </div>
                      )}
                      {canUnarchive && (
                        <button
                          onClick={() => submitUnarchive(row)}
                          title="Restore"
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                      {canEditDelete && !editing && (
                        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                          <button
                            onClick={() => setEditingId(row.id)}
                            title="Edit"
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDeletePending(row)}
                            title="Delete"
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--danger-text)", background: "none", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {archiving && (
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={colCount} style={{ padding: "8px 12px 12px", background: "var(--surface-2, #f8f9fb)" }}>
                        <ArchiveForm onSubmit={(reason) => submitArchive(row, reason)} onCancel={() => setArchivingId(null)} />
                      </td>
                    </tr>
                  )}
                  {canEditDelete && editing && (
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={colCount} style={{ padding: "8px 12px 12px", background: "var(--surface-2, #f8f9fb)" }}>
                        <EditForm
                          row={row}
                          isNonProject={isNonProject}
                          reasonOptions={reasonOptions}
                          nonProjectActivityTypes={nonProjectActivityTypes}
                          saving={editSaving}
                          onSubmit={(v) => submitEdit(row, v)}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {canCorrect && correcting && (
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={colCount} style={{ padding: "8px 12px 12px", background: "var(--surface-2, #f8f9fb)" }}>
                        <CorrectForm
                          row={row}
                          reasonOptions={reasonOptions}
                          nonProjectActivityTypes={nonProjectActivityTypes}
                          onSubmit={(v) => submitCorrection(row, v)}
                          onCancel={() => setCorrectingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      {confirmDialog}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ margin: 0 }}>Time Tracking</h1>
        {/* 2026-09-23 (Sandra: "let's revert to one button with dropdown
            so they can select if it's Project or Non project") -- a
            single Add Time button replaces the old always-visible Log
            time card; picking a mode from the dropdown opens the same
            form (unchanged fields/handlers) inside a Modal. */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setAddTimeMenuOpen((v) => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)",
              border: "none", borderRadius: 999, padding: "9px 16px", cursor: "pointer",
            }}
          >
            <Plus size={14} /> Add Time <ChevronDown size={13} />
          </button>
          {addTimeMenuOpen && (
            <div
              style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20,
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
                boxShadow: "var(--shadow-card, 0 6px 16px rgba(15,41,66,0.12))", minWidth: 170, overflow: "hidden",
              }}
            >
              {(["project", "non_project"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setLogMode(mode);
                    setAddTimeMenuOpen(false);
                  }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                    fontSize: 12.5, color: "var(--navy)", background: "none", border: "none", cursor: "pointer",
                  }}
                >
                  {mode === "project" ? "Project task" : "Non-project"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {logMode && (
        <Modal
          title={logMode === "project" ? "Log time — Project task" : "Log time — Non-project"}
          onClose={() => {
            setLogMode(null);
            setLogProjectId("");
            setLogTaskId("");
          }}
          width={480}
        >
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["project", "non_project"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setLogMode(mode)}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "8px 0",
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${logMode === mode ? "var(--accent)" : "var(--border)"}`,
                    background: logMode === mode ? "var(--accent-bg, #eaf2fb)" : "transparent",
                    fontSize: 12,
                    fontWeight: logMode === mode ? 600 : 500,
                    color: logMode === mode ? "var(--accent)" : "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  {mode === "project" ? "Project task" : "Non-project"}
                </button>
              ))}
            </div>
            {logMode && (
              <>
            {logMode === "non_project" ? (
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Activity type</span>
                <select
                  value={logActivityTypeId}
                  onChange={(e) => setLogActivityTypeId(e.target.value)}
                  style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
                >
                  {nonProjectActivityTypes
                    .filter((a) => a.is_active || a.id === logActivityTypeId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <>
                {/* Sandra, 2026-08-26: "allow project selection in the time
                    tracker then next will be task" -- Project first narrows
                    down which tasks show, then Task, both searchable. */}
                <label style={{ display: "block", marginBottom: 8 }}>
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Project</span>
                  <SearchSelect
                    placeholder="Choose a project…"
                    value={logProjectId}
                    onChange={(id) => {
                      setLogProjectId(id);
                      setLogTaskId("");
                    }}
                    options={loggableProjectOptions}
                  />
                </label>
                <label style={{ display: "block", marginBottom: 8 }}>
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Task (assigned to you)</span>
                  <SearchSelect
                    placeholder={logProjectId ? "Choose a task…" : "Choose a project first"}
                    value={logTaskId}
                    onChange={setLogTaskId}
                    disabled={!logProjectId}
                    options={loggableTasksForProject}
                  />
                  {loggableProjectOptions.length === 0 && (
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                      None of your tasks are loggable right now -- either their project's baseline hasn't been locked in WBS Planning, or they're already marked Done.
                    </span>
                  )}
                </label>
              </>
            )}
            {/* Sandra, 2026-08-26: "add in the time tracker a view for the
                user to see logged hours for the task selected, and due
                date" -- context while filling out the form, so someone
                logging time can see at a glance how much is already on
                the task and when it's due, without leaving this page.
                Logged hours only counts Confirmed/Approved entries (same
                rule Spent Hrs uses elsewhere -- see ownHoursFor). */}
            {logMode === "project" && logTaskId &&
              (() => {
                const selectedTask = myTasks.find((t) => t.id === logTaskId);
                const loggedMinutes = entries
                  .filter((e) => e.task_id === logTaskId && (e.status === "confirmed" || e.status === "approved") && !e.is_archived)
                  .reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
                const loggedHours = Math.round((loggedMinutes / 60) * 100) / 100;
                return (
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      fontSize: 11.5,
                      color: "var(--navy)",
                      background: "var(--surface-2, #f5f6f8)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "7px 10px",
                      marginBottom: 10,
                    }}
                  >
                    <span>
                      <strong>Logged so far:</strong> {loggedHours}h
                    </span>
                    <span>
                      <strong>Due:</strong> {selectedTask?.current_due_date ? formatDate(selectedTask.current_due_date) : "—"}
                    </span>
                  </div>
                );
              })()}
            {/* Sandra, 2026-08-26: "Start date" read as if it defaulted
                to today rather than the day the work actually happened --
                relabeled to "Log date" (the date being logged for) and
                collapsed Date/Start time/End time into one row so it
                reads as one work session rather than a start-day/end-day
                pair. */}
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ display: "block", marginBottom: 4, flex: 1.3 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Log date</span>
                <input
                  type="date"
                  value={logStartDate}
                  onChange={(e) => setLogStartDate(e.target.value)}
                  style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
                />
              </label>
              <label style={{ display: "block", marginBottom: 4, flex: 1 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Start time</span>
                <input
                  type="time"
                  value={logStartTime}
                  onChange={(e) => setLogStartTime(e.target.value)}
                  style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
                />
              </label>
              <label style={{ display: "block", marginBottom: 4, flex: 1 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>End time</span>
                <input
                  type="time"
                  value={logEndTime}
                  onChange={(e) => setLogEndTime(e.target.value)}
                  style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
                />
              </label>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 8 }}>Ends past midnight? It'll be clamped to 11:59 PM the same day.</div>
            {logMode === "project" && (
              <>
                <label style={{ display: "block", marginBottom: 8 }}>
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Reason</span>
                  <select
                    value={logReasonCategory}
                    onChange={(e) => setLogReasonCategory(e.target.value)}
                    style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
                  >
                    {reasonOptions
                      .filter((r) => r.is_active || r.name === logReasonCategory)
                      .map((r) => (
                        <option key={r.id} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                {logReasonCategory === "Other" && (
                  <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Specify</span>
                    <input
                      type="text"
                      value={logNotes}
                      onChange={(e) => setLogNotes(e.target.value)}
                      placeholder="What happened?"
                      style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
                    />
                  </label>
                )}
                {logReasonCategory !== "Other" && (
                  <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>Additional details (optional)</span>
                    <input
                      type="text"
                      value={logNotes}
                      onChange={(e) => setLogNotes(e.target.value)}
                      style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
                    />
                  </label>
                )}
              </>
            )}
            {logMode === "non_project" &&
              (() => {
                const activityType = nonProjectActivityTypes.find((a) => a.id === logActivityTypeId);
                const notesRequired = activityType?.name === "Others";
                return (
                  <label style={{ display: "block", marginBottom: 10 }}>
                    <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>
                      Notes {notesRequired ? "(required for Others)" : "(optional)"}
                    </span>
                    <input
                      type="text"
                      value={logNotes}
                      onChange={(e) => setLogNotes(e.target.value)}
                      placeholder={notesRequired ? "What was this?" : "e.g. Weekly team sync"}
                      style={{ width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
                    />
                  </label>
                );
              })()}
            {logError && <div style={{ color: "var(--danger-text)", fontSize: 11.5, marginBottom: 8 }}>{logError}</div>}
            {logOverlapEntry && (
              <div
                style={{
                  color: "var(--danger-text)", fontSize: 11.5, marginBottom: 8, padding: "8px 10px",
                  background: "var(--danger-bg)", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Time overlap detected</div>
                <div>You already have a logged entry for this period:</div>
                <div>Task ID: {overlapTaskIdLabel(logOverlapEntry)}</div>
                <div>Task: {overlapTitle(logOverlapEntry)}</div>
                <div>Time: {formatClockRange(logOverlapEntry.started_at, logOverlapEntry.ended_at)}</div>
                <div>Status: {STATUS_LABEL[logOverlapEntry.status]}</div>
                <div style={{ marginTop: 4 }}>Please adjust the start or end time.</div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleSubmitManual}
                disabled={logSaving}
                style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer" }}
              >
                {logSaving ? "Submitting…" : "Submit for approval"}
              </button>
              <button
                onClick={() => {
                  setLogMode(null);
                  setLogProjectId("");
                  setLogTaskId("");
                }}
                style={{ fontSize: 12, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
              </>
            )}
        </Modal>
      )}

      {loading ? (
        <div style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>
      ) : (
        <>
          {/* 2026-09-23 (Sandra: "My Time / Team Time / All Time" -- a
              regular employee should primarily see their own time, a
              manager should be able to see their own time plus whoever's
              in their reporting chain, and Full Access keeps
              organization-wide visibility -- but nobody should be
              dropped into hundreds of unrelated rows by default). Team
              Time only shows up once someone actually manages people
              (hasTeam, walked from reports_to); All Time only shows up
              for Full Access (isFullAccessPage), reusing the exact same
              access_level check every other admin-only view already
              uses. My Time is always available and is the default. */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {(
              [
                { key: "mine" as const, label: "My Time" },
                ...(hasTeam ? [{ key: "team" as const, label: "Team Time" }] : []),
                ...(isFullAccessPage ? [{ key: "all" as const, label: "All Time" }] : []),
              ]
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setScope(tab.key)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-sm)",
                  border: `1px solid ${scope === tab.key ? "var(--accent)" : "var(--border)"}`,
                  background: scope === tab.key ? "var(--accent-bg, #eaf2fb)" : "transparent",
                  fontSize: 12.5,
                  fontWeight: scope === tab.key ? 600 : 500,
                  color: scope === tab.key ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 2026-09-23 (Sandra mockup redesign) -- Today/This Week
              always reflect the real current day/week (no target line
              shown ON the card per her instruction -- the target/range
              reads as a caption underneath instead); Total Entries and
              Needs Attention both reflect whatever date range + filters
              are currently active below. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 4, marginBottom: 14 }}>
            {[
              {
                key: "today",
                icon: <Timer size={15} />,
                tone: "slate",
                label: "Today's Logs",
                value: `${(Math.round((todayMinutes / 60) * 100) / 100).toFixed(2)}h`,
                caption: dailyTargetMinutes > 0 ? `of ${(dailyTargetMinutes / 60).toFixed(2)}h target` : undefined,
              },
              {
                key: "week",
                icon: <CalendarDays size={15} />,
                tone: "slate",
                label: "This Week",
                value: `${(Math.round((thisWeekMinutes / 60) * 100) / 100).toFixed(2)}h`,
                caption: weeklyTargetMinutes > 0 ? `of ${(weeklyTargetMinutes / 60).toFixed(2)}h target` : undefined,
              },
              {
                key: "total",
                icon: <ListChecks size={15} />,
                tone: "accent",
                label: "Total Entries",
                value: String(statusCounts.all),
                caption: formatRangeLabel(dateRangeStart, dateRangeEnd),
              },
              {
                key: "attention",
                icon: <AlertCircle size={15} />,
                tone: needsAttentionCount > 0 ? "warning" : "slate",
                label: "Needs Attention",
                value: String(needsAttentionCount),
                caption: "Pending, awaiting confirmation, or rejected",
              },
            ].map((card) => (
              <div
                key={card.key}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "14px 16px", borderRadius: 16, border: "1px solid var(--border)",
                  background: "var(--surface)", boxShadow: "var(--shadow-card, 0 1px 2px rgba(15,41,66,0.04))",
                }}
              >
                <span
                  className={`status-pill ${card.tone}`}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 12, flexShrink: 0 }}
                >
                  {card.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>{card.label}</div>
                  <div style={{ fontSize: 19, fontWeight: 700, color: "var(--navy)", lineHeight: 1.2 }}>{card.value}</div>
                  {card.caption && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{card.caption}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Date-range browser -- Today/This Week/Last Week/This
              Month/Custom presets + step arrows; narrows Total
              Entries/Needs Attention above and the table below (Today/
              This Week KPI cards are exempt, they always track the real
              calendar). */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {(
              [
                { key: "today" as const, label: "Today" },
                { key: "this_week" as const, label: "This Week" },
                { key: "last_week" as const, label: "Last Week" },
                { key: "this_month" as const, label: "This Month" },
                { key: "custom" as const, label: "Custom" },
              ]
            ).map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  setDatePreset(p.key);
                  setRangeAnchor(new Date());
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  border: `1px solid ${datePreset === p.key ? "var(--accent)" : "var(--border)"}`,
                  background: datePreset === p.key ? "var(--accent-bg, #eaf2fb)" : "transparent",
                  fontSize: 11.5,
                  fontWeight: datePreset === p.key ? 600 : 500,
                  color: datePreset === p.key ? "var(--accent)" : "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                {p.label}
              </button>
            ))}
            {datePreset === "custom" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  style={{ fontSize: 11.5, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 8 }}
                />
                <span style={{ color: "var(--muted)", fontSize: 11.5 }}>to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  style={{ fontSize: 11.5, padding: "5px 7px", border: "1px solid var(--border)", borderRadius: 8 }}
                />
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
                <button
                  onClick={() => setRangeAnchor((a) => stepAnchor(datePreset, a, -1))}
                  style={{ display: "flex", padding: 4, border: "1px solid var(--border)", borderRadius: 8, background: "none", cursor: "pointer", color: "var(--text-secondary)" }}
                >
                  <ChevronLeft size={13} />
                </button>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)", minWidth: 130, textAlign: "center" }}>
                  {formatRangeLabel(dateRangeStart, dateRangeEnd)}
                </span>
                <button
                  onClick={() => setRangeAnchor((a) => stepAnchor(datePreset, a, 1))}
                  style={{ display: "flex", padding: 4, border: "1px solid var(--border)", borderRadius: 8, background: "none", cursor: "pointer", color: "var(--text-secondary)" }}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}
          </div>

          {/* Filter row -- search, status, source, project, sort, group
              by date, and a More Filters popover (currently just an
              Archived-visibility toggle). "You tell me what's works
              best" (Sandra) -- these mechanics are my call; the KPI
              definitions above and grouping semantics were hers. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180, maxWidth: 280 }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search task, project, details…"
                style={{ width: "100%", fontSize: 12, padding: "7px 9px 7px 28px", border: "1px solid var(--border)", borderRadius: 10, boxSizing: "border-box" }}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              style={{ fontSize: 12, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 10 }}
            >
              <option value="all">All Statuses</option>
              <option value="pending_approval">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as typeof sourceFilter)}
              style={{ fontSize: 12, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 10 }}
            >
              <option value="all">All Sources</option>
              <option value="manual">Manual</option>
              <option value="timer">Timer</option>
            </select>
            <div style={{ width: 190 }}>
              <SearchSelect
                placeholder="All projects"
                value={filterProjectId}
                onChange={(id) => setSearchParams(id ? { project: id } : {})}
                options={entryProjectOptions}
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{ fontSize: 12, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 10 }}
            >
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="duration_desc">Longest duration</option>
              <option value="duration_asc">Shortest duration</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
              <input type="checkbox" checked={groupByDate} onChange={(e) => setGroupByDate(e.target.checked)} />
              Group by date
            </label>
            {groupByDate && (
              <button
                onClick={() => setGroupOrder((o) => (o === "newest" ? "oldest" : "newest"))}
                title="Toggle group order"
                style={{ fontSize: 11.5, color: "var(--text-secondary)", background: "none", border: "1px solid var(--border)", borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}
              >
                {groupOrder === "newest" ? "Newest first" : "Oldest first"}
              </button>
            )}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setMoreFiltersOpen((v) => !v)}
                style={{ fontSize: 11.5, color: "var(--text-secondary)", background: "none", border: "1px solid var(--border)", borderRadius: 10, padding: "7px 10px", cursor: "pointer" }}
              >
                More Filters
              </button>
              {moreFiltersOpen && (
                <div
                  style={{
                    position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20,
                    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
                    boxShadow: "var(--shadow-card, 0 6px 16px rgba(15,41,66,0.12))", padding: 12, minWidth: 200,
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                    Show archived entries
                  </label>
                </div>
              )}
            </div>
            {(filterProjectId || searchText || statusFilter !== "all" || sourceFilter !== "all" || showArchived) && (
              <button
                onClick={() => {
                  setSearchParams({});
                  setSearchText("");
                  setStatusFilter("all");
                  setSourceFilter("all");
                  setShowArchived(false);
                }}
                style={{ fontSize: 11, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Reset filters
              </button>
            )}
          </div>

          {/* 2026-09-23 (Sandra: "all approvals will not go to Approval
              Center only" -- decisions happen exclusively in Approval
              Center now, so this page no longer has its own "Needs your
              decision" list) -- one table now, scoped by the My
              Time/Team Time/All Time tab above instead of the old flat
              My entries/Other visible entries split. Assignee only
              shows outside My Time, since on My Time it's always you. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, marginBottom: 8 }}>
            <ShieldCheck size={14} color="var(--accent)" />
            <h2 style={{ margin: 0, fontSize: 13 }}>
              {scope === "mine" ? "My entries" : scope === "team" ? "Team entries" : "All entries"} ({filteredEntries.length})
            </h2>
          </div>
          {filteredEntries.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>No time logged for this range.</p>
          ) : groupByDate ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {groupedEntries.map((g) => (
                <div key={g.dateKey}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>
                    {formatRangeLabel(g.dateKey, g.dateKey)} <span style={{ fontWeight: 500, color: "var(--muted)" }}>({g.rows.length})</span>
                  </div>
                  <EntriesTable rows={g.rows} showAssignee={scope !== "mine"} />
                </div>
              ))}
            </div>
          ) : (
            <EntriesTable rows={filteredEntries} showAssignee={scope !== "mine"} />
          )}
        </>
      )}
    </div>
  );
}
