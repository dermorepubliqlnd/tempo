import MultiSelectFilter from "../components/MultiSelectFilter";
import ValidateCompletionModal from "../components/ValidateCompletionModal";
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  CalendarClock,
  Timer,
  ShieldCheck,
  FolderCheck,
  ListChecks,
  Clock,
  ChevronRight,
  Search,
  ArrowUpDown,
  Folder,
  User,
  Calendar,
  RefreshCw,
  FilePen,
  UserCheck,
  ShieldAlert,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../lib/fetchAllRows";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { friendlyError } from "../lib/prompts";
import { workingDayDelta, formatWorkingDayDelta } from "../lib/workingDays";
import { useHolidaySet } from "../lib/useHolidaySet";
import { loadRoutingData, routeApproval, routeProjectRequest, activeDelegationFor, type RoutingData, type ApprovalRightsPerson } from "../lib/approvalRouting";
import Modal from "../components/Modal";
import { useChecklistDialog } from "../components/ChecklistDialog";
import { startProjectChecklist, closeProjectApproverChecklist, checklistBlocks } from "../lib/startProjectChecklist";
import { loadProjectPlanForDecision } from "../lib/projectDecisionData";
import OverrideReasonModal from "../components/OverrideReasonModal";
import MyRequestsPanel from "../components/MyRequestsPanel";
import { useApprovalAuthority } from "../lib/useApprovalAuthority";
import DelegateApprovalsModal from "../components/DelegateApprovalsModal";
import AutoApprovedPanel from "../components/AutoApprovedPanel";
import { useAutoApprovalsOn, completionTiming, COMPLETION_TIMING_LABEL, autoValidateOn, setValidationHold } from "../lib/autoApprovals";
import { formatDate } from "../lib/formatDate";
import { decideTimeEntry, decideTimeEntryCorrection, formatDuration, FOLLOW_UP_REASON_LABEL, timeLogId, type FollowUpReason } from "../lib/timeTracking";

// Approval Center (2026-09-18, Sandra: "create an approval center page
// under main... where all things for approval should show like extension
// requests, time tracking, baseline approval, and project close
// request"). This is a READ-and-decide hub, not a new source of truth --
// every row here is fetched live from the same tables/RPCs the four
// native pages already use (ExtensionRequests.tsx, TimeTracking.tsx,
// WbsPlanning.tsx's Start Project / Closure flows), and every decision
// made here calls the exact same RPC those pages call.
//
// Baseline and Closure decisions are the one thing NOT fully inlined
// here: WbsPlanning.tsx's decide_baseline_request/decide_wbs_closure both
// require a fresh full task snapshot (buildTaskSnapshotPayload) plus a
// project-field completeness gate (Category/Source/Complexity/Output
// Count/etc.) that only exists in that page's live in-memory WBS state.
// Reimplementing that here would duplicate genuinely complex, correctness-
// sensitive logic outside the one place it's kept consistent -- so those
// two rows deep-link to the project's WBS Planning page (where the real
// Approve/Reject buttons already live) instead of deciding inline.
//
// 2026-09-19 (Sandra: card-layout mockup) -- redesigned from a plain
// table into the summary-card + request-card layout shown in her
// reference screenshot. Clicking a summary card IS the type filter (no
// separate pill row) -- click again to clear back to "All".

interface PersonLite {
  id: string;
  name: string;
  reports_to: string | null;
}
interface ProjectLite {
  id: string;
  name: string;
  project_number?: number | null;
  owner_id: string | null;
  wbs_status: string | null;
}

interface ExtensionRow {
  id: string;
  requested_new_due_date: string;
  request_type: "due_date" | "start_date" | null;
  reason_category: string;
  reason_notes: string;
  created_at: string;
  is_manager_initiated: boolean;
  // phase169: why this one wasn't auto-approved (set by the DB)
  auto_check_note?: string | null;
  task: {
    id: string;
    name: string;
    assignee_id: string | null;
    current_due_date: string;
    project_id: string;
    project: { id: string; name: string; owner_id: string | null } | null;
  } | null;
  project: { id: string; name: string; owner_id: string | null; end_date: string | null } | null;
  requester: { id: string; name: string } | null;
}

interface TimeEntryRowLite {
  id: string;
  // 2026-09-22: null on a non-project entry -- see activity_type below.
  task_id: string | null;
  activity_type_id: string | null;
  person_id: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  duration_minutes: number | null;
  requested_by: string | null;
  reason_category: string | null;
  reason_notes: string | null;
  is_follow_up?: boolean;
  follow_up_reason?: string | null;
  entry_number?: number | null;
  non_project_entry_number?: number | null;
  task: {
    id: string;
    name: string;
    project_id: string;
    project: { id: string; name: string; owner_id: string | null } | null;
  } | null;
  activity_type: { id: string; name: string } | null;
  person: { id: string; name: string } | null;
}

// 2026-09-23 (phase102, phase 2): an employee's request to correct the
// start/end of their own confirmed/approved time entry.
interface CorrectionRequestRowLite {
  id: string;
  entry_id: string;
  requested_by: string;
  current_started_at: string;
  current_ended_at: string;
  proposed_started_at: string;
  proposed_ended_at: string;
  proposed_activity_type_id: string | null;
  reason: string;
  created_at: string;
  entry: {
    id: string;
    task_id: string | null;
    activity_type_id: string | null;
    non_project_entry_number: number | null;
    entry_number?: number | null;
    task: { id: string; name: string; task_number: number | null; project: { id: string; name: string; owner_id: string | null } | null } | null;
    activity_type: { id: string; name: string } | null;
  } | null;
  requester: { id: string; name: string } | null;
}

interface BaselineRow {
  id: string;
  project_id: string;
  requested_by: string | null;
  requested_at: string;
}
interface ClosureRow {
  id: string;
  project_id: string;
  requested_by: string | null;
  requested_at: string;
}
// 2026-09-21 (Sandra: "in the approval center, can we add task
// [completion] validation too?") -- surfaces the same Done-but-not-yet-
// Validated tasks the "Validated Date" column on Projects.tsx/
// WbsPlanning.tsx already gates behind the Validate button, so a manager
// doesn't have to go hunting through the Tasks table to find what's
// waiting on their sign-off. No separate request table backs this --
// it's just tasks where status = 'Done' and validated_completion_date is
// still null, same live query the Tasks view itself effectively runs.
interface TaskCompletionRow {
  id: string;
  name: string;
  task_number?: number | null;
  assignee_id: string | null;
  project_id: string;
  parent_task_id: string | null;
  current_due_date: string | null;
  actual_completion_date: string | null;
  submitted_on: string | null;
  start_date?: string | null;
  // 2026-09-22 (Sandra: "show scoped hours vs logged hours" on this
  // card) -- Scoped is just the task's own estimated_hours; Logged comes
  // from a separate lightweight time_entries fetch below (ownHoursFor).
  estimated_hours: number | null;
  // phase169: approver hold on an on-the-due-date completion
  validation_hold?: boolean | null;
  project: { id: string; name: string; owner_id: string | null; wbs_status: string | null } | null;
}

function hours(minutes: number | null): string {
  if (!minutes) return "0h";
  return `${(minutes / 60).toFixed(1)}h`;
}

// 2026-09-22 (Sandra: "for due date extension requests, format to match
// Time Tracking" -- applied to Approval Center too, not just the
// standalone Extension Requests page): same delta helper
// ExtensionRequests.tsx already has, duplicated locally like this
// file's other small formatters.
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

// 2026-09-22 (Sandra: revamp of time-entry approval rows into a table --
// Task/Project, Assignee, Work Date, Time, Duration, Details, Requested
// On, Action) -- same small formatting helpers TimeTracking.tsx's
// DecisionTable uses, duplicated locally rather than shared since
// they're one-liners and this file already keeps its own small
// formatters (e.g. hours() above) separate from that page's.
function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit" });
}

function formatWorkDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  return `${datePart} (${weekday})`;
}

function formatClockRange(startedAt: string, endedAt: string | null | undefined): string {
  const start = new Date(startedAt);
  if (isNaN(start.getTime())) return "—";
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endedAt) return `${startTime} -- in progress`;
  const end = new Date(endedAt);
  if (isNaN(end.getTime())) return startTime;
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${startTime} -- ${endTime}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Request type -- a stable discriminator used both for the type filter
// (the summary cards) and the color-coded pill/icon, kept separate from
// typeLabel so the two extension sub-labels ("Task extension" / "Project
// timeline extension") still filter and color together as one type.
type ApprovalKind = "extension" | "time" | "correction" | "baseline" | "closure" | "task_completion";

// Same tone names index.css already defines for .status-pill.<tone> --
// reused here for the summary-card icon squares too, so a request's
// color means the same thing everywhere on this page.
const KIND_META: Record<ApprovalKind, { label: string; pluralLabel: string; tone: string; icon: JSX.Element }> = {
  extension: { label: "Task Extension", pluralLabel: "Extension Requests", tone: "gold", icon: <CalendarClock size={13} /> },
  time: { label: "Time Entry", pluralLabel: "Time Entries", tone: "accent", icon: <Timer size={13} /> },
  correction: { label: "Time Correction", pluralLabel: "Time Corrections", tone: "skyblue", icon: <FilePen size={13} /> },
  baseline: { label: "Start Project request", pluralLabel: "Start Project requests", tone: "purple", icon: <ShieldCheck size={13} /> },
  closure: { label: "Close Project request", pluralLabel: "Close Project requests", tone: "mint", icon: <FolderCheck size={13} /> },
  task_completion: { label: "Task Completion", pluralLabel: "Task Validations", tone: "success", icon: <ListChecks size={13} /> },
};

// Shared row chrome for every approval type -- kept as one generic shape
// so the request-card list below doesn't need four separate render
// paths.
interface Row {
  key: string;
  kind: ApprovalKind;
  // 2026-09-24 (Sandra): person / project filters + ID search.
  personId?: string | null;
  projectId?: string | null;
  searchIds?: string;
  typeLabel: string;
  subject: string;
  context: string;
  requestedByName: string;
  requestedAt: string;
  reasonCategory: string | null;
  reasonNotes: string | null;
  extraLine: string | null;
  canDecide: boolean;
  action: JSX.Element | null;
  // 2026-09-22 (Sandra: revamp time-entry rows into the same 8-column
  // table Time Tracking uses) -- time-kind rows only; everything else
  // leaves these undefined and RequestList's grouping keeps them as
  // regular cards.
  workStartedAt?: string;
  workEndedAt?: string | null;
  durationMinutes?: number | null;
  loggedOnAt?: string;
  // 2026-09-22 (Sandra: drop Scoped vs Logged, give Task Completion its
  // own real table like Time Entries has) -- task_completion rows carry
  // their raw source row so TaskCompletionTable can render Due Date /
  // Reported Completion / Confirm Completion Date as real columns
  // instead of parsing them back out of extraLine text.
  taskCompletionRow?: TaskCompletionRow;
  // 2026-09-22 (Sandra: "not applied in approval center" -- the
  // Extension Requests table treatment needs to show up here too, not
  // just the standalone page): extension rows carry their raw source
  // row the same way, for the same reason.
  extensionRow?: ExtensionRow;
  // 2026-09-22 (Sandra, on a Baseline-table mockup screenshot: "now
  // baseline approvals, please change action to review WBS") -- baseline
  // rows carry the project id so BaselineTable's Action button can link
  // straight to that project's WBS Planning page.
  linkProjectId?: string;
  correctionRow?: CorrectionRequestRowLite;
  // phase113: Time Log ID + Task ID labels for time-entry rows.
  logId?: string;
  taskIdLabel?: string;
  // Project ID ("P-0012") for project-level requests (close, baseline).
  refId?: string;
  // phase130: routing -- "mine" (routed to me), "acting" (covering for
  // someone), "team" (routed elsewhere; read-only unless overridden).
  route?: "mine" | "acting" | "team";
  actingForName?: string | null;
  routedToName?: string | null;
  overridable?: boolean;
  itemId?: string;
  subjectId?: string | null;
}

// phase104: requests on an archived task/project stay out of every list
// (they come back if the item is restored from the Archive).
function notOnArchived(r: unknown): boolean {
  const x = r as { task?: { is_archived?: boolean } | null; project?: { is_archived?: boolean } | null };
  return !x.task?.is_archived && !x.project?.is_archived;
}


// 2026-09-24 bugfix (Sandra: corrections -- "submitting does not proceed",
// typing resets). These two own local state (the reject note, the confirm
// date), so they live at module level: defined inside ApprovalCenter they
// were a brand-new component type on every render, and each keystroke in
// the reject note re-rendered the page and remounted them -- closing the
// note popover / resetting the date. The tables that contain them are now
// called as plain functions (not <Component />) for the same reason.
function DecideButtons({ onApprove, onReject }: { onApprove: () => void | Promise<void>; onReject: (note: string) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  async function run(fn: () => void | Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => setRejecting((r) => !r)}
          disabled={busy}
          title="Reject"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "var(--danger-text)", background: "#fff", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
        >
          <XCircle size={14} />
        </button>
        <button
          onClick={() => run(onApprove)}
          disabled={busy}
          title="Approve"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, color: "#fff", background: "var(--success-text)", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          <CheckCircle2 size={14} />
        </button>
      </div>
      {rejecting && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            padding: 10, width: 240, boxShadow: "0 6px 20px rgba(15,23,42,0.16)",
          }}
        >
          <input
            type="text"
            autoFocus
            placeholder="Reason for rejecting (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: "100%", fontSize: 11.5, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" }}
          />
          {!note.trim() && <div style={{ fontSize: 10, color: "var(--danger-text)", marginTop: 4 }}>A note is required to reject.</div>}
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button
              onClick={() => {
                if (!note.trim()) return;
                const n = note.trim();
                setRejecting(false);
                run(() => onReject(n));
              }}
              disabled={busy || !note.trim()}
              style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "#fff", background: note.trim() ? "var(--danger-text)" : "var(--muted)", border: "none", borderRadius: "var(--radius-sm)", padding: "6px 8px", cursor: note.trim() ? "pointer" : "not-allowed" }}
            >
              Confirm reject
            </button>
            <button
              onClick={() => setRejecting(false)}
              style={{ fontSize: 11, color: "var(--muted)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 8px", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 2026-10-08 (Sandra, item J): Start Project / Close Project requests are
// decided inline here (staging: behind useAutoApprovalsOn). Module level for
// the same remount reason as DecideButtons above.
function ProjectDecisionButtons({ projectId, busy, onApprove, onDecline }: { projectId: string; busy: boolean; onApprove: () => void; onDecline: () => void }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={onDecline}
          disabled={busy}
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--danger-text)", background: "#fff", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)", padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <XCircle size={13} /> Decline
        </button>
        <button
          onClick={onApprove}
          disabled={busy}
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--success-text)", border: "none", borderRadius: "var(--radius-sm)", padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}
        >
          <CheckCircle2 size={13} /> {busy ? "Working…" : "Approve"}
        </button>
      </div>
      <Link to={`/projects/${projectId}/wbs`} style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}>
        Review plan in WBS
      </Link>
    </div>
  );
}

// Decline dialog. Start Project: same reason list + notes rule as the WBS
// page (reason required; notes required only for "Other"). Close Project:
// optional note.
function ProjectDeclineModal({
  kind,
  projectName,
  reasons,
  busy,
  onCancel,
  onSubmit,
}: {
  kind: "baseline" | "closure";
  projectName: string;
  reasons: string[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string | null, note: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const isStart = kind === "baseline";
  const noteRequired = isStart && reason === "Other";
  const ready = isStart ? !!reason && (!noteRequired || !!note.trim()) : true;
  const field: CSSProperties = { width: "100%", fontSize: 12, padding: "7px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" };
  return (
    <Modal title={isStart ? "Decline Start Project request" : "Reject Close Project request"} onClose={onCancel} width={420}>
      <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10 }}>
        {isStart ? `"${projectName}" stays in Draft and the request goes back to the requester.` : `"${projectName}" stays open and the request is sent back.`}
      </div>
      {isStart && (
        <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--navy)", marginBottom: 8 }}>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...field, marginTop: 4 }}>
            <option value="">Choose a reason…</option>
            {reasons.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      )}
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>
        {noteRequired ? "Notes (required)" : "Notes (optional)"}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ ...field, marginTop: 4, resize: "vertical" }} />
      </label>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onCancel} style={{ fontSize: 12, color: "var(--text-secondary)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 12px", cursor: "pointer" }}>
          Cancel
        </button>
        <button
          onClick={() => ready && onSubmit(isStart ? reason : null, note.trim() || null)}
          disabled={!ready || busy}
          style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: ready ? "var(--danger-text)" : "var(--muted)", border: "none", borderRadius: "var(--radius-sm)", padding: "6px 12px", cursor: ready ? "pointer" : "not-allowed" }}
        >
          {isStart ? "Decline request" : "Reject request"}
        </button>
      </div>
    </Modal>
  );
}

function ValidateActionCells({ row, busy, onValidate }: { row: TaskCompletionRow; busy: boolean; onValidate: (date: string) => void }) {
  const defaultDate = (row.actual_completion_date ?? row.submitted_on ?? new Date().toISOString()).slice(0, 10);
  const [date, setDate] = useState(defaultDate);
  const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
  return (
    <>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={(() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; })()}
          min={row.actual_completion_date ? row.actual_completion_date.slice(0, 10) : undefined}
          title="Validated date -- the completion date that is locked in when you validate"
          style={{ fontSize: 11.5, padding: "6px 7px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--navy)" }}
        />
      </td>
      <td style={{ ...td, textAlign: "center" }}>
        <button
          onClick={() => onValidate(date)}
          disabled={busy || !date}
          title="Validate"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--success-text)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap", margin: "0 auto" }}
        >
          <CheckCircle2 size={13} />
          Validate
        </button>
      </td>
    </>
  );
}

// 2026-10-06 (Sandra): summaryOnly renders just the "Awaiting My Approval"
// cards for My Dashboard -- same rows/routing as the Mine to approve tab, so
// the numbers always match the Approval Center.
export default function ApprovalCenter({ summaryOnly = false }: { summaryOnly?: boolean } = {}) {
  const { person: me } = useSession();
  const { alert, confirm, dialog: confirmDialog } = useConfirm();
  const { showChecklist, dialog: checklistDialog } = useChecklistDialog();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryRowLite[]>([]);
  const [baselineRequests, setBaselineRequests] = useState<BaselineRow[]>([]);
  const [closureRequests, setClosureRequests] = useState<ClosureRow[]>([]);
  const [taskCompletions, setTaskCompletions] = useState<TaskCompletionRow[]>([]);
  const [correctionRequests, setCorrectionRequests] = useState<CorrectionRequestRowLite[]>([]);
  // 2026-09-22 (Sandra: Scoped vs Logged Hours column) -- a lightweight
  // fetch of just the fields ownHoursFor needs, same
  // confirmed/approved-only scope Spent Hrs itself uses on Projects.tsx.
  const [allTimeEntries, setAllTimeEntries] = useState<{ task_id: string; duration_minutes: number | null; status: "confirmed" | "approved" }[]>([]);
  // Unfiltered (includes inactive) id/reports_to/is_active projection,
  // separate from the active-only `people` state above -- needed to walk
  // PAST an inactive immediate manager to find the nearest active one
  // above them, same reason Projects.tsx keeps its own `chainPeople`
  // alongside its active-only `people`.
  const [chainPeople, setChainPeople] = useState<{ id: string; reports_to: string | null; is_active: boolean }[]>([]);
  // Task ids that are a parent of at least one other task -- see the
  // parent_task_id fetch above for why Task Completion excludes these.
  const [parentTaskIds, setParentTaskIds] = useState<Set<string>>(new Set());
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  // phase122: the Validate confirm step (ValidateCompletionModal).
  const [validating, setValidating] = useState<{ row: TaskCompletionRow; date: string; error?: string | null } | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  // Type filter -- clicking a summary card sets this to that kind; click
  // the same card again (or there's nothing else to clear to) resets it
  // to null, meaning "All".
  const [kindFilter, setKindFilter] = useState<ApprovalKind | null>(() => {
    const k = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("kind");
    return k && ["extension", "time", "correction", "baseline", "closure", "task_completion"].includes(k) ? (k as ApprovalKind) : null;
  });
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  // 2026-09-23 (Sandra: "when a user expands and approves it goes back
  // to collapsed, please retain expanded view if the user left it as
  // is") -- root cause: KindSection was defined AS A COMPONENT INSIDE
  // this component's own render body, with its `expanded` flag as its
  // own local state. Every parent re-render (e.g. loadAll() after an
  // approve/reject) creates a brand-new KindSection function, so React
  // treats it as a different component type and remounts it -- wiping
  // local state back to its initial `false`. Same root cause as
  // [[project_capaciq_archive_lockbypass_and_keystroke_remount_fix_2026_09_23]]'s
  // EntriesTable/DecisionTable bug. Fix: lift the expand/collapse state
  // up here (keyed by kind, so each section's state is independent and
  // survives every re-render), and pass it down as props instead.
  const [expandedKinds, setExpandedKinds] = useState<Set<ApprovalKind>>(new Set());
  const holidaySet = useHolidaySet();
  // phase130: routing, tabs, overrides, delegation.
  const [routing, setRouting] = useState<RoutingData | null>(null);
  // 2026-10-02 (Sandra): Approval Center is open to everyone; approval tabs
  // only for people with approval rights, My Requests for all.
  const hasAuthority = useApprovalAuthority();
  const autoOn = useAutoApprovalsOn();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTabState] = useState<"mine" | "team" | "requests" | "auto">(searchParams.get("tab") === "requests" ? "requests" : searchParams.get("tab") === "auto" ? "auto" : "mine");
  const setTab = (t: "mine" | "team" | "requests" | "auto") => {
    setTabState(t);
    const next = new URLSearchParams(searchParams);
    if (t === "requests" || t === "auto") next.set("tab", t);
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  };
  useEffect(() => {
    if (hasAuthority === false && tab !== "requests") setTabState("requests");
    if (tab === "auto" && !autoOn) setTabState("mine");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAuthority]);
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [overrideTarget, setOverrideTarget] = useState<Row | null>(null);
  const [delegateOpen, setDelegateOpen] = useState(false);
  // 2026-10-08 (item J): approval rights per person (project-request
  // routing), Start Project decline reasons, and the open Decline dialog.
  const [rights, setRights] = useState<Map<string, ApprovalRightsPerson>>(new Map());
  const [declineReasons, setDeclineReasons] = useState<string[]>([]);
  const [projectDecline, setProjectDecline] = useState<{ kind: "baseline" | "closure"; requestId: string; projectId: string; requesterId: string | null; key: string } | null>(null);
  const [recentOverrides, setRecentOverrides] = useState<{ id: string; kind: string; decision: string; reason: string; created_at: string; overridden_by: string; routed_approver_id: string | null; subject_person_id: string | null }[]>([]);

  async function loadAll() {
    setLoading(true);
    const [{ data: peopleData }, { data: chainPeopleData }, { data: projectData }, { data: extData }, { data: teData }, { data: blData }, { data: clData }, { data: tcData }, { data: allTeData }, { data: parentIdData }, { data: corrData }] = await Promise.all([
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("people").select("id,reports_to,is_active"),
      supabase.from("projects").select("id,name,owner_id,wbs_status,project_number"),
      supabase
        .from("extension_requests")
        .select(
          `id, requested_new_due_date, request_type, reason_category, reason_notes, created_at, is_manager_initiated,${autoOn ? " auto_check_note," : ""}
           task:tasks!extension_requests_task_id_fkey ( id, name, is_archived, assignee_id, current_due_date, project_id, project:projects ( id, name, owner_id ) ),
           project:projects!extension_requests_project_id_fkey ( id, name, is_archived, owner_id, end_date ),
           requester:people!extension_requests_requested_by_fkey ( id, name )`
        )
        .eq("status", "Pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("time_entries")
        .select(
          `id, entry_number, non_project_entry_number, task_id, activity_type_id, person_id, started_at, ended_at, created_at, duration_minutes, requested_by, reason_category, reason_notes, is_follow_up, follow_up_reason,
           task:tasks ( id, name, task_number, project_id, project:projects ( id, name, owner_id ) ),
           activity_type:non_project_activity_types ( id, name ),
           person:people!time_entries_person_id_fkey ( id, name )`
        )
        .eq("status", "pending_approval")
        .eq("is_archived", false)
        .order("started_at", { ascending: false }),
      supabase.from("project_baseline_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
      supabase.from("project_closure_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
      supabase
        .from("tasks")
        .select(
          `id, name, task_number, assignee_id, project_id, parent_task_id, current_due_date, actual_completion_date, submitted_on, start_date, estimated_hours,${autoOn ? " validation_hold," : ""}
           project:projects ( id, name, owner_id, wbs_status )`
        )
        .eq("status", "Done")
        .is("validated_completion_date", null)
        .eq("is_archived", false)
        .order("submitted_on", { ascending: false }),
      fetchAllRows((f, t) => supabase.from("time_entries").select("task_id, duration_minutes, status").in("status", ["confirmed", "approved"]).eq("is_archived", false).order("id").range(f, t)),
      // 2026-09-21 bugfix (Sandra, spotting "Revise deck" -- a parent
      // task -- sitting in "Other pending approvals" with no assignee):
      // a parent task's completion is fully computed from its children
      // and is NEVER independently validated (see Projects.tsx's own
      // Validated Date column, which renders "N/A" for any parent with
      // children -- same reasoning as Work Type's N/A treatment). This
      // query never excluded parents, so any Done-but-unvalidated parent
      // (reachable from the old pre-N/A era, or a parent whose children
      // are all Done/Cancelled) leaked into the Task Completion list.
      // Fetching every distinct parent_task_id lets the row-builder
      // below skip any task that IS a parent.
      supabase.from("tasks").select("parent_task_id").eq("is_archived", false).not("parent_task_id", "is", null),
      supabase
        .from("time_entry_correction_requests")
        .select(
          `id, entry_id, requested_by, current_started_at, current_ended_at, proposed_started_at, proposed_ended_at, proposed_activity_type_id, reason, created_at,
           entry:time_entries ( id, entry_number, task_id, activity_type_id, non_project_entry_number,
             task:tasks ( id, name, task_number, project:projects ( id, name, owner_id ) ),
             activity_type:non_project_activity_types ( id, name ) ),
           requester:people!time_entry_correction_requests_requested_by_fkey ( id, name )`
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    setCorrectionRequests((corrData as unknown as CorrectionRequestRowLite[]) ?? []);
    setPeople((peopleData as PersonLite[]) ?? []);
    setProjects((projectData as ProjectLite[]) ?? []);
    // Same start_date-request filter ExtensionRequests.tsx applies -- that
    // per-task request type was removed 2026-08-27 (start dates only
    // change via Re-baseline now); old rows are left in the table but
    // never surfaced anywhere, including here.
    setExtensions((((extData as unknown as ExtensionRow[]) ?? [])).filter((r) => r.request_type !== "start_date" && notOnArchived(r)));
    setTimeEntries((teData as unknown as TimeEntryRowLite[]) ?? []);
    setBaselineRequests((blData as BaselineRow[]) ?? []);
    setClosureRequests((clData as ClosureRow[]) ?? []);
    // 2026-09-24 (Sandra: "why are there 2 Task Validations groups?"): a
    // Done-but-unvalidated task on a CLOSED project can never be validated
    // (closed projects are final/locked), so it sat forever under "Other
    // pending approvals" with no one able to act. Excluded here.
    setTaskCompletions(((tcData as unknown as TaskCompletionRow[]) ?? []).filter((t) => t.project?.wbs_status !== "closed"));
    setAllTimeEntries((allTeData as { task_id: string; duration_minutes: number | null; status: "confirmed" | "approved" }[]) ?? []);
    setChainPeople((chainPeopleData as { id: string; reports_to: string | null; is_active: boolean }[]) ?? []);
    setParentTaskIds(new Set(((parentIdData as { parent_task_id: string }[]) ?? []).map((r) => r.parent_task_id)));
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [rd, { data: ovData }, { data: rightsData }, { data: reasonData }] = await Promise.all([
      loadRoutingData((chainPeopleData as { id: string; reports_to: string | null; is_active: boolean }[]) ?? []),
      supabase.from("approval_overrides").select("id,kind,decision,reason,created_at,overridden_by,routed_approver_id,subject_person_id").gte("created_at", since).not("decision", "in", "(pending,failed)").order("created_at", { ascending: false }).limit(50),
      supabase.from("people").select("id,can_approve_rebaseline,can_approve_closures,access_level"),
      supabase.from("baseline_decline_reasons").select("name").eq("is_active", true).order("sort_order"),
    ]);
    setRights(new Map(((rightsData as ApprovalRightsPerson[]) ?? []).map((p) => [p.id, p])));
    setDeclineReasons(((reasonData as { name: string }[]) ?? []).map((r) => r.name));
    setRouting(rd);
    setRecentOverrides((ovData as typeof recentOverrides) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const isFullAccess = me?.access_level === "full";
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const projectIdLabel = (projectId: string) => {
    const n = projectById.get(projectId)?.project_number;
    return n ? `P-${String(n).padStart(4, "0")}` : undefined;
  };

  // Mirrors can_decide_extension() -- identical logic to
  // ExtensionRequests.tsx's canDecide.
  function canDecideExtension(row: ExtensionRow): boolean {
    // phase112: requester's reporting line (Immediate Supervisor or anyone
    // above), or Full Access -- project owners no longer approve.
    if (!me) return false;
    if (canFullAccessApprove(row.requester?.id ?? null)) return true;
    return isApproverFor(row.requester?.id ?? null);
  }

  // Mirrors can_decide_time_entry() -- identical logic to
  // TimeTracking.tsx's canDecide.
  function canDecideTimeEntry(row: TimeEntryRowLite): boolean {
    // phase112: the person whose time it is -- their reporting line, or
    // Full Access (project, non-project and follow-up entries alike).
    if (!me) return false;
    if (canFullAccessApprove(row.person_id)) return true;
    return isApproverFor(row.person_id);
  }

  // Baseline decisions are STRICTLY gated on can_approve_rebaseline --
  // same flat, non-tiered rule WbsPlanning.tsx enforces (owner/Full
  // Access do NOT auto-qualify).
  const canDecideBaseline = !!me?.can_approve_rebaseline;

  // Closure: Full Access or anyone flagged can_approve_closures --
  // mirrors WbsPlanning.tsx's canDecideClosure.
  // 2026-09-21 (Sandra: "how come Gemma was able to approve project
  // close when she does not have the permission to do so?") -- dropped
  // the project-owner auto-qualify branch this used to have; an owner
  // can request their own project's closure but no longer approve it.
  function canDecideClosure(row: ClosureRow): boolean {
    if (!me) return false;
    return isFullAccess || !!me.can_approve_closures;
  }

  // Client-side approximation of nearest_active_manager() -- walks
  // reports_to from personId, skipping anyone inactive. `people` here is
  // already fetched is_active-only, so any match found this way is
  // guaranteed active by construction (same shortcut Projects.tsx's own
  // nearestActiveManagerClient takes). validate_task_completion (SQL) is
  // the authoritative gate; this only decides whether to show the button.
  function nearestActiveManager(personId: string | null): string | null {
    if (!personId) return null;
    let current = chainPeople.find((p) => p.id === personId)?.reports_to ?? null;
    let depth = 0;
    while (current && depth < 20) {
      const mgr = chainPeople.find((p) => p.id === current);
      if (mgr?.is_active) return mgr.id;
      current = mgr?.reports_to ?? null;
      depth += 1;
    }
    return null;
  }

  // phase121 (Sandra: "Jo reports to me but he is able to approve my
  // logs. No."): Full Access overrides for anyone EXCEPT people above me
  // in my own Reports-to chain, and except myself (top of chain only).
  // Mirrors can_full_access_approve() in phase121_migration.sql.
  function canFullAccessApprove(subjectId: string | null): boolean {
    if (!me || !isFullAccess) return false;
    if (!subjectId) return true;
    if (subjectId === me.id) return nearestActiveManager(me.id) === null;
    let current = chainPeople.find((p) => p.id === me.id)?.reports_to ?? null;
    let depth = 0;
    while (current && depth < 20) {
      if (current === subjectId) return false;
      current = chainPeople.find((p) => p.id === current)?.reports_to ?? null;
      depth += 1;
    }
    return true;
  }

  // phase112 (Sandra: "all approvals route to the immediate supervisor,
  // following hierarchy -- skip level if the supervisor is out"): true if
  // I sit anywhere above personId in the Reports-to chain. Mirrors
  // is_approver_for() in phase112_migration.sql (the authoritative gate).
  function isApproverFor(personId: string | null): boolean {
    if (!me || !personId) return false;
    if (personId === me.id) return nearestActiveManager(me.id) === null;
    let current = chainPeople.find((p) => p.id === personId)?.reports_to ?? null;
    let depth = 0;
    while (current && depth < 20) {
      if (current === me.id) return true;
      current = chainPeople.find((p) => p.id === current)?.reports_to ?? null;
      depth += 1;
    }
    return false;
  }

  // Mirrors canValidateTask() in Projects.tsx / validate_task_completion
  // (phase48/49_migration.sql): the assignee's immediate manager, a
  // skip-level fallback if the immediate manager is inactive, Full
  // Access, or the project owner -- with the same self-validation
  // exemption (only when there's genuinely no active manager anywhere
  // above the assignee) and the same project-closed lockout.
  function canDecideTaskCompletion(row: TaskCompletionRow): boolean {
    // phase112: assignee's reporting line or Full Access (project-owner
    // branch removed); own work only when nobody active is above you.
    if (!me) return false;
    if (row.project?.wbs_status === "closed") return false;
    if (row.assignee_id && row.assignee_id === me.id) return nearestActiveManager(row.assignee_id) === null;
    if (canFullAccessApprove(row.assignee_id)) return true;
    return isApproverFor(row.assignee_id);
  }

  // 2026-09-22: the old modal confirm() for "Reject ...?" is gone -- the
  // Reject icon's required-note popover (DecideButtons) IS the
  // confirmation step now, so this no longer asks twice.
  // phase130/131: an override is logged BEFORE deciding (the DB requires
  // it for items routed to someone else), then stamped with the outcome.
  async function beginOverride(key: string, kind: ApprovalKind, itemId: string, subjectId: string | null, routedOverride?: string | null): Promise<string | null | false> {
    const reason = overrideReasons[key];
    if (!reason) return null;
    const routed = routedOverride !== undefined ? routedOverride : routing ? routeApproval(routing, subjectId).approverId : null;
    const { data, error } = await supabase
      .from("approval_overrides")
      .insert({ kind, item_id: itemId, subject_person_id: subjectId, routed_approver_id: routed, decision: "pending", reason })
      .select("id")
      .single();
    if (error) {
      await alert(friendlyError("save the override reason", error));
      return false;
    }
    return (data as { id: string }).id;
  }

  async function finishOverride(key: string, overrideId: string | null, decision: string) {
    if (!overrideId) return;
    await supabase.from("approval_overrides").update({ decision }).eq("id", overrideId);
    if (decision !== "failed") {
      setOverrideReasons((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function decideExtension(row: ExtensionRow, status: "Approved" | "Rejected", note: string | null = null) {
    const key = `ext-${row.id}`;
    const ovId = await beginOverride(key, "extension", row.id, row.requester?.id ?? null);
    if (ovId === false) return;
    setDecidingKey(key);
    const { error } = await supabase.rpc(row.project ? "decide_project_extension_request" : "decide_extension_request", {
      p_request_id: row.id,
      p_status: status,
      p_decision_notes: note?.trim() || notesDraft[key]?.trim() || null,
    });
    setDecidingKey(null);
    if (error) {
      await finishOverride(key, ovId, "failed");
      await alert(friendlyError(`${status === "Approved" ? "approve" : "reject"} this request`, error));
      return;
    }
    await finishOverride(key, ovId, status.toLowerCase());
    loadAll();
  }

  // 2026-09-22: same -- the popover's own "Confirm reject" is the
  // confirmation now.
  async function decideTime(row: TimeEntryRowLite, status: "approved" | "rejected", note: string | null = null) {
    const key = `time-${row.id}`;
    const ovId = await beginOverride(key, "time", row.id, row.person_id);
    if (ovId === false) return;
    setDecidingKey(key);
    const res = await decideTimeEntry(row.id, status, note?.trim() || notesDraft[key]?.trim() || null);
    setDecidingKey(null);
    if (res.error) {
      await finishOverride(key, ovId, "failed");
      await alert(friendlyError(`${status === "approved" ? "approve" : "reject"} this time entry`, res.error));
      return;
    }
    await finishOverride(key, ovId, status);
    loadAll();
  }

  // Mirrors can_decide_time_entry_correction (phase102): nobody decides
  // their own request (except top-of-chain), Full Access, the project
  // owner (project entry, owner isn't the requester), or the requester's
  // nearest active manager.
  function canDecideCorrection(row: CorrectionRequestRowLite): boolean {
    // phase112: requester's reporting line or Full Access; never your own
    // (except top of chain).
    if (!me) return false;
    if (row.requested_by === me.id) return nearestActiveManager(row.requested_by) === null;
    if (canFullAccessApprove(row.requested_by)) return true;
    return isApproverFor(row.requested_by);
  }

  async function decideCorrection(row: CorrectionRequestRowLite, decision: "approved" | "rejected", note: string | null = null) {
    const key = `corr-${row.id}`;
    const ovId = await beginOverride(key, "correction", row.id, row.requested_by);
    if (ovId === false) return;
    setDecidingKey(key);
    const res = await decideTimeEntryCorrection(row.id, decision, note?.trim() || notesDraft[key]?.trim() || null);
    setDecidingKey(null);
    if (res.error) {
      await finishOverride(key, ovId, "failed");
      await alert(friendlyError(`${decision === "approved" ? "approve" : "reject"} this correction`, res.error));
      return;
    }
    await finishOverride(key, ovId, decision);
    loadAll();
  }

  // No "reject" concept for task completion -- validate_task_completion
  // is the one action (same as the plain "Validate" button on Projects.tsx/
  // WbsPlanning.tsx's Validated Date column).
  //
  // 2026-09-21 (Sandra, after the first round of this feature): "make
  // sure the actual validation date when validation was made and who
  // validated is also captured ... the date selected when someone
  // validates just validates the actual [completion] date. but the
  // actual validation date was the date when the approver did the
  // validation." Two distinct dates now, matching her example exactly
  // (actual completion yesterday, validated today -> validated
  // completion date = yesterday, validation performed at = today):
  //   - p_validated_date (chosen here, defaults to actual_completion_date/
  //     submitted_on/today, same order validate_task_completion always
  //     used) -- the completion date being confirmed/signed off.
  //   - validation_performed_at -- stamped server-side to now() by the
  //     RPC itself (phase54_migration.sql), always the real click
  //     moment, never shown/edited here.
  // 2026-09-21 follow-up (Sandra, on a screenshot of a validated-but-
  // unlocked row): "when that is done that equates to validation lock
  // too, not this" -- validating through the Approval Center's confirm
  // dialog (which already tells the validator this is the FINAL,
  // approved completion date) now also locks it immediately, via the
  // same lock_task_validation RPC the separate green-checkmark Lock
  // button on Projects.tsx/WbsPlanning.tsx's Validated Date column
  // calls ("Same authorization as Validate itself" -- see that button's
  // own comment, so whoever could validate here can always lock too).
  // The plain inline Validate button on those pages is UNCHANGED --
  // still a separate two-step Validate-then-Lock there, since it has no
  // "this is final" confirm step of its own; this only short-circuits
  // that second step when validation happens through this page.
  async function decideTaskCompletion(row: TaskCompletionRow, validatedDate: string, reason: string | null = null) {
    const key = `taskval-${row.id}`;
    const ovId = await beginOverride(key, "task_completion", row.id, row.assignee_id);
    if (ovId === false) return;
    setDecidingKey(key);
    const { error } = await supabase.rpc("validate_task_completion", { p_task_id: row.id, p_validated_date: new Date(validatedDate).toISOString(), p_adjustment_reason: reason });
    if (error) {
      setDecidingKey(null);
      await finishOverride(key, ovId, "failed");
      // phase122: show inside the modal (an alert would open behind it).
      setValidating((prev) => (prev ? { ...prev, error: error.message } : prev));
      return;
    }
    const { error: lockError } = await supabase.rpc("lock_task_validation", { p_task_id: row.id });
    setDecidingKey(null);
    setValidating(null);
    if (lockError) {
      // Validation itself succeeded -- only the lock step failed (rare;
      // e.g. a permission edge case). Surface it rather than silently
      // leaving the row unlocked with no explanation.
      await alert({ title: "Validated, but still editable", message: `"${row.name}" was validated, but its fields couldn't be made read-only. Try again or tell Sandra.`, details: lockError.message });
    }
    await finishOverride(key, ovId, "validated");
    loadAll();
  }

  // 2026-09-22 (Sandra: "replace actions with Approved or Reject buttons
  // check/x icons only. If rejecting require a note from the
  // approver/decliner") -- icon-only now (no text labels); Approve is a
  // single click. Reject opens a small required-note popover right
  // under the icon -- the "Confirm reject" click inside it IS the
  // confirmation step, so it replaces the old modal confirm() that used
  // to ask "Reject this...?" a second time. Shared by every kind that
  // still has a real approve/reject decision here (Extension, Time
  // Entry/Non-project Time) -- Baseline/Closure deep-link to WBS instead
  // (ReviewLink) and Task Completion has no reject concept (ValidateAction).
  // 2026-09-21 (Sandra): clicking Validate now confirms a date first,
  // rather than firing immediately with whatever validate_task_completion
  // would have defaulted to silently -- same default (actual_completion_
  // date, then submitted_on, then today) pre-filled into an editable
  // date input, so the common case (the pre-filled date is correct) is
  // still just one extra click, but a validator who needs to correct it
  // can before it's saved. See decideTaskCompletion's own comment for
  // how this date differs from validation_performed_at.
  //
  // 2026-09-21 follow-up (Sandra: "add a confirmation prompt after
  // click on validate ... confirming that Target Due Date is this and
  // approving or validating that it was completed on this date as the
  // final or approved completion date"): a second, explicit confirm
  // step between choosing the date and it actually saving -- spells out
  // both the (unchangeable) Due Date and the date about to be locked in
  // as the final, approved completion date, so a validator can't
  // mis-click their way into signing off on the wrong date.
  // phase122 (2026-09-25): the paragraph confirm is replaced by
  // ValidateCompletionModal -- Target / Reported / Confirmed as separate
  // rows, a variance line, and a required Reason for adjustment whenever
  // Confirmed differs from Reported.
  function confirmAndValidate(row: TaskCompletionRow, date: string) {
    setValidating({ row, date });
  }

  // 2026-09-22 (Sandra: "Due Date, Reported Completion, Confirm Completion
  // Date, Action -- each in their own column, term them clearly so they
  // don't get confused with each other") -- split from the old single
  // flex block (date input + button together) into two separate <td>
  // cells so TaskCompletionTable can give the input its own labeled
  // column, distinct from the plain Action/Validate button next to it.
  // Terminology, fixed platform-wide (see also Projects.tsx's "Reported
  // Completion"/"Confirm Completion Date" column labels):
  //   - Due Date: the scoped/target date, unchanged reference only.
  //   - Reported Completion: actual_completion_date -- self-reported by
  //     the assignee, already on file (may be "Not set").
  //   - Confirm Completion Date: the editable input here -- the date
  //     that gets locked in as validated_completion_date the moment
  //     Validate is clicked. Pre-filled from Reported Completion (or
  //     submitted_on, or today) same as before.
  // 2026-09-22 (Sandra, on a Baseline mockup: "change action to review
  // WBS") -- gained a `label` prop so BaselineTable's Action button can
  // read "Review WBS" (matching her mockup's plain blue button) while
  // Closure requests, which weren't part of that ask, keep the original
  // "Review in WBS Planning" text link.
  function ReviewLink({ projectId, label = "Review in WBS Planning", button = false }: { projectId: string; label?: string; button?: boolean }) {
    if (button) {
      return (
        <Link
          to={`/projects/${projectId}/wbs`}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
            fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--accent)",
            textDecoration: "none", whiteSpace: "nowrap", padding: "7px 14px", borderRadius: "var(--radius-sm)",
          }}
        >
          {label}
        </Link>
      );
    }
    return (
      <Link
        to={`/projects/${projectId}/wbs`}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}
      >
        {label}
        <ChevronRight size={13} />
      </Link>
    );
  }

  // phase130: who an item is routed to, and whether I may decide it now.
  function gate(key: string, subjectId: string | null, perm: boolean): Pick<Row, "canDecide" | "route" | "actingForName" | "routedToName" | "overridable" | "subjectId"> {
    if (!me || !routing) return { canDecide: perm, route: perm ? "mine" : "team", overridable: false, subjectId };
    const r = routeApproval(routing, subjectId);
    if (r.approverId === me.id) {
      return { canDecide: true, route: r.actingFor ? "acting" : "mine", actingForName: r.actingFor ? personName(r.actingFor) : null, routedToName: null, overridable: false, subjectId };
    }
    return { canDecide: perm && !!overrideReasons[key], route: "team", routedToName: r.approverId ? personName(r.approverId) : null, overridable: perm, subjectId };
  }

  // 2026-10-08 (Sandra, item J): Start Project / Close Project requests are
  // routed (lib/approvalRouting routeProjectRequest, mirrors
  // project_request_approver() in phase172). Staging only (autoOn); live
  // keeps the old "anyone with the right" behaviour.
  function gateProject(key: string, kind: "start" | "close", requesterId: string | null, perm: boolean): Pick<Row, "canDecide" | "route" | "actingForName" | "routedToName" | "overridable" | "subjectId"> {
    const plain = { canDecide: perm, route: (perm ? "mine" : "team") as Row["route"], overridable: false, subjectId: requesterId };
    if (!autoOn || !me || !routing) return plain;
    const r = routeProjectRequest(routing, rights, kind, requesterId);
    if (!r.approverId) return plain;
    if (r.approverId === me.id) {
      return { canDecide: true, route: r.actingFor ? "acting" : "mine", actingForName: r.actingFor ? personName(r.actingFor) : null, routedToName: null, overridable: false, subjectId: requesterId };
    }
    return { canDecide: perm && !!overrideReasons[key], route: "team", routedToName: personName(r.approverId), overridable: perm, subjectId: requesterId };
  }
  function projectRoutedTo(kind: "start" | "close", requesterId: string | null): string | null {
    return routing ? routeProjectRequest(routing, rights, kind, requesterId).approverId : null;
  }

  // Approve inline: run the same checks the WBS page runs for the approver
  // (Start Project: the item F checklist; Close Project: project details +
  // Output Count), then call the SAME RPC the WBS page calls.
  async function approveProjectRequest(kind: "baseline" | "closure", requestId: string, projectId: string, requesterId: string | null) {
    const key = `${kind}-${requestId}`;
    setDecidingKey(key);
    const { plan, error: loadErr } = await loadProjectPlanForDecision(projectId, holidaySet);
    setDecidingKey(null);
    if (!plan) {
      await alert(friendlyError("load this project's plan", (loadErr ?? { message: "Unknown error" }) as { message: string }));
      return;
    }
    if (kind === "baseline") {
      const groups = startProjectChecklist({ project: plan.project, tasks: plan.tasks, dependencyConflicts: plan.dependencyConflicts, pastDated: plan.pastDated, forApprover: true });
      if (groups.length) {
        const blocked = checklistBlocks(groups, true);
        const choice = await showChecklist({
          title: blocked ? "Can't approve yet" : "Approve anyway?",
          message: blocked ? "These need fixing in the plan before the project can start." : "Check these before you approve.",
          groups,
          canOverride: true,
          proceedLabel: "Approve anyway",
          cancelLabel: "Cancel",
          reviewLabel: "Review plan in WBS",
        });
        if (choice === "review") navigate(`/projects/${projectId}/wbs`);
        if (choice !== "proceed") return;
      } else if (
        !(await confirm({
          title: "Approve Start Project?",
          message: "The current plan becomes the project's official commitment and the project is marked as started.",
          items: ["All Start Project checks pass."],
          confirmLabel: "Approve",
        }))
      ) {
        return;
      }
    } else {
      const groups = closeProjectApproverChecklist(plan.project, plan.tasks, plan.outputTypes);
      if (groups.length) {
        const choice = await showChecklist({
          title: "Can't approve yet",
          message: "Fill these in before the Close Project request can be approved.",
          groups,
          canOverride: false,
          proceedLabel: "Approve",
          reviewLabel: "Review plan in WBS",
        });
        if (choice === "review") navigate(`/projects/${projectId}/wbs`);
        return;
      }
      if (
        !(await confirm({
          title: "Approve Close Project?",
          message: "The project is closed with its current plan. Closed projects aren't meant to be reopened casually.",
          confirmLabel: "Approve",
        }))
      )
        return;
    }
    const ovId = await beginOverride(key, kind, requestId, requesterId, projectRoutedTo(kind === "baseline" ? "start" : "close", requesterId));
    if (ovId === false) return;
    setDecidingKey(key);
    const { error } =
      kind === "baseline"
        ? await supabase.rpc("decide_baseline_request", { p_request_id: requestId, p_approve: true, p_reason: null, p_mode: "manual", p_tasks: plan.payload })
        : await supabase.rpc("decide_wbs_closure", { p_request_id: requestId, p_approve: true, p_reason: null, p_tasks: plan.payload });
    setDecidingKey(null);
    if (error) {
      await finishOverride(key, ovId, "failed");
      await alert(friendlyError("approve this request", error));
      return;
    }
    await finishOverride(key, ovId, "approved");
    loadAll();
  }

  // Decline inline. p_tasks is only read on approval by both RPCs, so an
  // empty list is sent here.
  async function declineProjectRequest(reason: string | null, note: string | null) {
    if (!projectDecline) return;
    const { kind, requestId, requesterId, key } = projectDecline;
    const ovId = await beginOverride(key, kind, requestId, requesterId, projectRoutedTo(kind === "baseline" ? "start" : "close", requesterId));
    if (ovId === false) return;
    setDecidingKey(key);
    const { error } =
      kind === "baseline"
        ? await supabase.rpc("decide_baseline_request", { p_request_id: requestId, p_approve: false, p_reason: note, p_mode: "manual", p_tasks: [], p_decline_reason: reason })
        : await supabase.rpc("decide_wbs_closure", { p_request_id: requestId, p_approve: false, p_reason: note, p_tasks: [] });
    setDecidingKey(null);
    if (error) {
      await finishOverride(key, ovId, "failed");
      await alert(friendlyError(kind === "baseline" ? "decline this request" : "reject this request", error));
      return;
    }
    await finishOverride(key, ovId, "rejected");
    setProjectDecline(null);
    loadAll();
  }

  function OverrideButton({ row }: { row: Row }) {
    return (
      <button
        onClick={() => setOverrideTarget(row)}
        title={row.routedToName ? `Routed to ${row.routedToName}` : undefined}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--warning-text, #9a6700)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 9px", cursor: "pointer", whiteSpace: "nowrap" }}
      >
        <ShieldAlert size={12} /> Override
      </button>
    );
  }

  function withActing(g: { route?: string; actingForName?: string | null; canDecide: boolean }, el: JSX.Element | null, key: string): JSX.Element | null {
    if (!el) return null;
    const pill = g.route === "acting" && g.actingForName ? (
      <span className="status-pill purple" style={{ fontSize: 9, padding: "1px 6px", whiteSpace: "nowrap" }}>Acting for {g.actingForName}</span>
    ) : overrideReasons[key] ? (
      <span className="status-pill gold" style={{ fontSize: 9, padding: "1px 6px", whiteSpace: "nowrap" }}>Override</span>
    ) : null;
    if (!pill) return el;
    return (
      <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        {pill}
        {el}
      </div>
    );
  }

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = [];

    extensions.forEach((row) => {
      const key = `ext-${row.id}`;
      const gExt = gate(key, row.requester?.id ?? null, canDecideExtension(row));
      rows.push({
        key,
        kind: "extension",
        personId: row.requester?.id ?? null,
        projectId: row.project?.id ?? row.task?.project_id ?? null,
        typeLabel: row.project ? "Project Timeline Extension" : "Task Extension",
        subject: row.project ? row.project.name : row.task?.name ?? "Untitled task",
        context: row.project ? "Whole project" : row.task?.project?.name ?? "—",
        requestedByName: row.requester?.name ?? "—",
        requestedAt: row.created_at,
        reasonCategory: row.reason_category,
        reasonNotes: row.reason_notes,
        extraLine: `${formatDate(row.project ? row.project.end_date : row.task?.current_due_date)} → ${formatDate(row.requested_new_due_date)}`,
        ...gExt,
        itemId: row.id,
        action: gExt.canDecide
          ? withActing(gExt, <DecideButtons onApprove={() => decideExtension(row, "Approved")} onReject={(n) => decideExtension(row, "Rejected", n)} />, key)
          : null,
        extensionRow: row,
      });
    });

    timeEntries.forEach((row) => {
      const key = `time-${row.id}`;
      // 2026-09-22: a non-project entry has an activity type instead of a
      // task/project -- surfaced the same way, just with a "Non-project"
      // typeLabel instead of "Time Entry" so it reads distinctly in the
      // shared list.
      const isNonProject = Boolean(row.activity_type_id);
      const gTime = gate(key, row.person_id, canDecideTimeEntry(row));
      rows.push({
        key,
        kind: "time",
        personId: row.person_id,
        projectId: row.task?.project_id ?? null,
        typeLabel: isNonProject ? "Non-project Time" : "Time Entry",
        subject: isNonProject ? row.activity_type?.name ?? "Non-project" : row.task?.name ?? "Untitled task",
        context: isNonProject ? "Non-project" : row.task?.project?.name ?? "—",
        requestedByName: row.person?.name ?? "—",
        requestedAt: row.started_at,
        // phase110: follow-up time on a Done task reads as such for the approver.
        reasonCategory: row.is_follow_up
          ? `Follow-up · ${row.follow_up_reason ? FOLLOW_UP_REASON_LABEL[row.follow_up_reason as FollowUpReason] : "after Done"}`
          : row.reason_category,
        reasonNotes: row.reason_notes,
        extraLine: `Logged: ${hours(row.duration_minutes)}`,
        workStartedAt: row.started_at,
        workEndedAt: row.ended_at,
        durationMinutes: row.duration_minutes,
        loggedOnAt: row.created_at,
        logId: timeLogId(row.entry_number),
        taskIdLabel: (row.task as { task_number?: number | null } | null)?.task_number
          ? `T-${String((row.task as { task_number?: number | null }).task_number).padStart(4, "0")}`
          : row.non_project_entry_number
          ? `NP-${String(row.non_project_entry_number).padStart(4, "0")}`
          : "—",
        ...gTime,
        itemId: row.id,
        action: gTime.canDecide
          ? withActing(gTime, <DecideButtons onApprove={() => decideTime(row, "approved")} onReject={(n) => decideTime(row, "rejected", n)} />, key)
          : null,
      });
    });

    correctionRequests.forEach((row) => {
      const key = `corr-${row.id}`;
      const isNonProject = Boolean(row.entry?.activity_type_id);
      const gCorr = gate(key, row.requested_by, canDecideCorrection(row));
      rows.push({
        key,
        kind: "correction",
        personId: row.requested_by,
        projectId: row.entry?.task?.project?.id ?? null,
        searchIds: [timeLogId(row.entry?.entry_number ?? null), row.entry?.task?.task_number ? `T-${String(row.entry.task.task_number).padStart(4, "0")}` : "", row.entry?.non_project_entry_number ? `NP-${String(row.entry.non_project_entry_number).padStart(4, "0")}` : ""].join(" "),
        typeLabel: "Time Correction",
        subject: isNonProject ? row.entry?.activity_type?.name ?? "Non-project" : row.entry?.task?.name ?? "Untitled task",
        context: isNonProject ? "Non-project" : row.entry?.task?.project?.name ?? "—",
        requestedByName: row.requester?.name ?? personName(row.requested_by),
        requestedAt: row.created_at,
        reasonCategory: null,
        reasonNotes: row.reason,
        extraLine: null,
        ...gCorr,
        itemId: row.id,
        action: gCorr.canDecide
          ? withActing(gCorr, <DecideButtons onApprove={() => decideCorrection(row, "approved")} onReject={(n) => decideCorrection(row, "rejected", n)} />, key)
          : null,
        correctionRow: row,
      });
    });

    baselineRequests.forEach((row) => {
      const key = `baseline-${row.id}`;
      const proj = projectById.get(row.project_id);
      const gBl = gateProject(key, "start", row.requested_by, canDecideBaseline);
      rows.push({
        key,
        kind: "baseline",
        personId: row.requested_by,
        projectId: row.project_id,
        typeLabel: "Start Project request",
        subject: proj?.name ?? "Untitled project",
        refId: projectIdLabel(row.project_id),
        context: "Baseline approval",
        requestedByName: personName(row.requested_by),
        requestedAt: row.requested_at,
        reasonCategory: null,
        reasonNotes: "Captures the current plan as the official Baseline and marks the project as started.",
        extraLine: null,
        ...gBl,
        itemId: row.id,
        action: !gBl.canDecide
          ? null
          : autoOn
          ? withActing(
              gBl,
              <ProjectDecisionButtons
                projectId={row.project_id}
                busy={decidingKey === key}
                onApprove={() => approveProjectRequest("baseline", row.id, row.project_id, row.requested_by)}
                onDecline={() => setProjectDecline({ kind: "baseline", requestId: row.id, projectId: row.project_id, requesterId: row.requested_by, key })}
              />,
              key
            )
          : <ReviewLink projectId={row.project_id} label="Review WBS" button />,
        linkProjectId: row.project_id,
      });
    });

    closureRequests.forEach((row) => {
      const key = `closure-${row.id}`;
      const proj = projectById.get(row.project_id);
      const gCl = gateProject(key, "close", row.requested_by, canDecideClosure(row));
      rows.push({
        key,
        kind: "closure",
        personId: row.requested_by,
        projectId: row.project_id,
        typeLabel: "Close Request",
        subject: proj?.name ?? "Untitled project",
        refId: projectIdLabel(row.project_id),
        context: "Closure approval",
        requestedByName: personName(row.requested_by),
        requestedAt: row.requested_at,
        reasonCategory: null,
        reasonNotes: "Locks in the current plan as Final Scope — final, no re-opening.",
        extraLine: null,
        ...gCl,
        itemId: row.id,
        action: !gCl.canDecide
          ? null
          : autoOn
          ? withActing(
              gCl,
              <ProjectDecisionButtons
                projectId={row.project_id}
                busy={decidingKey === key}
                onApprove={() => approveProjectRequest("closure", row.id, row.project_id, row.requested_by)}
                onDecline={() => setProjectDecline({ kind: "closure", requestId: row.id, projectId: row.project_id, requesterId: row.requested_by, key })}
              />,
              key
            )
          : <ReviewLink projectId={row.project_id} />,
      });
    });

    taskCompletions.forEach((row) => {
      // Parent task -- its completion is fully computed from its
      // children and is never independently validated (see the comment
      // on the parent_task_id fetch above). Skip it entirely rather than
      // show a row nobody can ever act on.
      if (parentTaskIds.has(row.id)) return;
      const key = `taskval-${row.id}`;
      const gTask = gate(key, row.assignee_id, canDecideTaskCompletion(row));
      // 2026-09-21 (Sandra: "show in the validation list the Due Date,
      // Actual Completion Date -- tag them accordingly"): both dates
      // surfaced here so a validator can see, before confirming, whether
      // the task finished on time and what completion date they're
      // about to sign off on.
      rows.push({
        key,
        kind: "task_completion",
        personId: row.assignee_id,
        projectId: row.project_id,
        searchIds: row.task_number ? `T-${String(row.task_number).padStart(4, "0")}` : "",
        typeLabel: "Task Completion",
        subject: row.name,
        context: row.project?.name ?? "—",
        requestedByName: personName(row.assignee_id),
        requestedAt: row.actual_completion_date ?? row.submitted_on ?? new Date().toISOString(),
        reasonCategory: null,
        reasonNotes: null,
        // 2026-09-22 (Sandra: "each type has its own table format,
        // group them" + drop Scoped vs Logged): Task Completion now
        // renders as its own real table (TaskCompletionTable) instead
        // of a generic RequestCard, so extraLine/action aren't used for
        // this kind any more -- taskCompletionRow carries the raw row
        // through so the table can read Due Date / Reported Completion
        // straight off it.
        extraLine: null,
        ...gTask,
        itemId: row.id,
        action: null,
        taskCompletionRow: row,
      });
    });

    // phase130: routed elsewhere but I hold the right -> Override button.
    rows.forEach((r) => {
      if (r.route === "team" && r.overridable && !r.canDecide) r.action = <OverrideButton row={r} />;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions, timeEntries, correctionRequests, baselineRequests, closureRequests, taskCompletions, allTimeEntries, parentTaskIds, chainPeople, people, projects, me, routing, overrideReasons, rights, autoOn, decidingKey, holidaySet]);

  // phase130: cards count only the active tab's rows.
  const inTab = (r: Row) => (tab === "mine" ? r.route === "mine" || r.route === "acting" : r.route === "team");
  const mineCount = allRows.filter((r) => r.route === "mine" || r.route === "acting").length;
  const teamCount = allRows.filter((r) => r.route === "team").length;
  const counts = Object.fromEntries(
    (["extension", "time", "correction", "baseline", "closure", "task_completion"] as ApprovalKind[]).map((k) => [k, allRows.filter((r) => r.kind === k && inTab(r)).length])
  ) as Record<ApprovalKind, number>;
  const totalPending = Object.values(counts).reduce((a, b) => a + b, 0);

  const visibleRows = useMemo(() => {
    let rows = allRows.filter(inTab);
    if (kindFilter) rows = rows.filter((r) => r.kind === kindFilter);
    if (personFilter.length) rows = rows.filter((r) => r.personId && personFilter.includes(r.personId));
    if (projectFilter.length) rows = rows.filter((r) => r.projectId && projectFilter.includes(r.projectId));
    // 2026-09-24 (Sandra): search anything -- IDs (TL-/T-/NP-/P-),
    // project, person, task, type, reason.
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const hay = [
          r.subject,
          r.context,
          r.requestedByName,
          r.typeLabel,
          r.reasonCategory,
          r.reasonNotes,
          r.refId,
          r.logId,
          r.taskIdLabel,
          r.searchIds,
          r.projectId ? projectIdLabel(r.projectId) : "",
          r.projectId ? projectById.get(r.projectId)?.name : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return [...rows].sort((a, b) => (sortNewestFirst ? 1 : -1) * (new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, kindFilter, search, sortNewestFirst, personFilter, projectFilter, tab]);

  const personFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    allRows.forEach((r) => {
      if (r.personId && !m.has(r.personId)) m.set(r.personId, r.requestedByName);
    });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);
  const projectFilterOptions = useMemo(() => {
    const m = new Map<string, string>();
    allRows.forEach((r) => {
      if (r.projectId && !m.has(r.projectId)) m.set(r.projectId, projectById.get(r.projectId)?.name ?? r.context);
    });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows]);

  const showTeamTab = isFullAccess || teamCount > 0;

  function AllRequestsSummaryCard() {
    const active = kindFilter === null;
    return (
      <button
        onClick={() => setKindFilter(null)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flex: "1 1 220px",
          minWidth: 220,
          textAlign: "left",
          padding: "14px 16px",
          borderRadius: "var(--radius)",
          border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
          background: "var(--surface)",
          cursor: "pointer",
        }}
      >
        <span className="status-pill slate" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, flexShrink: 0 }}>
          <Clock size={15} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>All Requests</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", lineHeight: 1.15 }}>{totalPending}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{tab === "mine" ? "Awaiting your approval" : "Routed to others"}</div>
        </div>
        <ChevronRight size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
      </button>
    );
  }

  function SummaryCard({ kind }: { kind: ApprovalKind }) {
    const meta = KIND_META[kind];
    const active = kindFilter === kind;
    return (
      <button
        onClick={() => setKindFilter((prev) => (prev === kind ? null : kind))}
        className={`status-pill ${meta.tone}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flex: "1 1 220px",
          minWidth: 220,
          textAlign: "left",
          padding: "14px 16px",
          borderRadius: "var(--radius)",
          border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
          background: "var(--surface)",
          cursor: "pointer",
          textTransform: "none",
          letterSpacing: "normal",
          fontWeight: 400,
        }}
      >
        <span className={`status-pill ${meta.tone}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, flexShrink: 0 }}>
          {meta.icon}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--navy)" }}>{meta.pluralLabel}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", lineHeight: 1.15 }}>{counts[kind]}</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{tab === "mine" ? "Awaiting your approval" : "Routed to others"}</div>
        </div>
        <ChevronRight size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
      </button>
    );
  }

  function RequestCard({ row }: { row: Row }) {
    const meta = KIND_META[row.kind];
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
          padding: 16,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          background: "var(--surface)",
          marginBottom: 10,
        }}
      >
        <span className={`status-pill ${meta.tone}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, flexShrink: 0 }}>
          {meta.icon}
        </span>

        <div style={{ minWidth: 190, flex: "1 1 190px" }}>
          <span className={`status-pill ${meta.tone}`} style={{ fontSize: 9.5, marginBottom: 4, display: "inline-block" }}>
            {row.typeLabel}
          </span>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>
            {row.refId && <span style={{ marginRight: 6, color: "var(--accent)" }}>{row.refId}</span>}
            {row.subject}
          </div>
        </div>

        <div style={{ minWidth: 170, flex: "1 1 170px", display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--text-secondary)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Folder size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
            {row.context}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <User size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
            {row.requestedByName}
          </span>
          {/* 2026-09-21 (Sandra: "remove that date"): the requestedAt line
              is redundant for Task Completion rows specifically -- it
              just repeats Actual Completion Date (or falls back to
              Submitted On/today), which is already shown, labeled, in
              the Due Date/Actual Completion block below. Kept for every
              other kind, where it's the one and only "when was this
              requested" signal. */}
          {row.kind !== "task_completion" && (
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <Calendar size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
              {formatDate(row.requestedAt)}
            </span>
          )}
        </div>

        <div style={{ minWidth: 220, flex: "1 1 220px", fontSize: 11 }}>
          {row.reasonCategory && (
            <>
              <span style={{ fontSize: 9.5, color: "var(--muted)", marginRight: 5 }}>Reason</span>
              <span className="status-pill neutral" style={{ fontSize: 9.5 }}>
                {row.reasonCategory}
              </span>
            </>
          )}
          {row.reasonNotes && <div style={{ color: "var(--text-secondary)", marginTop: 3 }}>{row.reasonNotes}</div>}
          {row.extraLine && <div style={{ fontWeight: 700, color: "var(--navy)", marginTop: 3, whiteSpace: "pre-line" }}>{row.extraLine}</div>}
        </div>

        <div style={{ marginLeft: "auto", flexShrink: 0 }}>{row.action ?? <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}</div>
      </div>
    );
  }

  // 2026-09-22 (Sandra: "replace actions with... check/x icons only" --
  // rebuilds the Time Entry / Non-project Time rows as the same
  // 8-column table Time Tracking's own "Needs your decision" list uses,
  // while every other kind keeps its existing card. RequestList groups
  // consecutive same-kind runs so the overall sort/search/filter order
  // is unchanged -- a run of time-kind rows becomes one table, a run of
  // anything else stays individual RequestCards.
  function TimeEntryTable({ rows }: { rows: Row[] }) {
    const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
    const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
    return (
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Log ID</th>
              <th style={th}>Task ID</th>
              <th style={th}>Task / Project</th>
              <th style={th}>Assignee</th>
              <th style={th}>Work Date</th>
              <th style={th}>Time</th>
              <th style={th}>Duration</th>
              <th style={th}>Details</th>
              <th style={th}>Requested On</th>
              <th style={{ ...th, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isFollowUp = (row.reasonCategory ?? "").startsWith("Follow-up");
              const details = isFollowUp ? row.reasonNotes?.trim() || "—" : row.reasonNotes?.trim() || row.reasonCategory || "—";
              return (
                <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{row.logId ?? "—"}</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{row.taskIdLabel ?? "—"}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: "var(--navy)" }}>{row.subject}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{row.context}</div>
                  </td>
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
                        {initials(row.requestedByName)}
                      </span>
                      {row.requestedByName}
                      {row.kind === "task_completion" && (row.route === "acting" || overrideReasons[row.key]) && (
                        <span className={`status-pill ${row.route === "acting" ? "purple" : "gold"}`} style={{ fontSize: 9, padding: "1px 6px", whiteSpace: "nowrap" }}>
                          {row.route === "acting" ? `Acting for ${row.actingForName}` : "Override"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{row.workStartedAt ? formatWorkDate(row.workStartedAt) : "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{row.workStartedAt ? formatClockRange(row.workStartedAt, row.workEndedAt) : "—"}</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{formatDuration(row.durationMinutes ?? null)}</td>
                  <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={details !== "—" ? details : undefined}>
                    {isFollowUp && (
                      <div style={{ marginBottom: 2 }}>
                        <span className="status-pill gold" style={{ fontSize: 9, padding: "1px 5px" }}>{row.reasonCategory}</span>
                      </div>
                    )}
                    {details}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{row.loggedOnAt ? formatDateTime(row.loggedOnAt) : "—"}</td>
                  <td style={{ ...td, textAlign: "center" }}>{row.action ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // 2026-09-22 (Sandra: "each type has its own table format, group
  // them" + terminology cleanup): Task Completion gets the same real-
  // table treatment TimeEntryTable already has, instead of the generic
  // RequestCard. Six columns: Task/Project, Assignee, Due Date,
  // Reported Completion, Confirm Completion Date, Action -- see
  // ValidateActionCells above for what the last two mean and why
  // they're split into two cells instead of one combined block.
  // 2026-09-23 (phase102, phase 2): Current vs Proposed side by side so
  // the approver sees exactly what changes, plus the net hours delta.
  function CorrectionTable({ rows }: { rows: Row[] }) {
    const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
    const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
    const mins = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
    return (
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Log ID</th>
              <th style={th}>Task ID</th>
              <th style={th}>Task / Project</th>
              <th style={th}>Requested By</th>
              <th style={th}>Work Date</th>
              <th style={th}>Current</th>
              <th style={th}>Proposed</th>
              <th style={th}>Change</th>
              <th style={th}>Reason</th>
              <th style={th}>Requested On</th>
              <th style={{ ...th, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const c = row.correctionRow!;
              const cur = mins(c.current_started_at, c.current_ended_at);
              const prop = mins(c.proposed_started_at, c.proposed_ended_at);
              const delta = prop - cur;
              const idLabel = c.entry?.task?.task_number
                ? `T-${String(c.entry.task.task_number).padStart(4, "0")}`
                : c.entry?.non_project_entry_number
                ? `NP-${String(c.entry.non_project_entry_number).padStart(4, "0")}`
                : "—";
              return (
                <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{timeLogId(c.entry?.entry_number)}</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{idLabel}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: "var(--navy)" }}>{row.subject}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{row.context}</div>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: "50%", background: "var(--accent-bg, #eaf2fb)", color: "var(--accent)", fontSize: 9.5, fontWeight: 700, flexShrink: 0 }}>
                        {initials(row.requestedByName)}
                      </span>
                      {row.requestedByName}
                      {row.kind === "task_completion" && (row.route === "acting" || overrideReasons[row.key]) && (
                        <span className={`status-pill ${row.route === "acting" ? "purple" : "gold"}`} style={{ fontSize: 9, padding: "1px 6px", whiteSpace: "nowrap" }}>
                          {row.route === "acting" ? `Acting for ${row.actingForName}` : "Override"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatWorkDate(c.proposed_started_at)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "var(--muted)" }}>
                    {formatClockRange(c.current_started_at, c.current_ended_at)}
                    <div style={{ fontSize: 10 }}>{formatDuration(cur)}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: "var(--navy)" }}>
                    {formatClockRange(c.proposed_started_at, c.proposed_ended_at)}
                    <div style={{ fontSize: 10, fontWeight: 400 }}>{formatDuration(prop)}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span className={`status-pill ${delta > 0 ? "gold" : delta < 0 ? "skyblue" : "neutral"}`} style={{ fontSize: 9.5 }}>
                      {delta === 0 ? "Same hours" : `${delta > 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}`}
                    </span>
                  </td>
                  <td style={{ ...td, maxWidth: 220, whiteSpace: "normal", wordBreak: "break-word" }}>{c.reason}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDateTime(c.created_at)}</td>
                  <td style={{ ...td, textAlign: "center" }}>{row.action ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // phase169 (Sandra): Early = approver validates; On the due date =
  // auto-validates after 2 working days unless held; Late = auto-validated
  // on report (so it rarely shows here).
  function TimingCell(tc: TaskCompletionRow, canDecide: boolean) {
    const timing = completionTiming(tc.current_due_date, tc.actual_completion_date);
    if (!timing) return <span style={{ color: "var(--muted)" }}>—</span>;
    const tone = timing === "early" ? "purple" : timing === "late" ? "orange" : "blue";
    const autoDate = timing === "on_due" ? autoValidateOn(tc.submitted_on ?? tc.actual_completion_date, holidaySet) : null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        <span className={`status-pill ${tone}`} style={{ fontSize: 10, whiteSpace: "nowrap" }}>{COMPLETION_TIMING_LABEL[timing]}</span>
        {timing === "early" && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>Needs your validation</span>}
        {timing === "on_due" && !tc.validation_hold && autoDate && <span style={{ fontSize: 10.5, color: "var(--muted)", whiteSpace: "nowrap" }}>Auto-validates {formatDate(autoDate)}</span>}
        {timing === "on_due" && tc.validation_hold && <span className="status-pill gold" style={{ fontSize: 9.5, whiteSpace: "nowrap" }}>On hold for review</span>}
        {timing === "on_due" && canDecide && (
          <button
            onClick={async () => {
              const res = await setValidationHold(tc.id, !tc.validation_hold);
              if (res.error) { await alert(friendlyError("update the hold", res.error)); return; }
              loadAll();
            }}
            style={{ fontSize: 10.5, fontWeight: 600, color: "var(--accent)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {tc.validation_hold ? "Release hold" : "Hold for review"}
          </button>
        )}
      </div>
    );
  }

  function TaskCompletionTable({ rows }: { rows: Row[] }) {
    const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
    const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
    return (
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Task ID</th>
              <th style={th}>Task / Project</th>
              <th style={th}>Assignee</th>
              <th style={th}>Due Date</th>
              <th style={th}>Reported Completion</th>
              {autoOn && <th style={th}>Timing</th>}
              <th style={th}>Validated date</th>
              <th style={{ ...th, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tc = row.taskCompletionRow;
              if (!tc) return null;
              return (
                <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{tc.task_number ? `T-${String(tc.task_number).padStart(4, "0")}` : "—"}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700, color: "var(--navy)" }}>{row.subject}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{row.context}</div>
                  </td>
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
                        {initials(row.requestedByName)}
                      </span>
                      {row.requestedByName}
                      {row.kind === "task_completion" && (row.route === "acting" || overrideReasons[row.key]) && (
                        <span className={`status-pill ${row.route === "acting" ? "purple" : "gold"}`} style={{ fontSize: 9, padding: "1px 6px", whiteSpace: "nowrap" }}>
                          {row.route === "acting" ? `Acting for ${row.actingForName}` : "Override"}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(tc.current_due_date)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{tc.actual_completion_date ? formatDate(tc.actual_completion_date) : "Not set"}</td>
                  {autoOn && <td style={td}>{TimingCell(tc, row.canDecide)}</td>}
                  {row.canDecide ? (
                    <ValidateActionCells row={tc} busy={decidingKey === `taskval-${tc.id}`} onValidate={(d) => confirmAndValidate(tc, d)} />
                  ) : (
                    <>
                      <td style={td}>—</td>
                      <td style={{ ...td, textAlign: "center", color: "var(--muted)" }}>{row.overridable ? <OverrideButton row={row} /> : "—"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // 2026-09-22 (Sandra: "group them per request, then sort by orders to
  // new per request by default, but allow sort vice versa") -- groups a
  // (single-kind, already-sorted) row list by requester. Since `rows` is
  // already sorted by requestedAt per sortNewestFirst before this runs,
  // a plain first-seen-order groupBy naturally puts whichever person's
  // single most-recent (or oldest, when the sort is flipped) request
  // comes first -- no separate group-level sort needed, flipping the
  // Sort button flips both row order AND group order for free.
  // 2026-09-22 (Sandra: "not applied in approval center" -- the same
  // real-table + icon check/cross treatment ExtensionRequests.tsx got
  // needs to show up here too). Same 9 columns: Task/Project, Assignee,
  // Current Deadline, Requested Deadline, Extension, Reason, Requested
  // On, Status, Action. This page's extension query is Pending-only, so
  // Status always reads PENDING here (no decided-by history to show,
  // unlike the standalone page).
  function ExtensionTable({ rows }: { rows: Row[] }) {
    const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
    const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
    return (
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Task / Project</th>
              <th style={th}>Assignee</th>
              <th style={th}>Current Deadline</th>
              <th style={th}>Requested Deadline</th>
              <th style={th}>Extension</th>
              <th style={th}>Reason</th>
              <th style={th}>Requested On</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ext = row.extensionRow;
              if (!ext) return null;
              const isProjectLevel = !!ext.project;
              const currentDeadline = ext.project ? ext.project.end_date : ext.task?.current_due_date ?? null;
              // 2026-10-02 (Sandra): working days shown; calendar days in the tooltip.
              const extensionDays = currentDeadline ? workingDayDelta(currentDeadline, ext.requested_new_due_date, holidaySet) : null;
              const assigneeId = isProjectLevel ? null : ext.task?.assignee_id ?? null;
              const onBehalf = !isProjectLevel && ext.requester && assigneeId && ext.requester.id !== assigneeId;
              return (
                <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span className={`status-pill ${isProjectLevel ? "accent" : "gold"}`} style={{ fontSize: 9 }}>
                        {isProjectLevel ? "Project Timeline" : "Task Extension"}
                      </span>
                      {ext.is_manager_initiated && <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }}>(manager-initiated)</span>}
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--navy)", marginTop: 3 }}>{row.subject}</div>
                    <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{row.context}</div>
                  </td>
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
                        {initials(row.requestedByName)}
                      </span>
                      {row.requestedByName}
                      {row.kind === "task_completion" && (row.route === "acting" || overrideReasons[row.key]) && (
                        <span className={`status-pill ${row.route === "acting" ? "purple" : "gold"}`} style={{ fontSize: 9, padding: "1px 6px", whiteSpace: "nowrap" }}>
                          {row.route === "acting" ? `Acting for ${row.actingForName}` : "Override"}
                        </span>
                      )}
                    </div>
                    {onBehalf && (
                      <div style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 2 }}>(on behalf: {personName(assigneeId)})</div>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(currentDeadline)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(ext.requested_new_due_date)}</td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>
                    {extensionDays === null ? "—" : <span title={currentDeadline ? `${daysBetween(currentDeadline, ext.requested_new_due_date)} calendar days` : undefined}>{formatWorkingDayDelta(extensionDays)}</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 220, whiteSpace: "normal", wordBreak: "break-word" }}>
                    <span className="status-pill neutral" style={{ fontSize: 9.5 }}>
                      {ext.reason_category}
                    </span>
                    {ext.reason_notes && <div style={{ marginTop: 3 }}>{ext.reason_notes}</div>}
                    {ext.auto_check_note && <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--muted)", fontStyle: "italic" }}>Needs approval: {ext.auto_check_note}</div>}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(row.requestedAt)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span className="status-pill warning">PENDING</span>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>{row.action ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // 2026-09-22 (Sandra, on a screenshot of the Baseline cards: "now
  // baseline approvals, please change action to review WBS") -- same
  // real-table treatment as ExtensionTable/TaskCompletionTable. Columns
  // match her mockup: Project, Owner, Baseline Date, What Approval Does,
  // Status, Action -- Action is a solid button reading "Review WBS"
  // (ReviewLink's `button` variant) instead of the plain text link Baseline
  // shared with Closure requests before. Closure requests weren't part of
  // this ask and still use RequestCard + the original text-link ReviewLink.
  function BaselineTable({ rows }: { rows: Row[] }) {
    const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap" };
    const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
    return (
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)", marginBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2, #f5f6f8)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
              <th style={th}>Project ID</th>
              <th style={th}>Project</th>
              <th style={th}>Owner</th>
              <th style={th}>Baseline Date</th>
              <th style={th}>What Approval Does</th>
              <th style={th}>Status</th>
              <th style={{ ...th, textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{row.refId ?? "—"}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700, color: "var(--navy)" }}>{row.subject}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{row.context}</div>
                </td>
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
                      {initials(row.requestedByName)}
                    </span>
                    <div>
                      {row.requestedByName}
                      <div style={{ fontSize: 9.5, color: "var(--muted)" }}>Project Owner</div>
                    </div>
                  </div>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{formatWorkDate(row.requestedAt)}</td>
                <td style={{ ...td, maxWidth: 280, whiteSpace: "normal", wordBreak: "break-word" }}>{row.reasonNotes}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <span className="status-pill warning">PENDING</span>
                </td>
                <td style={{ ...td, textAlign: "center" }}>{row.action ?? <span style={{ color: "var(--muted)" }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 2026-09-22 (Sandra: "do not group by name, just type. also can it
  // be collapsed by default and when the header is clicked then it
  // expands -- the header will be the trigger for expand and collapse")
  // -- drops the requester sub-grouping this same session added earlier
  // today: each kind is still always its own section (unchanged reason,
  // see below), but rows within it render as one flat table/list again,
  // no per-person headers. Each section now starts collapsed and only
  // renders its body once its header is clicked -- with 26 pending
  // items across 4 types, a collapsed-by-default header row per type
  // (Extension Requests (1), Time Entries (1), Baselines (2), Task
  // Validations (22)) is a much shorter default view than expanding all
  // 22 task validations immediately.
  function KindSection({ kind, rows, expanded, onToggle }: { kind: ApprovalKind; rows: Row[]; expanded: boolean; onToggle: () => void }) {
    if (rows.length === 0) return null;
    const meta = KIND_META[kind];
    return (
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={onToggle}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
            padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)", cursor: "pointer", marginBottom: expanded ? 8 : 0,
          }}
        >
          <ChevronRight size={14} style={{ color: "var(--muted)", flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
          <span className={`status-pill ${meta.tone}`} style={{ fontSize: 10 }}>
            {meta.pluralLabel}
          </span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>({rows.length})</span>
        </button>
        {expanded &&
          (kind === "time" ? (
            TimeEntryTable({ rows })
          ) : kind === "correction" ? (
            CorrectionTable({ rows })
          ) : kind === "task_completion" ? (
            TaskCompletionTable({ rows })
          ) : kind === "extension" ? (
            ExtensionTable({ rows })
          ) : kind === "baseline" ? (
            BaselineTable({ rows })
          ) : (
            rows.map((row) => <Fragment key={row.key}>{RequestCard({ row })}</Fragment>)
          ))}
      </div>
    );
  }

  // Fixed section order -- same order the summary cards already use, so
  // the page reads consistently top to bottom regardless of what's
  // currently pending. Sections with 0 matching rows just don't render
  // (KindSection returns null).
  const KIND_ORDER: ApprovalKind[] = ["extension", "time", "correction", "baseline", "closure", "task_completion"];

  function RequestList({ rows, emptyLabel }: { rows: Row[]; emptyLabel: string }) {
    if (rows.length === 0) {
      return <p style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>{emptyLabel}</p>;
    }
    return (
      <div>
        {KIND_ORDER.map((kind) => (
          <Fragment key={kind}>
            {KindSection({
              kind,
              rows: rows.filter((r) => r.kind === kind),
              expanded: expandedKinds.has(kind),
              onToggle: () =>
                setExpandedKinds((prev) => {
                  const next = new Set(prev);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                }),
            })}
          </Fragment>
        ))}
      </div>
    );
  }

  if (summaryOnly) {
    if (loading) return null;
    const mineRows = allRows.filter((r) => r.route === "mine" || r.route === "acting");
    const kinds = (["extension", "time", "correction", "baseline", "closure", "task_completion"] as ApprovalKind[])
      .map((k) => ({ k, n: mineRows.filter((r) => r.kind === k).length }))
      .filter((x) => x.n > 0);
    const oldest = mineRows.reduce<string | null>((o, r) => (!o || r.requestedAt < o ? r.requestedAt : o), null);
    const oldestDays = oldest ? Math.floor((Date.now() - new Date(oldest).getTime()) / 86400000) : 0;
    const cardStyle: CSSProperties = {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 14px",
      borderRadius: "var(--radius)",
      border: "1px solid var(--border)",
      background: "var(--surface)",
      textDecoration: "none",
      minWidth: 0,
    };
    return (
      <div className="dash-card" style={{ padding: "14px 20px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: mineRows.length ? 10 : 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--navy)" }}>Awaiting My Approval</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            {mineRows.length
              ? `${mineRows.length} request${mineRows.length === 1 ? "" : "s"} · oldest ${oldestDays === 0 ? "today" : `${oldestDays} day${oldestDays === 1 ? "" : "s"} ago`}`
              : "You're all caught up — nothing waiting for you."}
          </span>
          <Link to="/approval-center" style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Open Approval Center →
          </Link>
        </div>
        {kinds.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10 }}>
            {kinds.map(({ k, n }) => {
              const meta = KIND_META[k];
              return (
                <Link key={k} to={`/approval-center?kind=${k}`} style={cardStyle} title={`Open ${meta.pluralLabel} in Mine to approve`}>
                  <span className={`status-pill ${meta.tone}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}>
                    {meta.icon}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--navy)" }}>{meta.pluralLabel}</span>
                    <span style={{ display: "block", fontSize: 20, fontWeight: 700, color: "var(--navy)", lineHeight: 1.15 }}>{n}</span>
                  </span>
                  <ChevronRight size={15} style={{ marginLeft: "auto", color: "var(--muted)", flexShrink: 0 }} />
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (loading) return <p style={{ padding: 20, color: "var(--muted)" }}>Loading…</p>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ marginBottom: 2 }}>Approval Center</h1>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}>
          {hasAuthority ? "Review requests routed to you, and track the ones you've sent in My Requests." : "Track everything you've submitted for approval and its outcome."}
        </p>
      </div>

      {(() => {
        if (!me || !routing || tab === "requests") return null;
        const mine = activeDelegationFor(routing, me.id);
        const covering = routing.delegations.filter((d) => d.delegate_id === me.id && !d.cancelled_at && d.start_date <= routing.today && d.end_date >= routing.today);
        const banner = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "8px 12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--surface)", marginBottom: 10, color: "var(--text-secondary)" } as const;
        return (
          <>
            {mine && (
              <div style={banner}>
                <UserCheck size={14} style={{ color: "var(--accent)" }} />
                Your approvals are delegated to <strong style={{ color: "var(--navy)" }}>{personName(mine.delegate_id)}</strong> until {formatDate(mine.end_date)}.
              </div>
            )}
            {covering.map((d) => (
              <div key={d.id} style={banner}>
                <UserCheck size={14} style={{ color: "var(--accent)" }} />
                You're covering approvals for <strong style={{ color: "var(--navy)" }}>{personName(d.delegator_id)}</strong> until {formatDate(d.end_date)} — tagged "Acting for" in Mine to approve.
              </div>
            ))}
          </>
        );
      })()}

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, borderBottom: "1px solid var(--border)" }}>
        {([
          ...(hasAuthority ? [["mine", `Mine to approve (${mineCount})`]] : []),
          ...(hasAuthority && showTeamTab ? [["team", `Team view (${teamCount})`]] : []),
          ["requests", "My Requests"],
          ...(hasAuthority && autoOn ? [["auto", "Auto-approved"]] : []),
        ] as [("mine" | "team" | "requests" | "auto"), string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setTab(k); setKindFilter(null); }}
            style={{ fontSize: 12.5, fontWeight: 600, padding: "8px 12px", background: "none", border: "none", borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent", color: tab === k ? "var(--navy)" : "var(--muted)", cursor: "pointer", marginBottom: -1 }}
          >
            {label}
          </button>
        ))}
        {hasAuthority && tab !== "requests" && tab !== "auto" && <button
          onClick={() => setDelegateOpen(true)}
          style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 10px", cursor: "pointer", marginBottom: 6 }}
        >
          <UserCheck size={13} /> Delegate approvals
        </button>}
      </div>
      {tab === "team" && (
        <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: -6, marginBottom: 12 }}>
          Read-only. These are routed to someone else — use Override (reason required) only when needed.
        </p>
      )}

      {tab === "requests" && me && <MyRequestsPanel meId={me.id} />}
      {tab === "auto" && me && (
        <AutoApprovedPanel
          meId={me.id}
          isFullAccess={isFullAccess}
          routing={routing}
          personName={(id) => personName(id ?? null)}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          onChanged={() => loadAll()}
        />
      )}
      {tab !== "requests" && tab !== "auto" && (
        <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {AllRequestsSummaryCard()}
        {SummaryCard({ kind: "extension" })}
        {SummaryCard({ kind: "time" })}
        {SummaryCard({ kind: "correction" })}
        {SummaryCard({ kind: "baseline" })}
        {SummaryCard({ kind: "closure" })}
        {SummaryCard({ kind: "task_completion" })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
          <input
            type="text"
            placeholder="Search by ID (TL-, T-, P-), project, person…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px 7px 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
          />
        </div>
        <MultiSelectFilter options={personFilterOptions} selected={personFilter} onChange={setPersonFilter} noun="people" singular="Person" />
        <MultiSelectFilter options={projectFilterOptions} selected={projectFilter} onChange={setProjectFilter} noun="projects" singular="Project" />
        <button
          onClick={() => setSortNewestFirst((v) => !v)}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-secondary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 10px", cursor: "pointer" }}
        >
          <ArrowUpDown size={13} />
          Sort: {sortNewestFirst ? "Newest first" : "Oldest first"}
        </button>
        <button
          onClick={() => loadAll()}
          title="Refresh"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, color: "var(--text-secondary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {tab === "mine"
        ? RequestList({ rows: visibleRows, emptyLabel: "Nothing is routed to you right now." })
        : RequestList({ rows: visibleRows, emptyLabel: "Nothing pending for others." })}

      {tab === "team" && recentOverrides.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 13 }}>Overrides — last 30 days ({recentOverrides.length})</h2>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
            {recentOverrides.map((o) => (
              <div key={o.id} style={{ display: "flex", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11.5, color: "var(--text-secondary)" }}>
                <span style={{ whiteSpace: "nowrap", color: "var(--muted)" }}>{formatDateTime(o.created_at)}</span>
                <span style={{ flex: 1 }}>
                  <strong style={{ color: "var(--navy)" }}>{personName(o.overridden_by)}</strong> {o.decision} a {KIND_META[o.kind as ApprovalKind]?.label ?? o.kind} for {personName(o.subject_person_id)}
                  {o.routed_approver_id ? <> (routed to {personName(o.routed_approver_id)})</> : null} — <em>{o.reason}</em>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

        </>
      )}

      {overrideTarget && (
        <OverrideReasonModal
          itemLabel={`${overrideTarget.typeLabel}: ${overrideTarget.subject} (${overrideTarget.requestedByName})`}
          approverName={overrideTarget.routedToName ?? null}
          onCancel={() => setOverrideTarget(null)}
          onConfirm={(reason) => {
            setOverrideReasons((prev) => ({ ...prev, [overrideTarget.key]: reason }));
            setOverrideTarget(null);
          }}
        />
      )}
      {delegateOpen && me && (
        <DelegateApprovalsModal
          meId={me.id}
          isFullAccess={isFullAccess}
          people={people}
          delegations={routing?.delegations ?? []}
          onClose={() => setDelegateOpen(false)}
          onChanged={() => loadAll()}
        />
      )}
      {confirmDialog}
      {checklistDialog}
      {projectDecline && (
        <ProjectDeclineModal
          kind={projectDecline.kind}
          projectName={projectById.get(projectDecline.projectId)?.name ?? "This project"}
          reasons={declineReasons}
          busy={decidingKey === projectDecline.key}
          onCancel={() => setProjectDecline(null)}
          onSubmit={(reason, note) => declineProjectRequest(reason, note)}
        />
      )}
      {validating && (
        <ValidateCompletionModal
          taskName={validating.row.name}
          taskId={validating.row.task_number ? `T-${String(validating.row.task_number).padStart(4, "0")}` : null}
          targetDueDate={validating.row.current_due_date}
          reportedDate={validating.row.actual_completion_date}
          confirmedDate={validating.date}
          busy={decidingKey === `taskval-${validating.row.id}`}
          error={validating.error}
          onCancel={() => setValidating(null)}
          onValidate={(reason) => decideTaskCompletion(validating.row, validating.date, reason)}
        />
      )}
    </div>
  );
}
