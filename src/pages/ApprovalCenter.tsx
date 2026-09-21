import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { formatDate } from "../lib/formatDate";
import { decideTimeEntry } from "../lib/timeTracking";

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
  task_id: string;
  person_id: string;
  started_at: string;
  duration_minutes: number | null;
  requested_by: string | null;
  reason_category: string | null;
  reason_notes: string | null;
  task: {
    id: string;
    name: string;
    project_id: string;
    project: { id: string; name: string; owner_id: string | null } | null;
  } | null;
  person: { id: string; name: string } | null;
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
  assignee_id: string | null;
  project_id: string;
  current_due_date: string | null;
  actual_completion_date: string | null;
  submitted_on: string | null;
  project: { id: string; name: string; owner_id: string | null; wbs_status: string | null } | null;
}

function hours(minutes: number | null): string {
  if (!minutes) return "0h";
  return `${(minutes / 60).toFixed(1)}h`;
}

// Request type -- a stable discriminator used both for the type filter
// (the summary cards) and the color-coded pill/icon, kept separate from
// typeLabel so the two extension sub-labels ("Task extension" / "Project
// timeline extension") still filter and color together as one type.
type ApprovalKind = "extension" | "time" | "baseline" | "closure" | "task_completion";

// Same tone names index.css already defines for .status-pill.<tone> --
// reused here for the summary-card icon squares too, so a request's
// color means the same thing everywhere on this page.
const KIND_META: Record<ApprovalKind, { label: string; pluralLabel: string; tone: string; icon: JSX.Element }> = {
  extension: { label: "Task Extension", pluralLabel: "Extension Requests", tone: "gold", icon: <CalendarClock size={13} /> },
  time: { label: "Time Entry", pluralLabel: "Time Entries", tone: "accent", icon: <Timer size={13} /> },
  baseline: { label: "Baseline Approval", pluralLabel: "Baselines", tone: "purple", icon: <ShieldCheck size={13} /> },
  closure: { label: "Project Close Request", pluralLabel: "Project Close Requests", tone: "mint", icon: <FolderCheck size={13} /> },
  task_completion: { label: "Task Completion", pluralLabel: "Task Validations", tone: "success", icon: <ListChecks size={13} /> },
};

// Shared row chrome for every approval type -- kept as one generic shape
// so the request-card list below doesn't need four separate render
// paths.
interface Row {
  key: string;
  kind: ApprovalKind;
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
}

export default function ApprovalCenter() {
  const { person: me } = useSession();
  const { confirm, alert, dialog: confirmDialog } = useConfirm();

  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntryRowLite[]>([]);
  const [baselineRequests, setBaselineRequests] = useState<BaselineRow[]>([]);
  const [closureRequests, setClosureRequests] = useState<ClosureRow[]>([]);
  const [taskCompletions, setTaskCompletions] = useState<TaskCompletionRow[]>([]);
  // Unfiltered (includes inactive) id/reports_to/is_active projection,
  // separate from the active-only `people` state above -- needed to walk
  // PAST an inactive immediate manager to find the nearest active one
  // above them, same reason Projects.tsx keeps its own `chainPeople`
  // alongside its active-only `people`.
  const [chainPeople, setChainPeople] = useState<{ id: string; reports_to: string | null; is_active: boolean }[]>([]);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  // Type filter -- clicking a summary card sets this to that kind; click
  // the same card again (or there's nothing else to clear to) resets it
  // to null, meaning "All".
  const [kindFilter, setKindFilter] = useState<ApprovalKind | null>(null);
  const [search, setSearch] = useState("");
  const [sortNewestFirst, setSortNewestFirst] = useState(true);

  async function loadAll() {
    setLoading(true);
    const [{ data: peopleData }, { data: chainPeopleData }, { data: projectData }, { data: extData }, { data: teData }, { data: blData }, { data: clData }, { data: tcData }] = await Promise.all([
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("people").select("id,reports_to,is_active"),
      supabase.from("projects").select("id,name,owner_id,wbs_status"),
      supabase
        .from("extension_requests")
        .select(
          `id, requested_new_due_date, request_type, reason_category, reason_notes, created_at, is_manager_initiated,
           task:tasks!extension_requests_task_id_fkey ( id, name, assignee_id, current_due_date, project_id, project:projects ( id, name, owner_id ) ),
           project:projects!extension_requests_project_id_fkey ( id, name, owner_id, end_date ),
           requester:people!extension_requests_requested_by_fkey ( id, name )`
        )
        .eq("status", "Pending")
        .order("created_at", { ascending: false }),
      supabase
        .from("time_entries")
        .select(
          `id, task_id, person_id, started_at, duration_minutes, requested_by, reason_category, reason_notes,
           task:tasks ( id, name, project_id, project:projects ( id, name, owner_id ) ),
           person:people!time_entries_person_id_fkey ( id, name )`
        )
        .eq("status", "pending_approval")
        .order("started_at", { ascending: false }),
      supabase.from("project_baseline_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
      supabase.from("project_closure_requests").select("id,project_id,requested_by,requested_at").eq("status", "pending").order("requested_at", { ascending: false }),
      supabase
        .from("tasks")
        .select(
          `id, name, assignee_id, project_id, current_due_date, actual_completion_date, submitted_on,
           project:projects ( id, name, owner_id, wbs_status )`
        )
        .eq("status", "Done")
        .is("validated_completion_date", null)
        .eq("is_archived", false)
        .order("submitted_on", { ascending: false }),
    ]);
    setPeople((peopleData as PersonLite[]) ?? []);
    setProjects((projectData as ProjectLite[]) ?? []);
    // Same start_date-request filter ExtensionRequests.tsx applies -- that
    // per-task request type was removed 2026-08-27 (start dates only
    // change via Re-baseline now); old rows are left in the table but
    // never surfaced anywhere, including here.
    setExtensions((((extData as unknown as ExtensionRow[]) ?? [])).filter((r) => r.request_type !== "start_date"));
    setTimeEntries((teData as unknown as TimeEntryRowLite[]) ?? []);
    setBaselineRequests((blData as BaselineRow[]) ?? []);
    setClosureRequests((clData as ClosureRow[]) ?? []);
    setTaskCompletions((tcData as unknown as TaskCompletionRow[]) ?? []);
    setChainPeople((chainPeopleData as { id: string; reports_to: string | null; is_active: boolean }[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  const isFullAccess = me?.access_level === "full";
  const personName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Mirrors can_decide_extension() -- identical logic to
  // ExtensionRequests.tsx's canDecide.
  function canDecideExtension(row: ExtensionRow): boolean {
    if (!me) return false;
    if (isFullAccess) return true;
    if (row.project) {
      const ownerId = row.project.owner_id;
      if (!ownerId) return false;
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }
    const ownerId = row.task?.project?.owner_id ?? null;
    if (!ownerId) return false;
    const requesterId = row.requester?.id ?? null;
    if (ownerId === me.id && requesterId !== ownerId) return true;
    if (requesterId === ownerId) {
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }
    return false;
  }

  // Mirrors can_decide_time_entry() -- identical logic to
  // TimeTracking.tsx's canDecide.
  function canDecideTimeEntry(row: TimeEntryRowLite): boolean {
    if (!me) return false;
    if (isFullAccess) return true;
    const ownerId = row.task?.project?.owner_id ?? null;
    if (!ownerId) return false;
    const requesterId = row.requested_by;
    if (ownerId === me.id && requesterId !== ownerId) return true;
    if (requesterId === ownerId) {
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }
    return false;
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

  // Mirrors canValidateTask() in Projects.tsx / validate_task_completion
  // (phase48/49_migration.sql): the assignee's immediate manager, a
  // skip-level fallback if the immediate manager is inactive, Full
  // Access, or the project owner -- with the same self-validation
  // exemption (only when there's genuinely no active manager anywhere
  // above the assignee) and the same project-closed lockout.
  function canDecideTaskCompletion(row: TaskCompletionRow): boolean {
    if (!me) return false;
    if (row.project?.wbs_status === "closed") return false;
    if (row.assignee_id && row.assignee_id === me.id) {
      return nearestActiveManager(row.assignee_id) === null;
    }
    if (isFullAccess) return true;
    if (row.project?.owner_id === me.id) return true;
    if (!row.assignee_id) return false;
    const immediateManager = chainPeople.find((p) => p.id === row.assignee_id)?.reports_to ?? null;
    if (immediateManager === me.id) return true;
    return nearestActiveManager(row.assignee_id) === me.id;
  }

  async function decideExtension(row: ExtensionRow, status: "Approved" | "Rejected") {
    const label = row.project ? `"${row.project.name}"'s timeline` : `the extension request for "${row.task?.name}"`;
    if (status === "Rejected") {
      const ok = await confirm({ message: `Reject ${label}?`, confirmLabel: "Reject", danger: true });
      if (!ok) return;
    }
    const key = `ext-${row.id}`;
    setDecidingKey(key);
    const { error } = await supabase.rpc(row.project ? "decide_project_extension_request" : "decide_extension_request", {
      p_request_id: row.id,
      p_status: status,
      p_decision_notes: notesDraft[key]?.trim() || null,
    });
    setDecidingKey(null);
    if (error) {
      await alert(`Couldn't ${status === "Approved" ? "approve" : "reject"} this request: ${error.message}`);
      return;
    }
    loadAll();
  }

  async function decideTime(row: TimeEntryRowLite, status: "approved" | "rejected") {
    if (status === "rejected") {
      const ok = await confirm({ message: "Reject this time entry?", confirmLabel: "Reject", danger: true });
      if (!ok) return;
    }
    const key = `time-${row.id}`;
    setDecidingKey(key);
    const res = await decideTimeEntry(row.id, status, notesDraft[key]?.trim() || null);
    setDecidingKey(null);
    if (res.error) {
      await alert(`Couldn't ${status === "approved" ? "approve" : "reject"} this entry: ${res.error}`);
      return;
    }
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
  async function decideTaskCompletion(row: TaskCompletionRow, validatedDate: string) {
    const key = `taskval-${row.id}`;
    setDecidingKey(key);
    const { error } = await supabase.rpc("validate_task_completion", { p_task_id: row.id, p_validated_date: new Date(validatedDate).toISOString() });
    setDecidingKey(null);
    if (error) {
      await alert(`Couldn't validate "${row.name}": ${error.message}`);
      return;
    }
    loadAll();
  }

  function NotesField({ rowKey }: { rowKey: string }) {
    return (
      <input
        type="text"
        placeholder="Add an optional note..."
        value={notesDraft[rowKey] ?? ""}
        onChange={(e) => setNotesDraft((prev) => ({ ...prev, [rowKey]: e.target.value }))}
        style={{ fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", width: "100%", boxSizing: "border-box" }}
      />
    );
  }

  function DecideButtons({ rowKey, onApprove, onReject }: { rowKey: string; onApprove: () => void; onReject: () => void }) {
    const busy = decidingKey === rowKey;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={onReject}
          disabled={busy}
          title="Reject"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--danger-text)", background: "#fff", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <XCircle size={13} />
          Reject
        </button>
        <button
          onClick={onApprove}
          disabled={busy}
          title="Approve"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--success-text)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <CheckCircle2 size={13} />
          Approve
        </button>
      </div>
    );
  }

  // 2026-09-21 (Sandra): clicking Validate now confirms a date first,
  // rather than firing immediately with whatever validate_task_completion
  // would have defaulted to silently -- same default (actual_completion_
  // date, then submitted_on, then today) pre-filled into an editable
  // date input, so the common case (the pre-filled date is correct) is
  // still just one extra click, but a validator who needs to correct it
  // can before it's saved. See decideTaskCompletion's own comment for
  // how this date differs from validation_performed_at.
  function ValidateAction({ row }: { row: TaskCompletionRow }) {
    const rowKey = `taskval-${row.id}`;
    const defaultDate = (row.actual_completion_date ?? row.submitted_on ?? new Date().toISOString()).slice(0, 10);
    const [date, setDate] = useState(defaultDate);
    const busy = decidingKey === rowKey;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          title="Validated (completion) date -- when the work was actually done"
          style={{ fontSize: 11.5, padding: "6px 7px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--navy)" }}
        />
        <button
          onClick={() => decideTaskCompletion(row, date)}
          disabled={busy || !date}
          title="Validate"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--success-text)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <CheckCircle2 size={13} />
          Validate
        </button>
      </div>
    );
  }

  function ReviewLink({ projectId }: { projectId: string }) {
    return (
      <Link
        to={`/projects/${projectId}/wbs`}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}
      >
        Review in WBS Planning
        <ChevronRight size={13} />
      </Link>
    );
  }

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = [];

    extensions.forEach((row) => {
      const key = `ext-${row.id}`;
      rows.push({
        key,
        kind: "extension",
        typeLabel: row.project ? "Project Timeline Extension" : "Task Extension",
        subject: row.project ? row.project.name : row.task?.name ?? "Untitled task",
        context: row.project ? "Whole project" : row.task?.project?.name ?? "—",
        requestedByName: row.requester?.name ?? "—",
        requestedAt: row.created_at,
        reasonCategory: row.reason_category,
        reasonNotes: row.reason_notes,
        extraLine: `${formatDate(row.project ? row.project.end_date : row.task?.current_due_date)} → ${formatDate(row.requested_new_due_date)}`,
        canDecide: canDecideExtension(row),
        action: canDecideExtension(row) ? (
          <DecideButtons rowKey={key} onApprove={() => decideExtension(row, "Approved")} onReject={() => decideExtension(row, "Rejected")} />
        ) : null,
      });
    });

    timeEntries.forEach((row) => {
      const key = `time-${row.id}`;
      rows.push({
        key,
        kind: "time",
        typeLabel: "Time Entry",
        subject: row.task?.name ?? "Untitled task",
        context: row.task?.project?.name ?? "—",
        requestedByName: row.person?.name ?? "—",
        requestedAt: row.started_at,
        reasonCategory: row.reason_category,
        reasonNotes: row.reason_notes,
        extraLine: `Logged: ${hours(row.duration_minutes)}`,
        canDecide: canDecideTimeEntry(row),
        action: canDecideTimeEntry(row) ? (
          <DecideButtons rowKey={key} onApprove={() => decideTime(row, "approved")} onReject={() => decideTime(row, "rejected")} />
        ) : null,
      });
    });

    baselineRequests.forEach((row) => {
      const key = `baseline-${row.id}`;
      const proj = projectById.get(row.project_id);
      rows.push({
        key,
        kind: "baseline",
        typeLabel: "Baseline Approval",
        subject: proj?.name ?? "Untitled project",
        context: "Baseline approval",
        requestedByName: personName(row.requested_by),
        requestedAt: row.requested_at,
        reasonCategory: null,
        reasonNotes: "Captures the current plan as the official Baseline and marks the project as started.",
        extraLine: null,
        canDecide: canDecideBaseline,
        action: canDecideBaseline ? <ReviewLink projectId={row.project_id} /> : null,
      });
    });

    closureRequests.forEach((row) => {
      const key = `closure-${row.id}`;
      const proj = projectById.get(row.project_id);
      rows.push({
        key,
        kind: "closure",
        typeLabel: "Close Request",
        subject: proj?.name ?? "Untitled project",
        context: "Closure approval",
        requestedByName: personName(row.requested_by),
        requestedAt: row.requested_at,
        reasonCategory: null,
        reasonNotes: "Locks in the current plan as Final Scope — final, no re-opening.",
        extraLine: null,
        canDecide: canDecideClosure(row),
        action: canDecideClosure(row) ? <ReviewLink projectId={row.project_id} /> : null,
      });
    });

    taskCompletions.forEach((row) => {
      const key = `taskval-${row.id}`;
      const canDecide = canDecideTaskCompletion(row);
      // 2026-09-21 (Sandra: "show in the validation list the Due Date,
      // Actual Completion Date -- tag them accordingly"): both dates
      // surfaced here so a validator can see, before confirming, whether
      // the task finished on time and what completion date they're
      // about to sign off on.
      rows.push({
        key,
        kind: "task_completion",
        typeLabel: "Task Completion",
        subject: row.name,
        context: row.project?.name ?? "—",
        requestedByName: personName(row.assignee_id),
        requestedAt: row.actual_completion_date ?? row.submitted_on ?? new Date().toISOString(),
        // 2026-09-21 (Sandra, on a screenshot of the crossed-out sentence):
        // "remove this" -- the generic "Marked Done -- awaiting..."
        // sentence was redundant once the Due/Actual Completion dates
        // were added, so it's dropped; those two now stand alone as
        // their own lines instead of a single "Due: X · Actual: Y" line.
        reasonCategory: null,
        reasonNotes: null,
        extraLine: `Due Date: ${formatDate(row.current_due_date)}\nActual Completion: ${row.actual_completion_date ? formatDate(row.actual_completion_date) : "Not set"}`,
        canDecide,
        action: canDecide ? <ValidateAction row={row} /> : null,
      });
    });

    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions, timeEntries, baselineRequests, closureRequests, taskCompletions, chainPeople, people, projects, me]);

  const counts = {
    extension: extensions.length,
    time: timeEntries.length,
    baseline: baselineRequests.length,
    closure: closureRequests.length,
    task_completion: taskCompletions.length,
  };
  const totalPending = counts.extension + counts.time + counts.baseline + counts.closure + counts.task_completion;

  const visibleRows = useMemo(() => {
    let rows = kindFilter ? allRows.filter((r) => r.kind === kindFilter) : allRows;
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) => r.subject.toLowerCase().includes(q) || r.context.toLowerCase().includes(q) || r.requestedByName.toLowerCase().includes(q) || r.typeLabel.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => (sortNewestFirst ? 1 : -1) * (new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()));
  }, [allRows, kindFilter, search, sortNewestFirst]);

  const needsDecision = visibleRows.filter((r) => r.canDecide);
  const otherPending = visibleRows.filter((r) => !r.canDecide);

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
          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Awaiting your approval</div>
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
          <div style={{ fontSize: 10.5, color: "var(--muted)" }}>Awaiting your approval</div>
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
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>{row.subject}</div>
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
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Calendar size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
            {formatDate(row.requestedAt)}
          </span>
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

        {row.action && row.kind !== "baseline" && row.kind !== "closure" && row.kind !== "task_completion" && (
          <div style={{ minWidth: 160, flex: "1 1 160px" }}>
            <NotesField rowKey={row.key} />
          </div>
        )}

        <div style={{ marginLeft: "auto", flexShrink: 0 }}>{row.action ?? <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}</div>
      </div>
    );
  }

  function RequestList({ rows, emptyLabel }: { rows: Row[]; emptyLabel: string }) {
    if (rows.length === 0) {
      return <p style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>{emptyLabel}</p>;
    }
    return (
      <div>
        {rows.map((row) => (
          <RequestCard key={row.key} row={row} />
        ))}
      </div>
    );
  }

  if (loading) return <p style={{ padding: 20, color: "var(--muted)" }}>Loading…</p>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ marginBottom: 2 }}>Approval Center</h1>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0 }}>Review requests requiring your decision.</p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <AllRequestsSummaryCard />
        <SummaryCard kind="extension" />
        <SummaryCard kind="time" />
        <SummaryCard kind="baseline" />
        <SummaryCard kind="closure" />
        <SummaryCard kind="task_completion" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }} />
          <input
            type="text"
            placeholder="Search requests..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", fontSize: 12, padding: "7px 10px 7px 28px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
          />
        </div>
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

      <h2 style={{ fontSize: 13 }}>Needs your decision ({needsDecision.length})</h2>
      <RequestList rows={needsDecision} emptyLabel="Nothing needs your decision right now." />

      <h2 style={{ fontSize: 13, marginTop: 24 }}>Other pending approvals ({otherPending.length})</h2>
      <RequestList rows={otherPending} emptyLabel="No other pending approvals." />

      {confirmDialog}
    </div>
  );
}
