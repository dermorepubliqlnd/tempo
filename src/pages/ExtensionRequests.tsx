import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, Clock, ShieldCheck, BarChart3, ListChecks, Folder, User, Calendar, CalendarClock, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useSession } from "../lib/useSession";
import { useConfirm } from "../lib/useConfirm";
import { REASON_CATEGORY_OPTIONS } from "../components/RequestExtensionModal";
import { formatDate } from "../lib/formatDate";

interface PersonLite {
  id: string;
  name: string;
  reports_to: string | null;
}

interface ExtensionRequestRow {
  id: string;
  requested_new_due_date: string;
  // Generic request type (2026-08-26) -- this table now also carries
  // Start Date change requests (see enforce_start_date_lock in Postgres),
  // not just Due Date extensions. Old rows have no value here; treat
  // missing/null as 'due_date' everywhere, same as the DB column default.
  request_type: "due_date" | "start_date" | null;
  requested_new_start_date: string | null;
  reason_category: string;
  reason_notes: string;
  status: "Pending" | "Approved" | "Rejected";
  decided_at: string | null;
  decision_notes: string | null;
  is_manager_initiated: boolean;
  created_at: string;
  task: {
    id: string;
    name: string;
    assignee_id: string | null;
    original_due_date: string;
    current_due_date: string;
    start_date_standard: string | null;
    project_id: string;
    project: { id: string; name: string; owner_id: string | null } | null;
  } | null;
  // Project-level request (task is null in this case) -- a whole
  // project's committed end date, not a single task's due date. Always
  // escalates to the owner's manager/Full Access, never owner-decided;
  // see can_decide_extension() in Postgres.
  project: { id: string; name: string; owner_id: string | null; end_date: string | null; original_due_date: string | null } | null;
  requester: { id: string; name: string } | null;
  decider: { id: string; name: string } | null;
}

const STATUS_TONE: Record<string, string> = {
  Pending: "warning",
  Approved: "success",
  Rejected: "danger",
};

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

export default function ExtensionRequests() {
  const { person: me } = useSession();
  const { confirm, alert, dialog: confirmDialog } = useConfirm();
  const [tab, setTab] = useState<"requests" | "report">("requests");
  const [requests, setRequests] = useState<ExtensionRequestRow[]>([]);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  // Status filter (2026-09-19, Sandra: card-layout mockup + "add metric
  // cards like All request | Pending | approved") -- the metric cards
  // double as the filter, same convention as the Approval Center page.
  const [statusFilter, setStatusFilter] = useState<"all" | "Pending" | "Approved" | "Rejected">("all");

  async function loadAll() {
    setLoading(true);
    const [{ data: reqData }, { data: peopleData }] = await Promise.all([
      supabase
        .from("extension_requests")
        .select(
          `id, requested_new_due_date, request_type, requested_new_start_date, reason_category, reason_notes, status, decided_at, decision_notes, is_manager_initiated, created_at,
           task:tasks!extension_requests_task_id_fkey ( id, name, assignee_id, original_due_date, current_due_date, start_date_standard, project_id, project:projects ( id, name, owner_id ) ),
           project:projects!extension_requests_project_id_fkey ( id, name, owner_id, end_date, original_due_date ),
           requester:people!extension_requests_requested_by_fkey ( id, name ),
           decider:people!extension_requests_decided_by_fkey ( id, name )`
        )
        .order("created_at", { ascending: false }),
      supabase.from("people").select("id,name,reports_to").eq("is_active", true),
    ]);
    // Start Date change requests (2026-08-26) shared this table via
    // request_type='start_date', but that per-task request/approval
    // feature was removed 2026-08-27 (Sandra: start dates only change via
    // Re-baseline now). Filter any such rows out here so this page -- and
    // its "Extension Requests" name -- stays scoped to due-date changes
    // only; the underlying rows/column are left in place in Postgres, not
    // dropped.
    const dueDateOnly = ((reqData as unknown as ExtensionRequestRow[]) ?? []).filter((r) => r.request_type !== "start_date");
    setRequests(dueDateOnly);
    setPeople((peopleData as PersonLite[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Mirrors can_decide_extension() in Postgres -- the DB is the real
  // authority (this only controls whether the Approve/Reject buttons show
  // up; the RPC re-checks and would reject an unauthorized call anyway).
  function canDecide(row: ExtensionRequestRow): boolean {
    if (!me) return false;
    if (me.access_level === "full") return true;

    // Project-level: ALWAYS escalates to the owner's manager -- there is
    // no "owner decides" path at all here, unlike task-level below (a
    // project-wide deadline move is a bigger commitment than one task
    // slipping).
    if (row.project) {
      const ownerId = row.project.owner_id;
      if (!ownerId) return false;
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }

    const ownerId = row.task?.project?.owner_id;
    if (!ownerId) return false;
    const requesterId = row.requester?.id;
    if (ownerId === me.id && requesterId !== ownerId) return true;
    if (requesterId === ownerId) {
      const owner = people.find((p) => p.id === ownerId);
      return owner?.reports_to === me.id;
    }
    return false;
  }

  const assigneeName = (id: string | null) => people.find((p) => p.id === id)?.name ?? "\u2014";

  async function decide(row: ExtensionRequestRow, status: "Approved" | "Rejected") {
    const label = row.project ? `"${row.project.name}"'s timeline` : `the extension request for "${row.task?.name}"`;
    if (status === "Rejected") {
      const ok = await confirm({ message: `Reject ${label}?`, confirmLabel: "Reject", danger: true });
      if (!ok) return;
    }
    setDecidingId(row.id);
    const { error } = await supabase.rpc(row.project ? "decide_project_extension_request" : "decide_extension_request", {
      p_request_id: row.id,
      p_status: status,
      p_decision_notes: notesDraft[row.id]?.trim() || null,
    });
    setDecidingId(null);
    if (error) {
      await alert(`Couldn't ${status === "Approved" ? "approve" : "reject"} this request: ${error.message}`);
      return;
    }
    loadAll();
  }

  const statusCounts = {
    all: requests.length,
    Pending: requests.filter((r) => r.status === "Pending").length,
    Approved: requests.filter((r) => r.status === "Approved").length,
    Rejected: requests.filter((r) => r.status === "Rejected").length,
  };
  // Metric cards double as the status filter (2026-09-19, Sandra:
  // card-layout mockup) -- applied before the three groupings below, same
  // convention as the Approval Center page.
  const filteredRequests = statusFilter === "all" ? requests : requests.filter((r) => r.status === statusFilter);
  const pendingForMe = filteredRequests.filter((r) => r.status === "Pending" && canDecide(r));
  const mine = filteredRequests.filter((r) => r.requester?.id === me?.id);
  const rest = filteredRequests.filter((r) => !pendingForMe.includes(r) && r.requester?.id !== me?.id);

  // Card format (2026-09-19, Sandra: match the Approval Center's card
  // layout) -- each section (Needs your decision / My requests / Other
  // visible) renders its own card list instead of a table now; the
  // grouping itself is unchanged.
  function RequestsTable({ rows, showDecideActions }: { rows: ExtensionRequestRow[]; showDecideActions: boolean }) {
    if (rows.length === 0) return null;
    return (
      <div>
        {rows.map((row) => {
          const busy = decidingId === row.id;
          const isProjectLevel = !!row.project;
          return (
            <div
              key={row.id}
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
              <span
                className={`status-pill ${isProjectLevel ? "accent" : "gold"}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 10, flexShrink: 0 }}
              >
                <CalendarClock size={15} />
              </span>

              <div style={{ minWidth: 190, flex: "1 1 190px" }}>
                <span className={`status-pill ${isProjectLevel ? "accent" : "gold"}`} style={{ fontSize: 9.5, marginBottom: 4, display: "inline-block" }}>
                  {isProjectLevel ? "Project Timeline Extension" : "Task Extension"}
                </span>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--navy)" }}>
                  {isProjectLevel ? row.project?.name : row.task?.name ?? "Untitled task"}
                  {row.is_manager_initiated && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>(manager-initiated)</span>}
                </div>
              </div>

              <div style={{ minWidth: 190, flex: "1 1 190px", display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "var(--text-secondary)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Folder size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
                  {isProjectLevel ? row.project?.name : row.task?.project?.name ?? "—"}
                </span>
                {!isProjectLevel && (
                  <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <User size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
                    {assigneeName(row.task?.assignee_id ?? null)} <span style={{ color: "var(--muted)" }}>(assignee)</span>
                  </span>
                )}
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <User size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
                  {row.requester?.name ?? "—"}
                  {row.task && row.requester && row.task.assignee_id !== row.requester.id && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)" }} title="Requested on behalf of the assignee">
                      (on behalf)
                    </span>
                  )}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Calendar size={11} style={{ color: "var(--muted)", flexShrink: 0 }} />
                  {formatDate(row.created_at)}
                </span>
              </div>

              <div style={{ minWidth: 220, flex: "1 1 220px", fontSize: 11 }}>
                <span style={{ fontSize: 9.5, color: "var(--muted)", marginRight: 5 }}>Reason</span>
                <span className="status-pill neutral" style={{ fontSize: 9.5 }}>
                  {row.reason_category}
                </span>
                {row.reason_notes && <div style={{ color: "var(--text-secondary)", marginTop: 3 }}>{row.reason_notes}</div>}
                <div style={{ fontWeight: 700, color: "var(--navy)", marginTop: 3 }}>
                  {formatDate(row.project ? row.project.end_date : row.task?.current_due_date)} &rarr; {formatDate(row.requested_new_due_date)}
                </div>
              </div>

              <div style={{ minWidth: 90, flex: "0 0 auto" }}>
                <span className={`status-pill ${STATUS_TONE[row.status]}`}>{row.status}</span>
                {row.status !== "Pending" && (
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 5 }}>
                    by {row.decider?.name ?? "—"} on {formatDate(row.decided_at)}
                    {row.decision_notes && <> — "{row.decision_notes}"</>}
                  </div>
                )}
              </div>

              {showDecideActions && row.status === "Pending" && (
                <div style={{ minWidth: 160, flex: "1 1 160px" }}>
                  <input
                    type="text"
                    placeholder="Add an optional note..."
                    value={notesDraft[row.id] ?? ""}
                    onChange={(e) => setNotesDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    style={{ fontSize: 11.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              )}

              {showDecideActions && row.status === "Pending" && (
                <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", gap: 6 }}>
                  <button
                    onClick={() => decide(row, "Rejected")}
                    disabled={busy}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--danger-text)", background: "#fff", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    <XCircle size={13} />
                    Reject
                  </button>
                  <button
                    onClick={() => decide(row, "Approved")}
                    disabled={busy}
                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#fff", background: "var(--success-text)", border: "none", borderRadius: "var(--radius-sm)", padding: "7px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    <CheckCircle2 size={13} />
                    Approve
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ---- Report tab: behavior-data analytics over the same requests[] the
  // list above already has, no new fetch needed. All-time only for v1
  // (Sandra confirmed via AskUserQuestion 2026-07-17) -- a date-range
  // filter can be layered on later once the all-time view proves useful.
  // "Days extended" is measured from each request's task.original_due_date
  // to requested_new_due_date -- i.e. cumulative drift from the original
  // baseline at the moment of that approval, not the incremental hop from
  // whatever the due date happened to be right before it (we don't store
  // that intermediate state, and cumulative drift is the more actionable
  // number anyway).
  function ReportTab() {
    // Scoped to Due Date extensions only (2026-08-26) -- Start Date
    // change requests_ now also live in this same table, but "days
    // extended" and the rest of this report's drift math are specifically
    // about due-date slippage. Mixing the two would make the numbers
    // meaningless (a Start Date moving earlier isn't a "slip").
    const requests_ = requests.filter((r) => (r.request_type ?? "due_date") === "due_date");
    const decided = requests_.filter((r) => r.status !== "Pending");
    const approved = requests_.filter((r) => r.status === "Approved");
    const rejected = requests_.filter((r) => r.status === "Rejected");
    const approvalRate = decided.length > 0 ? Math.round((approved.length / decided.length) * 100) : null;

    const daysExtendedList = approved
      .filter((r) => r.task?.original_due_date)
      .map((r) => daysBetween(r.task!.original_due_date, r.requested_new_due_date));
    const avgDaysExtended = daysExtendedList.length > 0 ? Math.round((daysExtendedList.reduce((a, b) => a + b, 0) / daysExtendedList.length) * 10) / 10 : null;

    const categoryCounts = useMemo(() => {
      const counts: Record<string, number> = {};
      requests_.forEach((r) => {
        counts[r.reason_category] = (counts[r.reason_category] ?? 0) + 1;
      });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }, [requests_]);
    const topCategory = categoryCounts[0]?.[0] ?? "—";

    // "On behalf of" = requester isn't the task's assignee -- almost
    // always the project owner acting for someone else. Requested by
    // Sandra to distinguish self-service extension requests from ones
    // filed on an assignee's behalf, since those are different behavior
    // patterns worth tracking separately (2026-07-17).
    const onBehalfCount = requests_.filter((r) => r.task && r.task.assignee_id !== r.requester?.id).length;
    const onBehalfRate = requests_.length > 0 ? Math.round((onBehalfCount / requests_.length) * 100) : null;

    // Per requester: count, approval rate, avg days extended, how many
    // needed manager escalation (a proxy for "requesting extensions on
    // their own project" -- the one case that bypasses owner approval),
    // and how many were filed on behalf of a different assignee.
    const byRequester = useMemo(() => {
      const map: Record<string, { name: string; total: number; approved: number; rejected: number; pending: number; escalated: number; onBehalf: number; daysList: number[] }> = {};
      requests_.forEach((r) => {
        const id = r.requester?.id ?? "unknown";
        if (!map[id]) map[id] = { name: r.requester?.name ?? "—", total: 0, approved: 0, rejected: 0, pending: 0, escalated: 0, onBehalf: 0, daysList: [] };
        map[id].total += 1;
        if (r.status === "Approved") {
          map[id].approved += 1;
          if (r.task?.original_due_date) map[id].daysList.push(daysBetween(r.task.original_due_date, r.requested_new_due_date));
        }
        if (r.status === "Rejected") map[id].rejected += 1;
        if (r.status === "Pending") map[id].pending += 1;
        if (r.is_manager_initiated === false && r.task?.project?.owner_id === r.requester?.id) map[id].escalated += 1;
        if (r.task && r.task.assignee_id !== r.requester?.id) map[id].onBehalf += 1;
      });
      return Object.values(map).sort((a, b) => b.total - a.total);
    }, [requests_]);

    // Per assignee: same shape as byRequester above, but grouped by who
    // the *task* belongs to rather than who filed the request -- these
    // diverge whenever a request was made "on behalf of" someone (see
    // onBehalf tracking above), so this is the only view that shows each
    // person's actual extension-request exposure on their own work.
    // Requested by Sandra (2026-07-17) alongside the requester breakdown.
    const byAssignee = useMemo(() => {
      const map: Record<string, { name: string; total: number; approved: number; rejected: number; selfRequested: number; daysList: number[] }> = {};
      requests_.forEach((r) => {
        if (!r.task) return;
        const id = r.task.assignee_id ?? "unassigned";
        if (!map[id]) map[id] = { name: assigneeName(r.task.assignee_id), total: 0, approved: 0, rejected: 0, selfRequested: 0, daysList: [] };
        map[id].total += 1;
        if (r.status === "Approved") {
          map[id].approved += 1;
          if (r.task.original_due_date) map[id].daysList.push(daysBetween(r.task.original_due_date, r.requested_new_due_date));
        }
        if (r.status === "Rejected") map[id].rejected += 1;
        if (r.requester?.id === r.task.assignee_id) map[id].selfRequested += 1;
      });
      return Object.values(map).sort((a, b) => b.total - a.total);
    }, [requests_]);

    // Per task: request count + net days drifted (current vs original due
    // date on the task itself -- exact, no reconstruction needed).
    const byTask = useMemo(() => {
      const map: Record<string, { name: string; project: string; count: number; drift: number }> = {};
      requests_.forEach((r) => {
        if (!r.task) return;
        const id = r.task.id;
        if (!map[id]) {
          map[id] = {
            name: r.task.name,
            project: r.task.project?.name ?? "—",
            count: 0,
            drift: daysBetween(r.task.original_due_date, r.task.current_due_date),
          };
        }
        map[id].count += 1;
      });
      return Object.values(map).sort((a, b) => b.count - a.count);
    }, [requests_]);

    // Requests per month, oldest to newest -- simple trend read.
    const byMonth = useMemo(() => {
      const map: Record<string, number> = {};
      requests_.forEach((r) => {
        const month = r.created_at.slice(0, 7); // YYYY-MM
        map[month] = (map[month] ?? 0) + 1;
      });
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    }, [requests_]);
    const maxMonthCount = Math.max(1, ...byMonth.map(([, c]) => c));

    if (requests_.length === 0) {
      return <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 16 }}>No extension requests yet -- the report will fill in as requests come through.</p>;
    }

    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 24 }}>
          <SummaryCard label="Total requests" value={String(requests_.length)} />
          <SummaryCard label="Approval rate" value={approvalRate === null ? "—" : `${approvalRate}%`} sub={`${approved.length} approved / ${rejected.length} rejected`} />
          <SummaryCard label="Avg. days extended" value={avgDaysExtended === null ? "—" : `${avgDaysExtended}d`} sub="beyond original due date, approved only" />
          <SummaryCard label="Top reason" value={topCategory} />
          <SummaryCard label="Requested on behalf" value={onBehalfRate === null ? "—" : `${onBehalfRate}%`} sub={`${onBehalfCount} of ${requests_.length} -- not the assignee`} />
        </div>

        <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>Who's requesting</h2>
        <table className="data-table" style={{ width: "100%", marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Requester</th>
              <th>Total requests</th>
              <th>Approval rate</th>
              <th>Avg. days extended</th>
              <th>Manager-escalated</th>
              <th>On behalf of assignee</th>
            </tr>
          </thead>
          <tbody>
            {byRequester.map((r) => {
              const decidedCount = r.approved + r.rejected;
              const rate = decidedCount > 0 ? Math.round((r.approved / decidedCount) * 100) : null;
              const avg = r.daysList.length > 0 ? Math.round((r.daysList.reduce((a, b) => a + b, 0) / r.daysList.length) * 10) / 10 : null;
              return (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>{r.total}</td>
                  <td>{rate === null ? "—" : `${rate}%`}</td>
                  <td>{avg === null ? "—" : `${avg}d`}</td>
                  <td>{r.escalated}</td>
                  <td>{r.onBehalf}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>Per assignee -- extensions on their own tasks</h2>
        <table className="data-table" style={{ width: "100%", marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Assignee</th>
              <th>Total requests</th>
              <th>Approval rate</th>
              <th>Avg. days extended</th>
              <th>Self-requested</th>
              <th>Requested by others</th>
            </tr>
          </thead>
          <tbody>
            {byAssignee.map((a) => {
              const decidedCount = a.approved + a.rejected;
              const rate = decidedCount > 0 ? Math.round((a.approved / decidedCount) * 100) : null;
              const avg = a.daysList.length > 0 ? Math.round((a.daysList.reduce((x, y) => x + y, 0) / a.daysList.length) * 10) / 10 : null;
              return (
                <tr key={a.name}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{a.total}</td>
                  <td>{rate === null ? "—" : `${rate}%`}</td>
                  <td>{avg === null ? "—" : `${avg}d`}</td>
                  <td>{a.selfRequested}</td>
                  <td>{a.total - a.selfRequested}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>Which tasks need it most</h2>
        <table className="data-table" style={{ width: "100%", marginBottom: 24 }}>
          <thead>
            <tr>
              <th>Task</th>
              <th>Project</th>
              <th>Requests</th>
              <th>Net days drifted</th>
            </tr>
          </thead>
          <tbody>
            {byTask.slice(0, 15).map((t) => (
              <tr key={t.name + t.project}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                <td>{t.project}</td>
                <td>{t.count}</td>
                <td>{t.drift}d</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>Why it's happening</h2>
            {categoryCounts.map(([cat, count]) => (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 140, fontSize: 11.5, flexShrink: 0 }}>{cat}</span>
                <div style={{ flex: 1, background: "var(--hover-bg)", borderRadius: 3, height: 10, overflow: "hidden" }}>
                  <div style={{ width: `${(count / requests_.length) * 100}%`, background: "var(--accent)", height: "100%" }} />
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)", width: 20, textAlign: "right" }}>{count}</span>
              </div>
            ))}
          </div>
          <div>
            <h2 style={{ fontSize: 13, margin: "0 0 8px" }}>Requests per month</h2>
            {byMonth.map(([month, count]) => (
              <div key={month} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 60, fontSize: 11.5, flexShrink: 0 }}>{month}</span>
                <div style={{ flex: 1, background: "var(--hover-bg)", borderRadius: 3, height: 10, overflow: "hidden" }}>
                  <div style={{ width: `${(count / maxMonthCount) * 100}%`, background: "var(--accent)", height: "100%" }} />
                </div>
                <span style={{ fontSize: 11, color: "var(--muted)", width: 20, textAlign: "right" }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {confirmDialog}
      <h1>Extension Requests</h1>

      <div style={{ display: "flex", gap: 4, marginTop: 16, borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={() => setTab("requests")}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, background: "none", border: "none",
            borderBottom: tab === "requests" ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === "requests" ? "var(--accent)" : "var(--muted)", cursor: "pointer",
          }}
        >
          <ListChecks size={13} />
          Requests
        </button>
        <button
          onClick={() => setTab("report")}
          style={{
            display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, background: "none", border: "none",
            borderBottom: tab === "report" ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === "report" ? "var(--accent)" : "var(--muted)", cursor: "pointer",
          }}
        >
          <BarChart3 size={13} />
          Report
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>
      ) : tab === "report" ? (
        <ReportTab />
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16, marginBottom: 8 }}>
            {(
              [
                { key: "all" as const, label: "All Requests", tone: "slate", value: statusCounts.all },
                { key: "Pending" as const, label: "Pending", tone: "warning", value: statusCounts.Pending },
                { key: "Approved" as const, label: "Approved", tone: "success", value: statusCounts.Approved },
                { key: "Rejected" as const, label: "Rejected", tone: "danger", value: statusCounts.Rejected },
              ]
            ).map((card) => {
              const active = statusFilter === card.key;
              return (
                <button
                  key={card.key}
                  onClick={() => setStatusFilter((prev) => (prev === card.key ? "all" : card.key))}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flex: "1 1 200px",
                    minWidth: 180,
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: "var(--radius)",
                    border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                    background: "var(--surface)",
                    cursor: "pointer",
                  }}
                >
                  <span className={`status-pill ${card.tone}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}>
                    <Clock size={14} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--navy)" }}>{card.label}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "var(--navy)", lineHeight: 1.15 }}>{card.value}</div>
                  </div>
                  <ChevronRight size={15} style={{ color: "var(--muted)", flexShrink: 0 }} />
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 20, marginBottom: 8 }}>
            <Clock size={14} color="var(--warning-text)" />
            <h2 style={{ margin: 0, fontSize: 13 }}>Needs your decision ({pendingForMe.length})</h2>
          </div>
          {pendingForMe.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Nothing waiting on you right now.</p>
          ) : (
            <RequestsTable rows={pendingForMe} showDecideActions />
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 24, marginBottom: 8 }}>
            <ShieldCheck size={14} color="var(--accent)" />
            <h2 style={{ margin: 0, fontSize: 13 }}>My requests ({mine.length})</h2>
          </div>
          {mine.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>You haven't requested any extensions.</p>
          ) : (
            <RequestsTable rows={mine} showDecideActions={false} />
          )}

          {rest.length > 0 && (
            <>
              <div style={{ marginTop: 24, marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 13 }}>Other visible requests ({rest.length})</h2>
              </div>
              <RequestsTable rows={rest} showDecideActions={false} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--navy)" }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
