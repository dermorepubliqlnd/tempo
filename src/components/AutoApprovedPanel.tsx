// phase169 (2026-10-07, Sandra): "Auto-approved" tab in Approval Center --
// the approver's running list of everything the approve-by-exception rules
// decided in the last 7 days. Time entries and task validations can be
// reversed here (reason required; the item goes back to Mine to approve).
// Extensions are listed for visibility only -- no undo (Sandra: dependent
// dates may already have moved).
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { RotateCcw, Zap } from "lucide-react";
import { supabase, IS_PREVIEW } from "../lib/supabaseClient";
import { useConfirm } from "../lib/useConfirm";
import { friendlyError } from "../lib/prompts";
import { formatDate } from "../lib/formatDate";
import { formatDuration, timeLogId } from "../lib/timeTracking";
import { routeApproval, type RoutingData } from "../lib/approvalRouting";
import { reverseAutoTime, reverseAutoValidation, runAutoValidations, COMPLETION_TIMING_LABEL, completionTiming } from "../lib/autoApprovals";

interface Props {
  meId: string;
  isFullAccess: boolean;
  routing: RoutingData | null;
  personName: (id: string | null | undefined) => string;
  projects: { id: string; name: string }[];
  onChanged?: () => void;
}

type Item = {
  key: string;
  kind: "time" | "validation" | "extension";
  id: string;
  subjectId: string | null;
  label: string;
  title: string;
  context: string;
  detail: string;
  at: string;
};

const WEEK_MS = 7 * 24 * 3600 * 1000;

export default function AutoApprovedPanel({ meId, isFullAccess, routing, personName, projects, onChanged }: Props) {
  const { alert, dialog } = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [reversing, setReversing] = useState<Item | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [testProject, setTestProject] = useState("");
  const [testIgnoreWait, setTestIgnoreWait] = useState(true);

  async function load() {
    setLoading(true);
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const [te, tk, ex] = await Promise.all([
      supabase
        .from("time_entries")
        .select(`id, entry_number, non_project_entry_number, person_id, started_at, ended_at, duration_minutes, decided_at, task_id,
                 task:tasks ( name, task_number, project:projects ( name ) ), activity_type:non_project_activity_types ( name )`)
        .eq("auto_approved", true)
        .eq("is_archived", false)
        .gte("decided_at", since),
      supabase
        .from("tasks")
        .select(`id, name, task_number, assignee_id, current_due_date, actual_completion_date, validation_performed_at, project:projects ( name )`)
        .eq("auto_validated", true)
        .gte("validation_performed_at", since),
      supabase
        .from("extension_requests")
        .select(`id, requested_by, requested_new_due_date, reason_category, decision_notes, decided_at, task:tasks ( name, task_number, assignee_id, project:projects ( name ) )`)
        .eq("auto_approved", true)
        .gte("decided_at", since),
    ]);
    const out: Item[] = [];
    type TE = { id: string; entry_number: number | null; non_project_entry_number: number | null; person_id: string; started_at: string; ended_at: string; duration_minutes: number | null; decided_at: string; task_id: string | null; task: { name: string; task_number: number | null; project: { name: string } | null } | null; activity_type: { name: string } | null };
    ((te.data as unknown as TE[]) ?? []).forEach((r) => {
      out.push({
        key: `t-${r.id}`, kind: "time", id: r.id, subjectId: r.person_id,
        label: r.task_id ? timeLogId(r.entry_number) : (r.non_project_entry_number ? `NP-${String(r.non_project_entry_number).padStart(4, "0")}` : "Time log"),
        title: r.task ? r.task.name : `Non-project · ${r.activity_type?.name ?? "Activity"}`,
        context: r.task?.project?.name ?? "Non-project time",
        detail: `${personName(r.person_id)} · ${formatDate(r.started_at)} · ${formatDuration(r.duration_minutes ?? Math.round((+new Date(r.ended_at) - +new Date(r.started_at)) / 60000))}`,
        at: r.decided_at,
      });
    });
    type TK = { id: string; name: string; task_number: number | null; assignee_id: string | null; current_due_date: string | null; actual_completion_date: string | null; validation_performed_at: string; project: { name: string } | null };
    ((tk.data as unknown as TK[]) ?? []).forEach((r) => {
      const timing = completionTiming(r.current_due_date, r.actual_completion_date);
      out.push({
        key: `v-${r.id}`, kind: "validation", id: r.id, subjectId: r.assignee_id,
        label: r.task_number ? `T-${String(r.task_number).padStart(4, "0")}` : "Task",
        title: r.name,
        context: r.project?.name ?? "—",
        detail: `${personName(r.assignee_id)} · due ${formatDate(r.current_due_date)} · reported ${formatDate(r.actual_completion_date)}${timing ? ` (${COMPLETION_TIMING_LABEL[timing]})` : ""}`,
        at: r.validation_performed_at,
      });
    });
    type EX = { id: string; requested_by: string; requested_new_due_date: string; reason_category: string | null; decision_notes: string | null; decided_at: string; task: { name: string; task_number: number | null; assignee_id: string | null; project: { name: string } | null } | null };
    ((ex.data as unknown as EX[]) ?? []).forEach((r) => {
      out.push({
        key: `e-${r.id}`, kind: "extension", id: r.id, subjectId: r.requested_by,
        label: r.task?.task_number ? `T-${String(r.task.task_number).padStart(4, "0")}` : "Task",
        title: r.task?.name ?? "Task",
        context: r.task?.project?.name ?? "—",
        detail: `${personName(r.requested_by)} · new due ${formatDate(r.requested_new_due_date)}${r.reason_category ? ` · ${r.reason_category}` : ""}`,
        at: r.decided_at,
      });
    });
    out.sort((a, b) => (a.at < b.at ? 1 : -1));
    setItems(out);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const isMine = (it: Item) => !routing || routeApproval(routing, it.subjectId).approverId === meId;
  const visible = useMemo(() => items.filter((it) => (isFullAccess && showAll) || isMine(it)), [items, showAll, isFullAccess, routing]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doReverse() {
    if (!reversing || !note.trim()) return;
    setBusy(true);
    const res = reversing.kind === "time" ? await reverseAutoTime(reversing.id, note.trim()) : await reverseAutoValidation(reversing.id, note.trim());
    setBusy(false);
    if (res.error) { await alert(friendlyError("reverse this approval", res.error)); return; }
    setReversing(null);
    setNote("");
    await load();
    onChanged?.();
  }

  async function runTest() {
    if (!testProject) return;
    const res = await runAutoValidations(testProject, testIgnoreWait);
    if (res.error) { await alert(friendlyError("run auto-validation", res.error)); return; }
    await alert({ title: "Auto-validation finished", message: `${res.count ?? 0} ${res.count === 1 ? "task was" : "tasks were"} validated automatically in this project.` });
    await load();
    onChanged?.();
  }

  const th: CSSProperties = { padding: "9px 12px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", textAlign: "left" };
  const td: CSSProperties = { padding: "10px 12px", fontSize: 11.5, color: "var(--text-secondary)", verticalAlign: "top" };
  const kindLabel = { time: "Time log", validation: "Task validation", extension: "Extension" } as const;
  const kindTone = { time: "blue", validation: "mint", extension: "gold" } as const;

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: -4, marginBottom: 12, lineHeight: 1.5 }}>
        Items approved automatically in the last 7 days. Time logs and task validations can be reversed within 7 days; they go back to <strong>Mine to approve</strong>. Extensions can't be undone.
      </p>
      {isFullAccess && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show everyone's (not only routed to me)
        </label>
      )}
      {IS_PREVIEW && isFullAccess && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 12px", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 12, fontSize: 12 }}>
          <Zap size={14} style={{ color: "var(--accent)" }} />
          <strong style={{ color: "var(--navy)" }}>Preview test:</strong> run the on-the-due-date auto-validation for one project
          <select value={testProject} onChange={(e) => setTestProject(e.target.value)} style={{ fontSize: 12, padding: "4px 6px" }}>
            <option value="">Choose a test project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={testIgnoreWait} onChange={(e) => setTestIgnoreWait(e.target.checked)} /> skip the 2-day wait
          </label>
          <button onClick={runTest} disabled={!testProject} style={{ fontSize: 12, fontWeight: 600, padding: "5px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface)", cursor: testProject ? "pointer" : "default" }}>Run now</button>
        </div>
      )}
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>
      ) : visible.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "18px 0" }}>Nothing auto-approved in the last 7 days.</div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--surface-2, #f5f6f8)", borderBottom: "1px solid var(--border)" }}>
                <th style={th}>Type</th>
                <th style={th}>ID</th>
                <th style={th}>Item / Project</th>
                <th style={th}>Details</th>
                <th style={th}>Auto-approved</th>
                <th style={{ ...th, textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((it) => {
                const canReverse = it.kind !== "extension" && Date.now() - +new Date(it.at) < WEEK_MS && (isMine(it) || isFullAccess);
                return (
                  <tr key={it.key} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={td}><span className={`status-pill ${kindTone[it.kind]}`} style={{ fontSize: 10, whiteSpace: "nowrap" }}>{kindLabel[it.kind]}</span></td>
                    <td style={{ ...td, fontWeight: 700, color: "var(--navy)", whiteSpace: "nowrap" }}>{it.label}</td>
                    <td style={td}>
                      <div style={{ fontWeight: 700, color: "var(--navy)" }}>{it.title}</div>
                      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 1 }}>{it.context}</div>
                    </td>
                    <td style={td}>{it.detail}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatDate(it.at)}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {canReverse ? (
                        <button onClick={() => { setReversing(it); setNote(""); }} title="Reverse: send back to Mine to approve" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--accent)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 8px", cursor: "pointer" }}>
                          <RotateCcw size={12} /> Reverse
                        </button>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {reversing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={() => !busy && setReversing(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: 20, width: 420, maxWidth: "92vw", boxShadow: "0 10px 30px rgba(0,0,0,0.18)" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--navy)", marginBottom: 6 }}>Reverse auto-approval</div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>
              <strong>{reversing.label} · {reversing.title}</strong> goes back to Mine to approve for a manual decision{reversing.kind === "validation" ? " (the task stays Done)" : ""}. A reason is required.
            </div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Why are you reversing this?" style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5, padding: 8, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setReversing(null)} disabled={busy} style={{ fontSize: 12.5, padding: "6px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface)", cursor: "pointer" }}>Cancel</button>
              <button onClick={doReverse} disabled={busy || !note.trim()} style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", border: "none", borderRadius: "var(--radius-sm)", background: note.trim() ? "var(--accent)" : "var(--border)", color: "#fff", cursor: note.trim() ? "pointer" : "default" }}>{busy ? "Reversing…" : "Reverse"}</button>
            </div>
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
