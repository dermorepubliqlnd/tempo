import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, CalendarClock, Timer, ShieldCheck, FolderCheck, ClipboardCheck } from "lucide-react";
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

interface PersonLite {
  id: string;
  name: string;
  reports_to: string | null;
}
interface ProjectLite {
  id: string;
  name: string;
  owner_id: string | null;
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

function hours(minutes: number | null): string {
  if (!minutes) return "0h";
  return `${(minutes / 60).toFixed(1)}h`;
}

// Shared row chrome for every approval type -- kept as one generic shape
// so the two tables below (Needs your decision / Other pending) don't
// need four separate render paths.
interface Row {
  key: string;
  typeLabel: string;
  typeIcon: JSX.Element;
  subject: string;
  context: string;
  requestedByName: string;
  requestedAt: string;
  detail: string;
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
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  async function loadAll() {
    setLoading(true);
    const [{ data: peopleData }, { data: projectData }, { data: extData }, { data: teData }, { data: blData }, { data: clData }] = await Promise.all([
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
      supabase.from("projects").select("id,name,owner_id"),
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

  // Closure: Full Access, anyone flagged can_approve_closures, or the
  // project's own owner -- mirrors WbsPlanning.tsx's canDecideClosure.
  function canDecideClosure(row: ClosureRow): boolean {
    if (!me) return false;
    if (isFullAccess || me.can_approve_closures) return true;
    const proj = projectById.get(row.project_id);
    return !!proj && proj.owner_id === me.id;
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

  function NotesField({ rowKey }: { rowKey: string }) {
    return (
      <input
        type="text"
        placeholder="Optional note"
        value={notesDraft[rowKey] ?? ""}
        onChange={(e) => setNotesDraft((prev) => ({ ...prev, [rowKey]: e.target.value }))}
        style={{ fontSize: 11, padding: "4px 6px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", width: 130 }}
      />
    );
  }

  function DecideButtons({ rowKey, onApprove, onReject }: { rowKey: string; onApprove: () => void; onReject: () => void }) {
    const busy = decidingKey === rowKey;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <NotesField rowKey={rowKey} />
        <button
          onClick={onApprove}
          disabled={busy}
          title="Approve"
          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "#fff", background: "var(--success-text)", border: "none", borderRadius: "var(--radius-sm)", padding: "5px 8px", cursor: "pointer" }}
        >
          <CheckCircle2 size={12} />
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          title="Reject"
          style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color: "var(--danger-text)", background: "none", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)", padding: "5px 8px", cursor: "pointer" }}
        >
          <XCircle size={12} />
          Reject
        </button>
      </div>
    );
  }

  function ReviewLink({ projectId }: { projectId: string }) {
    return (
      <Link
        to={`/projects/${projectId}/wbs`}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
      >
        Review in WBS Planning &rarr;
      </Link>
    );
  }

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = [];

    extensions.forEach((row) => {
      const key = `ext-${row.id}`;
      rows.push({
        key,
        typeLabel: row.project ? "Project timeline extension" : "Task extension",
        typeIcon: <CalendarClock size={13} />,
        subject: row.project ? row.project.name : row.task?.name ?? "Untitled task",
        context: row.project ? "Whole project" : row.task?.project?.name ?? "—",
        requestedByName: row.requester?.name ?? "—",
        requestedAt: row.created_at,
        detail: `${row.reason_category}${row.reason_notes ? ` — ${row.reason_notes}` : ""} · new date ${formatDate(row.requested_new_due_date)}`,
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
        typeLabel: "Time entry",
        typeIcon: <Timer size={13} />,
        subject: row.task?.name ?? "Untitled task",
        context: row.task?.project?.name ?? "—",
        requestedByName: row.person?.name ?? "—",
        requestedAt: row.started_at,
        detail: `${hours(row.duration_minutes)}${row.reason_category ? ` · ${row.reason_category}` : ""}${row.reason_notes ? ` — ${row.reason_notes}` : ""}`,
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
        typeLabel: "Start Project (Baseline)",
        typeIcon: <ShieldCheck size={13} />,
        subject: proj?.name ?? "Untitled project",
        context: "Baseline approval",
        requestedByName: personName(row.requested_by),
        requestedAt: row.requested_at,
        detail: "Captures the current plan as the official Baseline and marks the project as started.",
        canDecide: canDecideBaseline,
        action: canDecideBaseline ? <ReviewLink projectId={row.project_id} /> : null,
      });
    });

    closureRequests.forEach((row) => {
      const key = `closure-${row.id}`;
      const proj = projectById.get(row.project_id);
      rows.push({
        key,
        typeLabel: "Project close request",
        typeIcon: <FolderCheck size={13} />,
        subject: proj?.name ?? "Untitled project",
        context: "Closure approval",
        requestedByName: personName(row.requested_by),
        requestedAt: row.requested_at,
        detail: "Locks in the current plan as Final Scope — final, no re-opening.",
        canDecide: canDecideClosure(row),
        action: canDecideClosure(row) ? <ReviewLink projectId={row.project_id} /> : null,
      });
    });

    return rows.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extensions, timeEntries, baselineRequests, closureRequests, people, projects, me]);

  const needsDecision = allRows.filter((r) => r.canDecide);
  const otherPending = allRows.filter((r) => !r.canDecide);

  const counts = {
    extensions: extensions.length,
    timeEntries: timeEntries.length,
    baseline: baselineRequests.length,
    closure: closureRequests.length,
  };

  function ApprovalsTable({ rows, emptyLabel }: { rows: Row[]; emptyLabel: string }) {
    if (rows.length === 0) {
      return <p style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>{emptyLabel}</p>;
    }
    return (
      <table className="data-table" style={{ width: "100%", marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Type</th>
            <th>Subject</th>
            <th>Project</th>
            <th>Requested by</th>
            <th>Requested on</th>
            <th>Details</th>
            <th style={{ minWidth: 150 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--navy)" }}>
                  {row.typeIcon}
                  {row.typeLabel}
                </span>
              </td>
              <td style={{ fontWeight: 600, color: "var(--navy)" }}>{row.subject}</td>
              <td>{row.context}</td>
              <td>{row.requestedByName}</td>
              <td>{formatDate(row.requestedAt)}</td>
              <td style={{ fontSize: 11, color: "var(--text-secondary)", maxWidth: 320 }}>{row.detail}</td>
              <td>{row.action ?? <span style={{ fontSize: 11, color: "var(--muted)" }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (loading) return <p style={{ padding: 20, color: "var(--muted)" }}>Loading…</p>;

  return (
    <div>
      <h1>Approval Center</h1>
      <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -6, marginBottom: 16 }}>
        Everything currently awaiting a decision, in one place — extension requests, time entries, Start Project (baseline) requests, and project close requests.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <SummaryCard icon={<CalendarClock size={16} />} label="Extension requests" value={counts.extensions} />
        <SummaryCard icon={<Timer size={16} />} label="Time entries" value={counts.timeEntries} />
        <SummaryCard icon={<ShieldCheck size={16} />} label="Baseline approvals" value={counts.baseline} />
        <SummaryCard icon={<FolderCheck size={16} />} label="Close requests" value={counts.closure} />
      </div>

      <h2 style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
        <ClipboardCheck size={15} />
        Needs your decision ({needsDecision.length})
      </h2>
      <ApprovalsTable rows={needsDecision} emptyLabel="Nothing needs your decision right now." />

      <h2 style={{ fontSize: 13, marginTop: 24 }}>Other pending approvals ({otherPending.length})</h2>
      <ApprovalsTable rows={otherPending} emptyLabel="No other pending approvals." />

      {confirmDialog}
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: JSX.Element; label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px 16px", background: "var(--surface)", minWidth: 150 }}>
      <span style={{ color: "var(--accent)" }}>{icon}</span>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--navy)", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{label}</div>
      </div>
    </div>
  );
}
