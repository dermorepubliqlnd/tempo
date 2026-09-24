import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ShieldCheck, ChevronRight, ChevronLeft, ChevronDown, Pencil, Timer, Trash2, Archive, RotateCcw, Plus, Search, X, CalendarDays, AlertCircle, ListChecks, Radio, FilePen } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { formatDate } from "../lib/formatDate";
import { FOLLOW_UP_REASON_LABEL, type FollowUpReason, timeLogId, formatDuration, submitManualTimeEntry, submitNonProjectTimeEntry, correctTimeEntry, requestTimeEntryCorrection, cancelTimeEntryCorrection, editPendingManualTimeEntry } from "../lib/timeTracking";
import { archiveItem, ARCHIVE_MOVE_NOTE } from "../lib/archive";
import { loggedHoursTier } from "../lib/loggedHoursBands";
import { expectedHoursForDay } from "../lib/dailyAllocation";
import { buildHolidayNameMap, nonWorkingDayConfirmMessage, type HolidayNameMap } from "../lib/workingDays";
import { useSearchParams } from "react-router-dom";
import MultiSelectFilter from "../components/MultiSelectFilter";
import Modal from "../components/Modal";

interface PersonLite {
  id: string;
  name: string;
  reports_to: string | null;
}

// 2026-09-23 (Team Time supervisor view, Sandra's "Working Now" spec) --
// shape returned by the new get_team_running_timers() RPC
// (supabase/phase85_migration.sql). Flat/display-ready (already joined
// to people/tasks/projects server-side) so no extra client-side lookups
// are needed, and SECURITY DEFINER-scoped to the caller's own
// reports_to subtree (or everyone, for Full Access) -- never the whole
// org for a regular supervisor.
interface TeamRunningTimer {
  entry_id: string;
  person_id: string;
  person_name: string;
  task_id: string | null;
  task_name: string | null;
  task_number: number | null;
  project_id: string | null;
  project_name: string | null;
  started_at: string;
}

// Shape returned by get_team_required_hours() -- one row per
// person/day in the requested range, already applying the same
// off(0)/holiday(0)/half-day(50%)/full-rate rule as
// expectedHoursForDay, and the same visibility scoping as above.
interface TeamRequiredHoursRow {
  person_id: string;
  person_name: string;
  date: string;
  is_holiday: boolean;
  expected_hours: number;
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
  // 2026-09-23 (phase102): corrections change start/end now -- the
  // pre-correction window is kept here (first correction wins).
  original_started_at: string | null;
  original_ended_at: string | null;
  correction_requested_by: string | null;
  // 2026-09-24 (phase110): follow-up time on a Done task.
  is_follow_up: boolean;
  follow_up_reason: FollowUpReason | null;
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
  entry_number: number | null;
  task: TaskLite | null;
  activity_type: { id: string; name: string } | null;
  person: { id: string; name: string } | null;
}

// 2026-09-23 (phase102, phase 2): employee-initiated correction request
// on their own confirmed/approved entry, decided in the Approval Center.
interface CorrectionRequestRow {
  id: string;
  entry_id: string;
  requested_by: string;
  current_started_at: string;
  current_ended_at: string;
  proposed_started_at: string;
  proposed_ended_at: string;
  proposed_activity_type_id: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  created_at: string;
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
// 2026-09-23 (Sandra: "add colors to the manual and timer - Manual
// Yellow, Timer Green - to all") -- reuses the existing .status-pill
// gold/mint tones (already pale-bg/dark-text) rather than inventing a
// new color pair.
const SOURCE_TONE: Record<string, string> = { timer: "mint", manual: "gold", legacy: "neutral" };

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
// 2026-09-23 (phase102): every conflicting entry, not just the first --
// a correction that widens an entry can run into more than one.
function findAllOverlappingEntries(entries: EntryRow[], personId: string, startIso: string, endIso: string, excludeId?: string): EntryRow[] {
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return entries.filter((row) => {
    if (row.person_id !== personId || row.id === excludeId || row.is_archived) return false;
    if (!OVERLAP_BLOCKING_STATUSES.has(row.status)) return false;
    const rs = new Date(row.started_at).getTime();
    const re = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
    return s < re && rs < e;
  });
}
// Why a conflicting entry can't simply be trimmed to fit (mirrors
// apply_time_entry_correction's server-side rules) -- null = trimmable.
function untrimmableReason(row: EntryRow, startIso: string, endIso: string): string | null {
  if (row.status !== "confirmed" && row.status !== "approved") return "it's still pending -- the owner can edit it directly";
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  const rs = new Date(row.started_at).getTime();
  const re = row.ended_at ? new Date(row.ended_at).getTime() : Date.now();
  if (rs >= s && re <= e) return "it sits entirely inside the corrected time -- archive or adjust it first";
  if (rs < s && re > e) return "it fully surrounds the corrected time -- trimming would split it";
  return null;
}
function trimmedRangeText(row: EntryRow, startIso: string, endIso: string): string {
  const rs = new Date(row.started_at).getTime();
  const s = new Date(startIso).getTime();
  return rs < s
    ? formatClockRange(row.started_at, startIso)
    : formatClockRange(endIso, row.ended_at);
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
  return `Time overlap detected\n\nYou already have a logged entry for this period:\nLog ID: ${timeLogId(row.entry_number)}\nTask ID: ${overlapTaskIdLabel(row)}\nTask: ${overlapTitle(row)}\nTime: ${formatClockRange(row.started_at, row.ended_at)}\nStatus: ${STATUS_LABEL[row.status]}\n\nPlease adjust the start or end time.`;
}

// 2026-09-23 (Sandra: "can we hard gate manual plotting time in
// advance?... Time entries can only be logged for time that has
// already passed") -- a manual/non-project entry can only cover work
// that's actually happened, so either edge landing in the future blocks
// the whole entry (not just clamps it) -- distinct from the existing
// past-midnight clamp, which only kicks in when END <= START on the
// same log date.
function isFutureTimeEntry(startIso: string, endIso: string): boolean {
  const now = Date.now();
  return new Date(startIso).getTime() > now || new Date(endIso).getTime() > now;
}
const FUTURE_ENTRY_MESSAGE_TEXT = "Future time entry not allowed\n\nTime entries can only be logged for time that has already passed.";

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
// 2026-09-23 (Sandra: persist filters/sort/grouping preference across
// refresh). Kept deliberately small/serializable -- rangeAnchor (a Date)
// and per-session-only things like expandedDateGroups are NOT persisted,
// so "Today"/"This Week"/etc. always resolve relative to the real
// current date rather than replaying a stale anchor from days ago.
interface TimeTrackingPrefs {
  scope: "mine" | "team" | "all";
  statusFilter: "all" | "pending_approval" | "approved" | "rejected";
  sourceFilter: "all" | "manual" | "timer";
  sortBy: "date_desc" | "date_asc";
  groupByDate: boolean;
  datePreset: "today" | "this_week" | "last_week" | "this_month" | "custom";
  customStart: string;
  customEnd: string;
}
const TT_PREFS_KEY = "capaciq.timeTracking.prefs.v1";
function loadTimeTrackingPrefs(): Partial<TimeTrackingPrefs> {
  try {
    const raw = localStorage.getItem(TT_PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveTimeTrackingPrefs(prefs: TimeTrackingPrefs): void {
  try {
    localStorage.setItem(TT_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore -- private browsing / blocked storage, nothing to persist to
  }
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

// 2026-09-23 (phase102, Sandra: "should correction update start and end
// time instead of add/subtract duration?") -- one form, two modes:
//   - "correct": Full Access fixes a confirmed/approved entry directly.
//   - "request": the entry's owner proposes new times + a reason; it
//     goes to the Approval Center.
// Both edit date + start + end (duration is derived); notes/reason are
// required. Reason Category (project) / Activity Type (non-project) stay
// correctable in "correct" mode, same branch as before (phase63).
function CorrectionForm({
  row,
  mode,
  reasonOptions,
  nonProjectActivityTypes,
  onSubmit,
  onCancel,
}: {
  row: EntryRow;
  mode: "correct" | "request";
  reasonOptions: TimeEntryReasonRow[];
  nonProjectActivityTypes: NonProjectActivityTypeRow[];
  onSubmit: (v: { date: string; startTime: string; endTime: string; notes: string; reasonCategory: string; activityTypeId: string }) => void;
  onCancel: () => void;
}) {
  const start = new Date(row.started_at);
  const end = row.ended_at ? new Date(row.ended_at) : start;
  const [date, setDate] = useState(toDateInputValue(start));
  const [startTime, setStartTime] = useState(toTimeInputValue(start));
  const [endTime, setEndTime] = useState(toTimeInputValue(end));
  const [notes, setNotes] = useState("");
  const [reasonCategory, setReasonCategory] = useState(row.reason_category ?? "");
  const [activityTypeId, setActivityTypeId] = useState(row.activity_type_id ?? "");
  const isNonProject = Boolean(row.activity_type_id);
  const inputStyle: CSSProperties = { fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" };
  const previewStart = new Date(`${date}T${startTime}`);
  const previewEnd = new Date(`${date}T${endTime}`);
  const previewMinutes = isNaN(previewStart.getTime()) || isNaN(previewEnd.getTime()) ? null : Math.round((previewEnd.getTime() - previewStart.getTime()) / 60000);
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginBottom: 6 }}>
        {mode === "correct" ? "Correct the actual start and end time" : "Propose the correct start and end time"} — currently{" "}
        <strong>{formatClockRange(row.started_at, row.ended_at)}</strong> ({formatDuration(row.duration_minutes)})
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>to</span>
        <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 11, fontWeight: 700, color: previewMinutes !== null && previewMinutes > 0 ? "var(--navy)" : "var(--danger-text)", minWidth: 48 }}>
          {previewMinutes !== null && previewMinutes > 0 ? `= ${formatDuration(previewMinutes)}` : "—"}
        </span>
        {isNonProject ? (
          <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} style={{ ...inputStyle, width: 150 }}>
            {nonProjectActivityTypes.filter((a) => a.is_active || a.id === activityTypeId).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        ) : mode === "correct" ? (
          <select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)} style={{ ...inputStyle, width: 150 }}>
            <option value="">No reason</option>
            {reasonOptions.filter((r) => r.is_active || r.name === reasonCategory).map((r) => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
        ) : null}
        <input
          type="text"
          placeholder={mode === "correct" ? "Correction reason (required)" : "Why does this need correcting? (required)"}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ ...inputStyle, flex: "1 1 200px" }}
        />
        <button
          onClick={() => onSubmit({ date, startTime, endTime, notes, reasonCategory, activityTypeId })}
          style={{ fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          {mode === "correct" ? "Save correction" : "Submit request"}
        </button>
        <button onClick={onCancel} style={{ fontSize: 11.5, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
          Cancel
        </button>
      </div>
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
  // 2026-09-23 (phase102, phase 2): owner-initiated correction requests.
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequestRow[]>([]);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  // 2026-09-22 (Sandra: "let's allow the assignee or requestor to delete
  // or make changes with the manual time entry log" while it's still
  // pending_approval) -- separate from correctingId above, which is the
  // Full-Access-only correction flow for an already-decided entry.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  // 2026-09-23 (Sandra: "remember users last option of filters, right
  // now when i refresh i lose my filters and grouping preference") --
  // loaded once (lazy useState initializer) and re-saved on every change
  // below. Wrapped in try/catch since localStorage can throw (private
  // browsing, blocked storage) -- a failed read/write just means the
  // page falls back to its normal defaults instead of crashing.
  const [ttPrefs] = useState<Partial<TimeTrackingPrefs>>(loadTimeTrackingPrefs);

  // Status filter (2026-09-19, Sandra: "fix the time tracking page to not
  // make it boring") -- same clickable metric-card filter as the
  // Extension Requests and Approval Center pages.
  const [statusFilter, setStatusFilter] = useState<"all" | "pending_approval" | "approved" | "rejected">(ttPrefs.statusFilter ?? "all");
  // 2026-09-23 (Sandra: "My Time / Team Time / All Time" -- reworked the
  // old flat My entries/Other visible entries split into three scopes
  // that adapt to who's looking. My Time is everyone's default. Team
  // Time only appears for someone who manages at least one person
  // (walking the reports_to chain all the way down, not just direct
  // reports -- see myTeamIds below). All Time only appears for Full
  // Access, reusing the same access_level check used everywhere else.
  // 2026-09-23 (Sandra: "as an end user...I should get end user rank and
  // file experience...should be the same for everyone" -- My Dashboard's
  // Missing hours pill was routing here and landing on whatever Team/All
  // scope was last viewed instead of My Time) -- an explicit ?scope=
  // param (set once, from the URL at load) always wins over the saved
  // preference, so a link built as /time-tracking?scope=mine reliably
  // lands on My Time for every person, regardless of what they'd last
  // left this page on.
  const scopeParam = searchParams.get("scope") as "mine" | "team" | "all" | null;
  const [scope, setScope] = useState<"mine" | "team" | "all">(scopeParam ?? ttPrefs.scope ?? "mine");

  // 2026-09-23 (Sandra: mockup-driven redesign -- search/filters/sort,
  // date-range browsing, group-by-date, a single Add Time button) --
  // Source/search/sort/grouping are new; statusFilter above is reused
  // but now driven by a real <select> in the filter row instead of the
  // old clickable status-count cards (those cards are gone -- replaced
  // by the Today/This Week/Total Entries/Needs Attention KPI row).
  const [sourceFilter, setSourceFilter] = useState<"all" | "manual" | "timer">(ttPrefs.sourceFilter ?? "all");
  const [filterProjectIds, setFilterProjectIds] = useState<string[]>(() => (searchParams.get("project") ? [searchParams.get("project") as string] : []));
  const [filterMemberIds, setFilterMemberIds] = useState<string[]>([]);
  const [logTypeFilter, setLogTypeFilter] = useState<"all" | "project" | "non_project">("all");
  const [searchText, setSearchText] = useState("");
  // 2026-09-23 (Sandra: "remove shortest and longest duration in the
  // sort for all... if grouped by dates, allow sorting by date but
  // retain the time to be in chronological order" -- duration sort
  // options removed; this single date_desc/date_asc value now also
  // drives date-GROUP order when groupByDate is on (see groupedEntries
  // below), replacing the separate "Newest/Oldest first" pill Sandra
  // found confusing, since entries WITHIN a group always stay
  // chronological regardless of this setting).
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc">(ttPrefs.sortBy ?? "date_desc");
  const [groupByDate, setGroupByDate] = useState(ttPrefs.groupByDate ?? false);
  // 2026-09-23 (Sandra: "auto collapse first then allow expand" for any
  // grouped-by-date view besides Today) -- a date group's rows are
  // hidden until its header is clicked; not persisted across reloads
  // (session-only), unlike the filter/sort/grouping prefs above.
  const [expandedDateGroups, setExpandedDateGroups] = useState<Set<string>>(new Set());

  // Date-range browser (Today/This Week/Last Week/This Month/Custom +
  // prev/next arrows), same idea as a calendar app's range picker.
  // datePreset drives which range function applies to rangeAnchor;
  // clicking a preset button resets the anchor to today, the arrows
  // step the anchor by that preset's unit (day/week/month). This is
  // separate from the Today/This Week KPI cards below, which always
  // reflect the real current day/week regardless of what's being
  // browsed here.
  // "last_week" was retired as a button 2026-09-24 -- a saved pref for it
  // opens as Week (the < arrow reaches last week in one click).
  const [datePreset, setDatePreset] = useState<"today" | "this_week" | "last_week" | "this_month" | "custom">(
    ttPrefs.datePreset === "last_week" ? "this_week" : ttPrefs.datePreset ?? "this_week"
  );
  const [rangeAnchor, setRangeAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(() => ttPrefs.customStart ?? toDateInputValue());
  const [customEnd, setCustomEnd] = useState(() => ttPrefs.customEnd ?? toDateInputValue());

  useEffect(() => {
    saveTimeTrackingPrefs({ scope, statusFilter, sourceFilter, sortBy, groupByDate, datePreset, customStart, customEnd });
  }, [scope, statusFilter, sourceFilter, sortBy, groupByDate, datePreset, customStart, customEnd]);

  // Add Time (2026-09-23, Sandra: "let's revert to one button with
  // dropdown so they can select if it's Project or Non project") --
  // replaces the old always-visible "Log time" card + inline Project
  // task/Non-project toggle with a single button, a small dropdown to
  // pick the mode, and the same form fields now inside a Modal.
  const [addTimeMenuOpen, setAddTimeMenuOpen] = useState(false);
  // 2026-09-23 (Sandra: "add a highlight when hovering on the options so
  // the user can see which one they are selecting") -- inline styles
  // can't do :hover, so this tracks which dropdown option the pointer is
  // currently over.
  const [addTimeHoverMode, setAddTimeHoverMode] = useState<"project" | "non_project" | null>(null);

  // 2026-09-22 (Sandra: non-project time -- meetings, team huddles --
  // shouldn't have to fake a task under a real project): toggle at the
  // top of this same form swaps the Project/Task pickers for an
  // Activity Type picker instead. Everything else (date/start/end,
  // notes, the pending_approval lifecycle) is unchanged.
  const [logMode, setLogMode] = useState<"project" | "non_project" | null>(null);
  // 2026-09-24: My Dashboard's Add Time button links here with
  // ?add=project|non_project -- open that form once, then drop the param
  // so a refresh doesn't reopen it.
  useEffect(() => {
    const add = searchParams.get("add");
    if (add === "project" || add === "non_project") {
      setLogMode(add);
      const next = new URLSearchParams(searchParams);
      next.delete("add");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [nonProjectActivityTypes, setNonProjectActivityTypes] = useState<NonProjectActivityTypeRow[]>([]);
  const [logActivityTypeId, setLogActivityTypeId] = useState("");
  const [logProjectId, setLogProjectId] = useState("");
  const [logTaskId, setLogTaskId] = useState("");
  const [logStartDate, setLogStartDate] = useState(toDateInputValue());
  const [logStartTime, setLogStartTime] = useState(toTimeInputValue());
  const [logEndTime, setLogEndTime] = useState(toTimeInputValue());
  const [reasonOptions, setReasonOptions] = useState<TimeEntryReasonRow[]>([]);
  // 2026-09-23 (dynamic expected hours): my own approved half-day/off
  // days + holidays, so Today's Logs/This Week's "of Xh target" caption
  // and banding reflect what I was ACTUALLY expected to log today/this
  // week, not a flat daily_capacity_hours * 5 assumption. Only ever
  // needed for the current person (these two KPI cards are My Time-only
  // per Phase 81's scope guard), so this is a small, cheap query.
  const [myAvailability, setMyAvailability] = useState<{ date: string; status: "off" | "half_day" }[]>([]);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());
  const [holidayNames, setHolidayNames] = useState<HolidayNameMap>(new Map());
  // 2026-09-23 (Team Time supervisor view) -- Working Now (currently
  // running timers across the caller's team) + Team Required Hours
  // (per-person/day expected hours, for the Today's Logged/This Week
  // KPI cards' denominators on the Team/All Time tabs). Both come from
  // new SECURITY DEFINER RPCs (see supabase/phase85_migration.sql) so
  // visibility is enforced server-side, not just by hiding UI -- see
  // [[project_capaciq_time_tracking_bands_compliance_and_prefs_2026_09_23]]
  // for why Team/All Time never reuse the single-person daily bands.
  const [teamRunningTimers, setTeamRunningTimers] = useState<TeamRunningTimer[]>([]);
  const [teamRequiredHours, setTeamRequiredHours] = useState<TeamRequiredHoursRow[]>([]);
  // Ticks every 30s purely to re-render Working Now's elapsed-time
  // labels ("42m", "1h 13m") without needing a fresh network fetch --
  // the actual timer LIST is refreshed separately (see the polling
  // effect below), mirroring TimeTrackingContext's existing 60s-poll
  // pattern rather than introducing realtime infrastructure.
  const [nowTick, setNowTick] = useState(() => Date.now());
  // 2026-09-23 (Sandra: "when the user click on the working now header
  // allow collapse and expand") -- mirrors the date-group header
  // convention below (whole header row is the click target, chevron is
  // just the indicator). Defaults open since it's usually a short list
  // and is the most time-sensitive info on the page.
  const [workingNowExpanded, setWorkingNowExpanded] = useState(true);
  const [logReasonCategory, setLogReasonCategory] = useState("");
  const [logNotes, setLogNotes] = useState("");
  const [logError, setLogError] = useState<string | null>(null);
  // 2026-09-23 (Sandra: overlap flagging) -- holds the conflicting entry
  // so the Add Time modal can render her exact "Time overlap detected"
  // message format (bold heading + field lines) instead of a plain string.
  const [logOverlapEntry, setLogOverlapEntry] = useState<EntryRow | null>(null);
  // 2026-09-23 (Sandra: hard gate on future-dated manual entries).
  const [logFutureBlocked, setLogFutureBlocked] = useState(false);
  const [logSaving, setLogSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [{ data: entryData }, { data: peopleData }, { data: taskData }, { data: reasonData }, { data: activityTypeData }, { data: availabilityData }, { data: holidayData }, { data: correctionRequestData }] = await Promise.all([
      supabase
        .from("time_entries")
        .select(
          `id, task_id, activity_type_id, person_id, started_at, ended_at, duration_minutes, source, status, requested_by, reason_category, reason_notes, auto_stopped,
           decided_by, decided_at, decision_notes, corrected_by, corrected_at, original_duration_minutes, correction_notes, created_at,
           original_started_at, original_ended_at, correction_requested_by, is_follow_up, follow_up_reason,
           is_archived, archived_at, archived_by, archive_reason, non_project_entry_number, entry_number,
           task:tasks ( id, name, assignee_id, project_id, task_number, project:projects ( id, name, owner_id ) ),
           activity_type:non_project_activity_types ( id, name ),
           person:people!time_entries_person_id_fkey ( id, name )`
        )
        .order("started_at", { ascending: false }),
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("tasks").select("id,name,assignee_id,project_id,current_due_date,status,task_number,project:projects(id,name,owner_id,timelines_locked,wbs_status)").eq("is_archived", false),
      supabase.from("time_entry_reasons").select("id,name,is_active").order("sort_order"),
      supabase.from("non_project_activity_types").select("id,name,is_active").order("sort_order"),
      me?.id
        ? supabase.from("person_availability").select("date,status").eq("person_id", me.id)
        : Promise.resolve({ data: [] }),
      supabase.from("holidays").select("date,name"),
      supabase.from("time_entry_correction_requests").select("*").order("created_at", { ascending: false }),
    ]);
    setCorrectionRequests((correctionRequestData as CorrectionRequestRow[] | null) ?? []);
    setEntries(((entryData as unknown as EntryRow[]) ?? []));
    setPeople((peopleData as PersonLite[]) ?? []);
    setMyTasks((((taskData as unknown as TaskLite[]) ?? [])).filter((t) => t.assignee_id === me?.id));
    setMyAvailability((availabilityData as { date: string; status: "off" | "half_day" }[] | null) ?? []);
    setHolidayDates(new Set(((holidayData as { date: string }[] | null) ?? []).map((h) => h.date)));
    setHolidayNames(buildHolidayNameMap((holidayData as { date: string; name: string }[] | null) ?? []));
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

  // 2026-09-23 (Team Time supervisor view) -- Working Now + Team
  // Required Hours only matter once someone is actually looking at the
  // Team/All Time tab, so this stays idle (no requests, no polling) on
  // My Time. Refetches every 60s while active -- the same lightweight
  // polling cadence TimeTrackingContext already uses for the single-
  // person timer indicator, rather than adding realtime subscriptions.
  useEffect(() => {
    if (scope === "mine" || !me?.id) return;
    let cancelled = false;
    // 2026-09-23 (Sandra: "KPI cards follow the selected date/range") --
    // required hours are fetched for the SELECTED range now, not always
    // the current week.
    const [reqStart, reqEnd] = rangeForPreset(datePreset, rangeAnchor, customStart, customEnd);
    async function loadTeamSupervisorData() {
      const [{ data: timers, error: timersErr }, { data: required, error: requiredErr }] = await Promise.all([
        // 2026-09-25 (phase119) -- Working Now is scoped per tab: Team
        // Time = my reporting line only (even for Full Access), All Time
        // = org-wide incl. my own timer. Falls back to the old RPC if
        // the phase119 SQL hasn't been applied yet.
        supabase.rpc("get_running_timers", { p_scope: scope }).then(async (res) =>
          res.error ? await supabase.rpc("get_team_running_timers") : res
        ),
        // 2026-09-25 (phase120) -- required hours scoped the same way:
        // Team = reporting line only (even Full Access), All = everyone
        // incl. me. Falls back to the old RPC if phase120 isn't applied.
        supabase.rpc("get_required_hours", { p_start: reqStart, p_end: reqEnd, p_scope: scope }).then(async (res) =>
          res.error ? await supabase.rpc("get_team_required_hours", { p_start: reqStart, p_end: reqEnd }) : res
        ),
      ]);
      if (cancelled) return;
      if (!timersErr) setTeamRunningTimers((timers as TeamRunningTimer[]) ?? []);
      if (!requiredErr) setTeamRequiredHours((required as TeamRequiredHoursRow[]) ?? []);
    }
    loadTeamSupervisorData();
    const interval = window.setInterval(loadTeamSupervisorData, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [scope, me?.id, datePreset, rangeAnchor, customStart, customEnd]);

  // Elapsed-time ticker for Working Now's "42m" / "1h 13m" labels --
  // purely a re-render pulse, doesn't refetch data (that's the 60s poll
  // above).
  useEffect(() => {
    const interval = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Shared client-side gate for both correction modes -- same rules as a
  // fresh entry (end after start, nothing in the future, weekend/holiday
  // soft confirm). Returns the ISO window, or null if blocked/cancelled.
  async function validateCorrectionWindow(v: { date: string; startTime: string; endTime: string; notes: string }): Promise<{ startIso: string; endIso: string } | null> {
    const start = new Date(`${v.date}T${v.startTime}`);
    const end = new Date(`${v.date}T${v.endTime}`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      await alert("End time must be after start time.");
      return null;
    }
    if (isFutureTimeEntry(start.toISOString(), end.toISOString())) {
      await alert(FUTURE_ENTRY_MESSAGE_TEXT);
      return null;
    }
    if (!v.notes.trim()) {
      await alert("Please add a reason for the correction.");
      return null;
    }
    const warn = nonWorkingDayConfirmMessage(v.date, holidayNames);
    if (warn && !(await confirm({ message: warn, confirmLabel: "Yes, continue" }))) return null;
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  // 2026-09-23 (phase102): Full Access correction by start/end. If the
  // new window runs into other entries of the same person, offer to trim
  // them to fit (only finalized ones, only at an edge -- see
  // untrimmableReason). Anything that can't be trimmed blocks with the
  // usual overlap message.
  async function submitCorrection(row: EntryRow, v: { date: string; startTime: string; endTime: string; notes: string; reasonCategory: string; activityTypeId: string }) {
    const win = await validateCorrectionWindow(v);
    if (!win) return;
    const { startIso, endIso } = win;
    const conflicts = findAllOverlappingEntries(entries, row.person_id, startIso, endIso, row.id);
    const blocked = conflicts.map((c) => ({ c, why: untrimmableReason(c, startIso, endIso) })).find((x) => x.why);
    if (blocked) {
      await alert(`${overlapMessageText(blocked.c)}\n\nThis entry can't be trimmed automatically: ${blocked.why}.`);
      return;
    }
    let message = `Correct this entry to **${formatClockRange(startIso, endIso)}** (${formatDuration(Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000))})?\n\nWas: ${formatClockRange(row.started_at, row.ended_at)} (${formatDuration(row.duration_minutes)}). The original stays on record.`;
    if (conflicts.length > 0) {
      message =
        `**Time overlap detected**\n\nThe corrected time runs into ${conflicts.length === 1 ? "another entry" : `${conflicts.length} other entries`}. They'll be trimmed to fit:\n` +
        conflicts.map((c) => `• **${overlapTaskIdLabel(c)}** ${overlapTitle(c)}: ${formatClockRange(c.started_at, c.ended_at)} → ${trimmedRangeText(c, startIso, endIso)}`).join("\n") +
        `\n\n` + message;
    }
    const ok = await confirm({ message, confirmLabel: conflicts.length > 0 ? "Trim & correct" : "Correct" });
    if (!ok) return;
    const isNonProject = Boolean(row.activity_type_id);
    const res = await correctTimeEntry(row.id, startIso, endIso, v.notes.trim(), {
      reasonCategory: isNonProject ? undefined : v.reasonCategory || undefined,
      activityTypeId: isNonProject ? v.activityTypeId || undefined : undefined,
      trimEntryIds: conflicts.map((c) => c.id),
    });
    if (res.error) {
      await alert(`Couldn't correct this entry: ${res.error}`);
      return;
    }
    setCorrectingId(null);
    loadAll();
  }

  // Phase 2 (phase102): the entry's owner requests a correction. No
  // trimming here -- an overlap means the request is blocked and the
  // person picks a free window (or asks for the other entry to be fixed
  // too). Approval re-validates server-side.
  async function submitCorrectionRequest(row: EntryRow, v: { date: string; startTime: string; endTime: string; notes: string; reasonCategory: string; activityTypeId: string }) {
    const win = await validateCorrectionWindow(v);
    if (!win) return;
    const overlap = findOverlappingEntry(entries, row.person_id, win.startIso, win.endIso, row.id);
    if (overlap) {
      await alert(overlapMessageText(overlap));
      return;
    }
    const isNonProject = Boolean(row.activity_type_id);
    const ok = await confirm({
      message: `Request a correction to **${formatClockRange(win.startIso, win.endIso)}**?\n\nWas: ${formatClockRange(row.started_at, row.ended_at)} (${formatDuration(row.duration_minutes)}). Your approver will review it in the Approval Center.`,
      confirmLabel: "Submit request",
    });
    if (!ok) return;
    const res = await requestTimeEntryCorrection(
      row.id,
      win.startIso,
      win.endIso,
      v.notes.trim(),
      isNonProject && v.activityTypeId && v.activityTypeId !== row.activity_type_id ? v.activityTypeId : undefined
    );
    if (res.error) {
      await alert(`Couldn't submit this request: ${res.error}`);
      return;
    }
    setRequestingId(null);
    loadAll();
  }

  async function handleCancelCorrectionRequest(req: CorrectionRequestRow) {
    const ok = await confirm({ message: "Cancel this correction request?", confirmLabel: "Cancel request", danger: true });
    if (!ok) return;
    const res = await cancelTimeEntryCorrection(req.id);
    if (res.error) {
      await alert(`Couldn't cancel: ${res.error}`);
      return;
    }
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
      message: `Archive this ${formatDuration(row.duration_minutes)} entry for ${label}? It stops counting toward Spent Hrs, Productivity and dashboard totals. ${ARCHIVE_MOVE_NOTE}`,
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    const res = await archiveItem("time_entry", row.id, reason.trim() || undefined);
    if (res.error) {
      await alert(`Couldn't archive this entry: ${res.error.message}`);
      return;
    }
    setArchivingId(null);
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
    if (isFutureTimeEntry(start.toISOString(), end.toISOString())) {
      await alert(FUTURE_ENTRY_MESSAGE_TEXT);
      return;
    }
    const overlap = findOverlappingEntry(entries, row.person_id, start.toISOString(), end.toISOString(), row.id);
    if (overlap) {
      await alert(overlapMessageText(overlap));
      return;
    }
    // 2026-09-23 (Sandra: same weekend/holiday soft check -- an edit can
    // move a pending entry's date onto a weekend/holiday too).
    const editWarnMsg = nonWorkingDayConfirmMessage(v.date, holidayNames);
    if (editWarnMsg && !(await confirm({ message: editWarnMsg, confirmLabel: "Yes, save it" }))) return;
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
    const ok = await confirm({ message: `Delete this time entry for ${label}? ${ARCHIVE_MOVE_NOTE}`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const res = await archiveItem("time_entry", row.id);
    if (res.error) {
      await alert(`Couldn't delete this entry: ${res.error.message}`);
      return;
    }
    loadAll();
  }

  async function handleSubmitManual() {
    setLogError(null);
    setLogOverlapEntry(null);
    setLogFutureBlocked(false);
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
      if (isFutureTimeEntry(start.toISOString(), end.toISOString())) {
        setLogFutureBlocked(true);
        return;
      }
      const overlap = findOverlappingEntry(entries, me?.id ?? "", start.toISOString(), end.toISOString());
      if (overlap) {
        setLogOverlapEntry(overlap);
        return;
      }
      // 2026-09-23 (Sandra: weekend/holiday soft check, fires every time,
      // never blocks -- "you're trying to log on a Saturday/weekend/
      // holiday, are you sure?") -- checked against the date TYPED into
      // the form, since a manual entry is often backdated rather than
      // logged for today.
      const npWarnMsg = nonWorkingDayConfirmMessage(logStartDate, holidayNames);
      if (npWarnMsg && !(await confirm({ message: npWarnMsg, confirmLabel: "Yes, log it" }))) return;
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
    if (isFutureTimeEntry(start.toISOString(), end.toISOString())) {
      setLogFutureBlocked(true);
      return;
    }
    const overlap = findOverlappingEntry(entries, me?.id ?? "", start.toISOString(), end.toISOString());
    if (overlap) {
      setLogOverlapEntry(overlap);
      return;
    }
    // 2026-09-23 (Sandra: weekend/holiday soft check -- see the matching
    // comment in the non-project branch above) -- same treatment for
    // project time.
    const warnMsg = nonWorkingDayConfirmMessage(logStartDate, holidayNames);
    if (warnMsg && !(await confirm({ message: warnMsg, confirmLabel: "Yes, log it" }))) return;
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
  // 2026-09-24 (Sandra): Team Member + Project multi-select and Log Type
  // (Project / Non-Project) filters. Applied here, BEFORE the scope/KPI
  // step, so the KPI cards follow the filters too (same as the old
  // ?project= filter did). A ?project= link pre-selects that project.
  const entryPersonOptions = (() => {
    const seen = new Map<string, string>();
    for (const e of entries) if (e.person_id && !seen.has(e.person_id)) seen.set(e.person_id, e.person?.name ?? personName(e.person_id));
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  })();
  const projectFilteredEntries = entries.filter((e) => {
    if (filterProjectIds.length && !(e.task?.project?.id && filterProjectIds.includes(e.task.project.id))) return false;
    if (filterMemberIds.length && !filterMemberIds.includes(e.person_id)) return false;
    if (logTypeFilter === "project" && !e.task_id) return false;
    if (logTypeFilter === "non_project" && e.task_id) return false;
    return true;
  });
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
  // 2026-09-23 (Sandra: "remove projects filter and more for now" --
  // removed the More Filters popover, which was the only place an
  // Archived-visibility toggle lived; archived entries are simply
  // always hidden here now until that control comes back.
  // 2026-09-23 (Sandra: "if a task is running, do not show it in Team
  // Entries" -- makes sense on My/All Time too: a running entry has no
  // duration/source/details yet, and now lives exclusively in the new
  // Working Now section (Team/All Time) or the top single-timer bar
  // (My Time), never duplicated into this table.
  const archivedFilteredEntries = scopeFilteredEntries.filter((e) => !e.is_archived && e.status !== "running");

  // 2026-09-23 (Sandra: "make KPI cards follow the selected date/range")
  // -- the old Today's Logs + This Week cards (always pinned to the real
  // current day/week) are now ONE "Logged Hours" card driven by the same
  // selected range as the table, Total Entries, Needs Attention and Timer
  // Compliance. Same counted statuses as before (finalized only).
  const kpiCountedStatuses = new Set(["confirmed", "approved"]);
  const [kpiRangeStart, kpiRangeEnd] = rangeForPreset(datePreset, rangeAnchor, customStart, customEnd);
  const rangeLoggedMinutes = archivedFilteredEntries
    .filter((e) => {
      const key = toDateInputValue(new Date(e.started_at));
      return key >= kpiRangeStart && key <= kpiRangeEnd && kpiCountedStatuses.has(e.status);
    })
    .reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
  // Every Mon-Fri date key in the selected range (weekends carry no
  // required hours -- same rule the old weekly target used).
  const rangeWeekdayKeys: string[] = [];
  {
    const cur = new Date(`${kpiRangeStart}T00:00:00`);
    const last = new Date(`${kpiRangeEnd}T00:00:00`);
    for (let guard = 0; cur <= last && guard < 400; guard++) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) rangeWeekdayKeys.push(toDateInputValue(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }
  // 2026-09-23 (dynamic expected hours, Sandra: "evaluate logged hours
  // against the employee's required working hours for that specific
  // day" -- not a flat daily_capacity_hours assumption every day).
  // avStatusFor/expected-hours-for-day reuse the exact same
  // expectedHoursForDay/dailyCapacityHours logic Utilization/WBS/My
  // Dashboard already use, so this never disagrees with those pages.
  function myAvStatusFor(dateKey: string): "off" | "half_day" | undefined {
    return myAvailability.find((a) => a.date === dateKey)?.status;
  }
  function myExpectedHoursFor(dateKey: string): number {
    if (!me) return 0;
    if (holidayDates.has(dateKey)) return 0;
    return expectedHoursForDay({ id: me.id, daily_capacity_hours: me.daily_capacity_hours }, myAvStatusFor(dateKey));
  }
  // Sum each weekday of the SELECTED range's own expected hours -- a
  // half-day or full time-off day (or holiday) lowers the total instead
  // of assuming a flat 7.5h per day.
  const rangeTargetMinutes = rangeWeekdayKeys.map((k) => myExpectedHoursFor(k) * 60).reduce((sum, m) => sum + m, 0);
  // Every weekday in range is approved full-day time off (not a holiday
  // or weekend) -> show "Time Off" rather than an underworked 0h.
  const rangeAllTimeOff = rangeWeekdayKeys.length > 0 && rangeWeekdayKeys.every((k) => myAvStatusFor(k) === "off");

  // 2026-09-23 (Team Time supervisor view, Sandra: "Team Required Hours
  // must NOT default to 7.5 x team size... sum of each eligible
  // member's actual required hours for that day") -- teamRequiredHours
  // already excludes me (see the SQL fix appended to
  // supabase/phase85_migration.sql) and is already scoped server-side
  // to my reports_to subtree (or everyone, for Full Access), so this is
  // a plain sum, not a re-filter. Today's figure naturally reduces to
  // 7.5h x headcount only when the whole team happens to be on a normal
  // schedule that day -- a computed result, not a hardcoded assumption,
  // per her explicit ask.
  const rangeWeekdaySet = new Set(rangeWeekdayKeys);
  // 2026-09-25 -- also follow the Team Member filter, so the target
  // matches the logged hours when only some people are selected.
  const teamRangeRequiredMinutes = teamRequiredHours
    .filter((r) => rangeWeekdaySet.has(r.date))
    .filter((r) => filterMemberIds.length === 0 || filterMemberIds.includes(r.person_id))
    .reduce((sum, r) => sum + r.expected_hours * 60, 0);

  // "N people working now" -- one running timer per person (the app
  // enforces a single global timer per person via a DB partial unique
  // index), so entry count and person count are always equal; kept as a
  // separate dedupe here anyway in case that constraint ever loosens.
  const teamWorkingNowCount = new Set(teamRunningTimers.map((t) => t.person_id)).size;

  function formatElapsed(startedAt: string, nowMs: number): string {
    const mins = Math.max(0, Math.round((nowMs - new Date(startedAt).getTime()) / 60000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
  }

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
  // 2026-09-23 (Sandra: "add a manual vs timer metric... just one
  // number, timer compliance") -- % of the currently browsed range's
  // entries logged via the Timer rather than typed in manually,
  // matching Total Entries/Needs Attention's population (dateFiltered,
  // before the Status/Source/search filters below narrow it further).
  const timerCount = dateFilteredEntries.filter((e) => e.source === "timer").length;
  const timerCompliancePct = dateFilteredEntries.length > 0 ? Math.round((timerCount / dateFilteredEntries.length) * 100) : null;

  const statusFilteredEntries = statusFilter === "all" ? dateFilteredEntries : dateFilteredEntries.filter((e) => e.status === statusFilter);
  const sourceFilteredEntries = sourceFilter === "all" ? statusFilteredEntries : statusFilteredEntries.filter((e) => e.source === sourceFilter);
  const searchLower = searchText.trim().toLowerCase();
  const searchFilteredEntries = !searchLower
    ? sourceFilteredEntries
    : sourceFilteredEntries.filter((e) => {
        const haystack = [timeLogId(e.entry_number), e.task?.name, e.task?.project?.name, e.activity_type?.name, e.reason_notes, e.reason_category, e.person?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(searchLower);
      });
  // Sort by (2026-09-23, Sandra: "remove shortest and longest duration in
  // the sort for all") -- date-only now. When Group by date is on, this
  // SAME value also drives which end the date groups start from (see
  // groupedEntries below) -- entries within a group always stay
  // chronological (AM before PM) regardless of this setting.
  const sortedEntries = [...searchFilteredEntries].sort((a, b) => {
    const at = new Date(a.started_at).getTime();
    const bt = new Date(b.started_at).getTime();
    return sortBy === "date_asc" ? at - bt : bt - at;
  });
  const filteredEntries = sortedEntries;

  // Group by date (Sandra: "allow them to group by dates -- always make
  // sure this is either newest to oldest or oldest to newest -- but time
  // should always be in chronological order from am to PM" -- then
  // later: "if grouped by dates, allow sorting by date but retain the
  // time to be in chronological order" + "there's another pill for
  // newest or oldest first after group date that works but remove that,
  // confusing" -- so the separate group-order toggle is gone; the same
  // Sort by dropdown above now drives date-group order too).
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
    if (sortBy === "date_desc") keys.reverse();
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
  const ENTRY_TABLE_COL_WIDTHS_WITH_ASSIGNEE = ["7%", "7%", "15%", "9%", "9%", "10%", "6%", "15%", "6%", "9%", "7%"];
  const ENTRY_TABLE_COL_WIDTHS_NO_ASSIGNEE = ["7%", "7%", "18%", "10%", "11%", "7%", "19%", "7%", "8%", "6%"];
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
  // 2026-09-24 bugfix (Sandra: "time corrections -- when one types or
  // changes the date, if idle for a couple of seconds it goes back to the
  // original time; typing notes has a bug too; submitting does not
  // proceed"). Root cause: this used to be rendered as <EntriesTable />, a
  // component type re-created on EVERY TimeTracking render -- and the page
  // re-renders on its own every 30s (nowTick) and 60s (Team Time poll), so
  // React remounted the whole table and every inline form in it
  // (Correct / Request correction / Edit / Archive) lost its typed values
  // and focus mid-edit. Called as a plain function now, so the table's
  // element types stay stable and each form keeps its own state.
  function renderEntriesTable({ rows, showAssignee }: { rows: EntryRow[]; showAssignee: boolean }) {
    if (rows.length === 0) return null;
    const isFullAccess = me?.access_level === "full";
    const colCount = showAssignee ? 11 : 10;
    const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
    const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
    return (
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <EntryTableColGroup showAssignee={showAssignee} />
          <thead>
            <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Log ID</th>
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
              // 2026-09-23 (phase102, phase 2): the entry's owner (when not
              // Full Access -- they'd just Correct) can request a
              // correction on their own finalized entry.
              const pendingRequest = correctionRequests.find((r) => r.entry_id === row.id && r.status === "pending") ?? null;
              const lastClosedRequest = correctionRequests.find((r) => r.entry_id === row.id && r.status === "rejected") ?? null;
              const canRequest = !isFullAccess && row.person_id === me?.id && (row.status === "confirmed" || row.status === "approved") && !row.is_archived && !pendingRequest;
              const requesting = requestingId === row.id;
              const canEditDelete = canEditDeletePending(row);
              const editing = editingId === row.id;
              // 2026-09-23 (phase63): admin soft-delete for a
              // confirmed/approved entry, reversible.
              const canArchive = isFullAccess && (row.status === "confirmed" || row.status === "approved") && !row.is_archived;
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
                  <tr style={{ borderBottom: correcting || editing || archiving || requesting ? "none" : "1px solid var(--border)" }}>
                    <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{timeLogId(row.entry_number)}</td>
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
                      {row.corrected_at && row.original_started_at && (row.original_started_at !== row.started_at || row.original_ended_at !== row.ended_at) && (
                        <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2, textDecoration: "line-through" }} title="Original time before correction">
                          {formatClockRange(row.original_started_at, row.original_ended_at)}
                        </div>
                      )}
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
                      {row.is_follow_up && (
                        <div style={{ marginBottom: 3 }}>
                          <span className="status-pill gold" style={{ fontSize: 9, padding: "1px 5px" }} title="Extra time logged after the task was marked Done">
                            Follow-up{row.follow_up_reason ? ` · ${FOLLOW_UP_REASON_LABEL[row.follow_up_reason]}` : ""}
                          </span>
                        </div>
                      )}
                      {details}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span className={`status-pill ${SOURCE_TONE[row.source] ?? "neutral"}`} style={{ fontSize: 9 }}>{SOURCE_LABEL[row.source]}</span>
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
                          {row.original_started_at && (row.original_started_at !== row.started_at || row.original_ended_at !== row.ended_at) ? (
                            <>Corrected from {formatClockRange(row.original_started_at, row.original_ended_at)} ({formatDuration(row.original_duration_minutes)}) to {formatClockRange(row.started_at, row.ended_at)} ({formatDuration(row.duration_minutes)}) by </>
                          ) : row.original_duration_minutes !== row.duration_minutes ? (
                            <>Corrected from {formatDuration(row.original_duration_minutes)} to {formatDuration(row.duration_minutes)} by </>
                          ) : (
                            <>Details corrected by </>
                          )}
                          {personName(row.corrected_by)} on {formatDate(row.corrected_at)}
                          {row.correction_requested_by && <> (requested by {personName(row.correction_requested_by)})</>}
                          {row.correction_notes && <> — "{row.correction_notes}"</>}
                        </div>
                      )}
                      {pendingRequest && (
                        <div style={{ marginTop: 4 }}>
                          <span className="status-pill gold" style={{ fontSize: 9, padding: "1px 5px" }}>Correction requested</span>
                          <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 3 }}>
                            Proposed {formatClockRange(pendingRequest.proposed_started_at, pendingRequest.proposed_ended_at)} — "{pendingRequest.reason}"
                            {pendingRequest.requested_by === me?.id && (
                              <>
                                {" · "}
                                <button
                                  onClick={() => handleCancelCorrectionRequest(pendingRequest)}
                                  style={{ fontSize: 9.5, color: "var(--danger-text)", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
                                >
                                  Cancel request
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                      {!pendingRequest && lastClosedRequest && row.person_id === me?.id && (!row.corrected_at || new Date(lastClosedRequest.decided_at ?? 0) > new Date(row.corrected_at)) && (
                        <div style={{ fontSize: 9.5, color: "var(--danger-text)", marginTop: 4 }}>
                          Correction request rejected by {personName(lastClosedRequest.decided_by)} on {formatDate(lastClosedRequest.decided_at)}
                          {lastClosedRequest.decision_notes && <> — "{lastClosedRequest.decision_notes}"</>}
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
                      {canRequest && !requesting && (
                        <button
                          onClick={() => setRequestingId(row.id)}
                          title="Request correction"
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                        >
                          <FilePen size={13} />
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
                        <CorrectionForm
                          row={row}
                          mode="correct"
                          reasonOptions={reasonOptions}
                          nonProjectActivityTypes={nonProjectActivityTypes}
                          onSubmit={(v) => submitCorrection(row, v)}
                          onCancel={() => setCorrectingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {canRequest && requesting && (
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={colCount} style={{ padding: "8px 12px 12px", background: "var(--surface-2, #f8f9fb)" }}>
                        <CorrectionForm
                          row={row}
                          mode="request"
                          reasonOptions={reasonOptions}
                          nonProjectActivityTypes={nonProjectActivityTypes}
                          onSubmit={(v) => submitCorrectionRequest(row, v)}
                          onCancel={() => setRequestingId(null)}
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
                  onMouseEnter={() => setAddTimeHoverMode(mode)}
                  onMouseLeave={() => setAddTimeHoverMode((m) => (m === mode ? null : m))}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                    fontSize: 12.5, color: "var(--navy)", border: "none", cursor: "pointer",
                    background: addTimeHoverMode === mode ? "var(--hover-bg)" : "none",
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
            {logFutureBlocked && (
              <div
                style={{
                  color: "var(--danger-text)", fontSize: 11.5, marginBottom: 8, padding: "8px 10px",
                  background: "var(--danger-bg)", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Future time entry not allowed</div>
                <div>Time entries can only be logged for time that has already passed.</div>
              </div>
            )}
            {logOverlapEntry && (
              <div
                style={{
                  color: "var(--danger-text)", fontSize: 11.5, marginBottom: 8, padding: "8px 10px",
                  background: "var(--danger-bg)", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Time overlap detected</div>
                <div>You already have a logged entry for this period:</div>
                <div><strong>Log ID:</strong> {timeLogId(logOverlapEntry.entry_number)}</div>
                <div><strong>Task ID:</strong> {overlapTaskIdLabel(logOverlapEntry)}</div>
                <div><strong>Task:</strong> {overlapTitle(logOverlapEntry)}</div>
                <div><strong>Time:</strong> {formatClockRange(logOverlapEntry.started_at, logOverlapEntry.ended_at)}</div>
                <div><strong>Status:</strong> {STATUS_LABEL[logOverlapEntry.status]}</div>
                <div style={{ borderTop: "1px solid var(--danger-text)", opacity: 0.5, margin: "6px 0" }} />
                <div>Please adjust the start or end time.</div>
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

          {/* 2026-09-23 (Sandra mockup redesign, then Team Time
              supervisor view) -- Today's Logs/This Week reuse the same
              6-tier loggedHoursTier() bands as Daily Activity/My
              Dashboard. On My Time the denominator is my own real
              expected hours (dailyTargetMinutes/weeklyTargetMinutes);
              on Team/All Time it's now the REAL sum of the team's
              required hours for the day/week (teamTodayRequiredMinutes/
              teamWeeklyRequiredMinutes, from get_team_required_hours --
              see [[project_capaciq_time_tracking_bands_compliance_and_prefs_2026_09_23]]
              for why this replaces the earlier "always neutral on
              Team/All Time" guard: that guard existed because the old
              denominator was always MY OWN target regardless of scope,
              which made any multi-person total look artificially
              "significantly above" -- now that the denominator scales
              with the team too, the ratio is genuinely meaningful and
              can be banded like any other scope. Total Entries/Needs
              Attention/Timer Compliance are unchanged. Active Timers is
              a new card, Team/All Time only (Sandra's "Working Now"
              spec) -- reflects ONLY currently-running timers, not
              logged/finalized hours. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginTop: 4, marginBottom: 14 }}>
            {(() => {
              const effectiveRangeTargetMinutes = scope === "mine" ? rangeTargetMinutes : teamRangeRequiredMinutes;
              const rangeTier = loggedHoursTier(rangeLoggedMinutes / 60, effectiveRangeTargetMinutes / 60);
              const complianceTier =
                timerCompliancePct === null
                  ? { bg: "var(--hover-bg)", fg: "var(--muted)", tone: "neutral" as const }
                  : timerCompliancePct < 50
                  ? { bg: "var(--danger-bg)", fg: "var(--danger-text)", tone: "danger" as const }
                  : timerCompliancePct < 75
                  ? { bg: "var(--warning-bg)", fg: "var(--warning-text)", tone: "warning" as const }
                  : { bg: "var(--success-bg)", fg: "var(--success-text)", tone: "success" as const };
              const cards: {
                key: string;
                icon: JSX.Element;
                tone: string;
                label: string;
                value: string;
                caption?: string;
                cardBg?: string;
                cardFg?: string;
              }[] = [
                // 2026-09-23 (Sandra: "if an employee is on approved full-day
                // time off, the day should not be evaluated as underworked
                // ... show 'Time Off' instead of 0h with a red/low status")
                // -- applies on any scope now: on My Time it means I'm off
                // today; on Team/All Time it means the ENTIRE visible team
                // has 0 required hours today (rare, but same principle --
                // an all-off day shouldn't read as "critically underworked").
                // Single "Logged Hours" card for the selected range. Time Off
                // only when every weekday in range is my approved full-day
                // time off (My Time); a weekend/holiday-only range simply
                // reads "No hours expected".
                ...(scope === "mine" && rangeAllTimeOff && rangeLoggedMinutes <= 0
                  ? [
                      {
                        key: "logged",
                        icon: <Timer size={15} />,
                        tone: "neutral",
                        cardBg: "var(--hover-bg)",
                        cardFg: "var(--muted)",
                        label: "Logged Hours",
                        value: "Time Off",
                      },
                    ]
                  : [
                      {
                        key: "logged",
                        icon: <Timer size={15} />,
                        tone: effectiveRangeTargetMinutes > 0 ? rangeTier.tone : "neutral",
                        cardBg: effectiveRangeTargetMinutes > 0 ? rangeTier.bg ?? "var(--hover-bg)" : "var(--hover-bg)",
                        cardFg: effectiveRangeTargetMinutes > 0 ? rangeTier.fg : "var(--muted)",
                        label: "Logged Hours",
                        value: `${(Math.round((rangeLoggedMinutes / 60) * 100) / 100).toFixed(2)}h`,
                        caption: effectiveRangeTargetMinutes > 0 ? `of ${(effectiveRangeTargetMinutes / 60).toFixed(2)}h expected` : "No hours expected",
                      },
                    ]),
                // 2026-09-23 (Sandra's "Working Now" spec, Active Timers
                // card): Team/All Time only -- reflects ONLY currently-
                // running timers (get_team_running_timers), explicitly
                // NOT counted into Today's Logged until each one stops
                // and finalizes into a real entry.
                ...(scope !== "mine"
                  ? [
                      {
                        key: "activeTimers",
                        icon: <Radio size={15} />,
                        tone: teamWorkingNowCount > 0 ? "success" : "slate",
                        label: "Active Timers",
                        value: String(teamWorkingNowCount),
                        caption: teamWorkingNowCount > 0 ? `${teamWorkingNowCount} people working now` : "No one currently tracking",
                      },
                    ]
                  : []),
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
                {
                  key: "compliance",
                  icon: <ShieldCheck size={15} />,
                  tone: complianceTier.tone,
                  cardBg: complianceTier.bg,
                  cardFg: complianceTier.fg,
                  label: "Timer Compliance",
                  value: timerCompliancePct === null ? "—" : `${timerCompliancePct}%`,
                  caption: timerCompliancePct === null ? "No eligible logs" : "of logs via Timer (target ≥75%)",
                },
              ];
              return cards.map((card) => {
                const filled = Boolean(card.cardBg);
                return (
                  <div
                    key={card.key}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "14px 16px", borderRadius: 16,
                      border: filled ? "1px solid transparent" : "1px solid var(--border)",
                      background: filled ? card.cardBg : "var(--surface)",
                      boxShadow: "var(--shadow-card, 0 1px 2px rgba(15,41,66,0.04))",
                    }}
                  >
                    <span
                      className={`status-pill ${card.tone}`}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                        ...(filled ? { background: "rgba(255,255,255,0.55)", color: card.cardFg } : {}),
                      }}
                    >
                      {card.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: filled ? card.cardFg : "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>{card.label}</div>
                      <div style={{ fontSize: 19, fontWeight: 700, color: filled ? card.cardFg : "var(--navy)", lineHeight: 1.2 }}>{card.value}</div>
                      {card.caption && (
                        <div style={{ fontSize: 10, color: filled ? card.cardFg : "var(--muted)", opacity: filled ? 0.85 : 1, marginTop: 1 }}>{card.caption}</div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Date-range browser -- Today/This Week/Last Week/This
              Month/Custom presets + step arrows; narrows Total
              Entries/Needs Attention above and the table below (Today/
              This Week KPI cards are exempt, they always track the real
              calendar). */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {(
              [
                // 2026-09-24 (Sandra: "change to day, week, month and
                // custom -- remove last week; if I select Today and step to
                // another day it's not today anymore"). Internal keys kept
                // (saved prefs); the < > arrows move between periods, and
                // clicking a button again jumps back to the current day/week/month.
                { key: "today" as const, label: "Day" },
                { key: "this_week" as const, label: "Week" },
                { key: "this_month" as const, label: "Month" },
                { key: "custom" as const, label: "Custom" },
              ]
            ).map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  setDatePreset(p.key);
                  setRangeAnchor(new Date());
                  // 2026-09-23 (Sandra: "remove group by date option in
                  // Today view" -- grouping by date is meaningless for a
                  // single day, so force it off going in, not just hide
                  // the checkbox, in case it was left on from another view.
                  if (p.key === "today") setGroupByDate(false);
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

          {/* Filter row -- search, status, source, sort, group by date.
              "You tell me what's works best" (Sandra) -- these mechanics
              are my call; the KPI definitions above and grouping
              semantics were hers. Project filter + More Filters removed
              for now (Sandra: "remove projects filter and more for now
              in the My time tracking") -- the underlying `filterProjectId`
              still works if a project is passed via the URL (e.g. the
              Spent Hrs cell click-through from elsewhere in the app),
              there's just no visible control for it here right now. */}
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
            <select
              value={logTypeFilter}
              onChange={(e) => setLogTypeFilter(e.target.value as typeof logTypeFilter)}
              style={{ fontSize: 12, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 10 }}
            >
              <option value="all">All Log Types</option>
              <option value="project">Project</option>
              <option value="non_project">Non-Project</option>
            </select>
            {scope !== "mine" && (
              <MultiSelectFilter options={entryPersonOptions} selected={filterMemberIds} onChange={setFilterMemberIds} noun="team members" singular="Member" />
            )}
            <MultiSelectFilter
              options={entryProjectOptions.map((o) => ({ id: o.id, name: o.label }))}
              selected={filterProjectIds}
              onChange={setFilterProjectIds}
              noun="projects"
              singular="Project"
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{ fontSize: 12, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 10 }}
            >
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
            </select>
            {datePreset !== "today" && (
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                <input type="checkbox" checked={groupByDate} onChange={(e) => setGroupByDate(e.target.checked)} />
                Group by date
              </label>
            )}
            {(searchText || statusFilter !== "all" || sourceFilter !== "all" || logTypeFilter !== "all" || filterMemberIds.length > 0 || filterProjectIds.length > 0) && (
              <button
                onClick={() => {
                  setSearchText("");
                  setStatusFilter("all");
                  setSourceFilter("all");
                  setLogTypeFilter("all");
                  setFilterMemberIds([]);
                  setFilterProjectIds([]);
                }}
                style={{ fontSize: 11, color: "var(--muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Reset filters
              </button>
            )}
          </div>

          {/* 2026-09-23 (Team Time supervisor view, Sandra's "Working
              Now" spec) -- currently-running timers across the visible
              team, placed above the entries table per her explicit
              ordering ("before confirmed/approved, pending logs").
              Reuses the SAME time_entries rows the rest of the app
              already tracks (via get_team_running_timers, a thin
              SECURITY DEFINER view over time_entries where
              status='running') -- no separate "supervisor timer"
              dataset. A running timer's in-progress duration is
              deliberately NOT part of Today's Logged above; it only
              counts once it stops and finalizes into a real entry
              (disappearing from here and appearing in the table below),
              which avoids inflating totals from abandoned/auto-stopped/
              corrected/rejected timers. */}
          {scope !== "mine" && (
            <div style={{ marginTop: 10, marginBottom: 14 }}>
              {/* 2026-09-23 (Sandra: "allow collapse and expand when the
                  user clicks on the Working Now header") -- same
                  whole-header-row-is-the-click-target + chevron
                  convention as the date-group headers in the entries
                  table below. */}
              <button
                onClick={() => setWorkingNowExpanded((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
                  background: "none", border: "none", padding: 0, marginBottom: 8, cursor: "pointer",
                }}
              >
                {workingNowExpanded ? <ChevronDown size={13} color="var(--muted)" /> : <ChevronRight size={13} color="var(--muted)" />}
                <Radio size={14} color="var(--accent)" />
                <h2 style={{ margin: 0, fontSize: 13 }}>Working Now {teamRunningTimers.length > 0 ? `(${teamRunningTimers.length})` : ""}</h2>
              </button>
              {workingNowExpanded && (
                teamRunningTimers.length === 0 ? (
                  <div style={{ padding: "10px 14px", borderRadius: 10, border: "1px dashed var(--border)", fontSize: 12, color: "var(--muted)" }}>
                    No active timers right now
                  </div>
                ) : (
                  // 2026-09-23 (Sandra: "replicate how the Team Entries
                  // table looks... white BG format for Working Now") --
                  // same table shell (white surface, bordered, uppercase
                  // muted header row) as EntriesTable, just with a green
                  // "Running" status pill in the last column instead of
                  // an Action column (a running timer has no
                  // correct/archive actions -- those only apply once it
                  // finalizes into a real entry below).
                  // 2026-09-23 (Sandra: "Working Now should follow the
                  // same columns as Team Entries -- Task ID, Task/
                  // Project, Assignee, Work Date, Time [started, "in
                  // progress"], Status [Running + elapsed]. No Duration,
                  // no Details, no Source.") -- same table shell/header
                  // style as EntriesTable, Duration/Details/Source/
                  // Action columns dropped since none of them apply to
                  // an entry that hasn't finalized yet.
                  <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                      <colgroup>
                        <col style={{ width: "8%" }} />
                        <col style={{ width: "26%" }} />
                        <col style={{ width: "16%" }} />
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "16%" }} />
                        <col style={{ width: "20%" }} />
                      </colgroup>
                      <thead>
                        <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                          <th style={{ padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>Task ID</th>
                          <th style={{ padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>Task / Project</th>
                          <th style={{ padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>Assignee</th>
                          <th style={{ padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>Work Date</th>
                          <th style={{ padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" }}>Time</th>
                          <th style={{ padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamRunningTimers.map((t) => (
                          <tr key={t.entry_id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "10px 12px", fontSize: 11.5, fontWeight: 700, color: "var(--navy)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                              {t.task_number ? `T-${String(t.task_number).padStart(4, "0")}` : "—"}
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 11.5, verticalAlign: "top" }}>
                              <div style={{ fontWeight: 700, color: "var(--navy)" }}>{t.task_name ?? "—"}</div>
                              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{t.project_name ?? "Non-project"}</div>
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 11.5, verticalAlign: "top" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span
                                  style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: 22, height: 22, borderRadius: "50%",
                                    background: "var(--accent-bg, #eaf2fb)", color: "var(--accent)",
                                    fontSize: 9.5, fontWeight: 700, flexShrink: 0,
                                  }}
                                >
                                  {initials(t.person_name)}
                                </span>
                                {t.person_name}
                                {t.person_id === me?.id && (
                                  <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600 }}>(You)</span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                              {formatWorkDate(t.started_at)}
                            </td>
                            <td style={{ padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top", whiteSpace: "nowrap" }}>
                              {formatClockRange(t.started_at, null)}
                            </td>
                            <td style={{ padding: "10px 12px", verticalAlign: "top" }}>
                              <span className="status-pill success" style={{ fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                                Running · {formatElapsed(t.started_at, nowTick)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          )}

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
            // 2026-09-23 (Sandra: "auto collapse first then allow expand
            // the date header should be the button to click to collapse
            // and expand, just add a little indication... so the user
            // knows it can be done") -- collapsed by default; the
            // chevron next to the date is that indication, and the whole
            // header row is the click target, not just the icon.
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {groupedEntries.map((g) => {
                const isExpanded = expandedDateGroups.has(g.dateKey);
                return (
                  <div key={g.dateKey}>
                    <button
                      onClick={() =>
                        setExpandedDateGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.dateKey)) next.delete(g.dateKey);
                          else next.add(g.dateKey);
                          return next;
                        })
                      }
                      style={{
                        display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
                        background: "var(--surface-2, #f5f6f8)", border: "1px solid var(--border)", borderRadius: 10,
                        padding: "8px 12px", fontSize: 11.5, fontWeight: 700, color: "var(--navy)", cursor: "pointer",
                      }}
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {formatRangeLabel(g.dateKey, g.dateKey)}
                      <span style={{ fontWeight: 500, color: "var(--muted)" }}>({g.rows.length})</span>
                    </button>
                    {isExpanded && (
                      <div style={{ marginTop: 6 }}>
                        {renderEntriesTable({ rows: g.rows, showAssignee: scope !== "mine" })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            renderEntriesTable({ rows: filteredEntries, showAssignee: scope !== "mine" })
          )}
        </>
      )}
    </div>
  );
}
