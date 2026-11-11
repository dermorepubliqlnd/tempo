// 2026-11-11 (Sandra: "cover everything so everything behaves properly in both
// views"). The ONE way a task is finished, used by Projects & Tasks and My
// Dashboard's My Work: the Complete task pop-up (Mark Done / Ready for Review /
// Pass QA / Approve), Request Revision, the Log time form inside both, and the
// confirmation toast. Moved out of Projects.tsx unchanged; the database keeps
// the last word on every rule (completion date, validation, time guardrails).
import { useEffect, useMemo, useState } from "react";
import { PencilLine, Send } from "lucide-react";
import CompleteTaskModal from "./CompleteTaskModal";
import LogTimeModal from "./LogTimeModal";
import Modal from "./Modal";
import { DialogHeader, SummaryBand } from "./DialogHeader";
import { supabase } from "../lib/supabaseClient";
import { fetchAllRows } from "../lib/fetchAllRows";
import { useConfirm } from "../lib/useConfirm";
import { friendlyError } from "../lib/prompts";
import { formatDate } from "../lib/formatDate";
import { toISO } from "../lib/workingDays";
import { ownHoursFor, isCountedEntry, type TimeEntryRow } from "../lib/timeTracking";
import { computeReadiness, isR1Project, isReviewStep, workTypeNameMap, type ReadinessDep } from "../lib/taskReadiness";
import {
  actionLabelFor,
  canReturnFrom,
  completionTimingFor,
  completionWords,
  deriveParentStatus,
  handoffFor,
  returnableFor,
  reviewStepKind,
  type CompletionContext,
  type CompletionTask,
  type Handoff,
} from "../lib/taskCompletion";

export interface FlowTask extends CompletionTask {
  output_type_id?: string | null;
  output_count?: number | null;
  estimated_hours?: number | null;
  actual_completion_date?: string | null;
}
export interface FlowProject {
  id: string;
  owner_id: string | null;
  wbs_status?: string | null;
  created_at?: string | null;
  lifecycle_version?: number | null;
}
export type CompletionRequest =
  | { kind: "complete"; taskId: string; handoff?: Handoff | null; initialDate?: string }
  | { kind: "revision"; taskId: string };
export interface DoneToastData {
  title: string;
  detail: string;
  tone: "ok" | "warn";
}

interface WorkTypeOpt { id: string; name: string; is_active: boolean }
interface OutputTypeOpt { id: string; name: string; is_active: boolean; counts_deliverable?: boolean }
type ReturnEvent = { task_id: string; review_task_id?: string | null; action: string; comment: string | null; round: number; actor_id: string | null; created_at: string };

interface Props<T extends FlowTask> {
  request: CompletionRequest | null;
  tasks: T[];
  deps: ReadinessDep[];
  projects: FlowProject[];
  people: { id: string; name: string }[];
  me: { id: string; access_level?: string | null } | null | undefined;
  /** Projects & Tasks maps custom status labels to groups; default Done / Cancelled. */
  isClosedStatus?: (status: string | null) => boolean;
  /** Saves a parent's rolled-up Status (Projects & Tasks passes its own updateTask). */
  updateParent?: (id: string, patch: Partial<T>) => Promise<void>;
  /** Fields the flow just saved on a task (Done, types, Output Count, completion read-back). */
  onTaskUpdated: (taskId: string, fields: Partial<T>) => void;
  /** Something changed that needs a reload (time logged, sent back for revision). */
  onChanged: () => void;
  onToast: (toast: DoneToastData) => void;
  onClose: () => void;
}

export default function TaskCompletionFlow<T extends FlowTask>({ request, tasks, deps, projects, people, me, isClosedStatus, updateParent, onTaskUpdated, onChanged, onToast, onClose }: Props<T>) {
  const { alert, dialog: confirmDialog } = useConfirm();
  const [workTypes, setWorkTypes] = useState<WorkTypeOpt[] | null>(null);
  const [outputTypes, setOutputTypes] = useState<OutputTypeOpt[]>([]);
  const [typeLinks, setTypeLinks] = useState<{ work_type_id: string; output_type_id: string }[]>([]);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<ReturnEvent[] | null>(null);
  const [entries, setEntries] = useState<TimeEntryRow[] | null>(null);
  const [stage, setStage] = useState<"loading" | "complete" | "revision" | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [notice, setNotice] = useState("");
  const [logTimeFor, setLogTimeFor] = useState<"complete" | "revision" | null>(null);
  const [returnTarget, setReturnTarget] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState("");

  const task = request ? tasks.find((x) => x.id === request.taskId) : undefined;
  const projectId = task?.project_id ?? null;

  // Lookups, loaded once.
  useEffect(() => {
    void Promise.all([
      supabase.from("work_types").select("id,name,is_active,sort_order").order("sort_order"),
      supabase.from("output_types").select("id,name,is_active,sort_order,counts_deliverable").order("sort_order"),
      supabase.from("work_type_output_types").select("work_type_id,output_type_id"),
      supabase.from("holidays").select("date"),
    ]).then(([wt, ot, links, hol]) => {
      setWorkTypes((wt.data as WorkTypeOpt[]) ?? []);
      setOutputTypes((ot.data as OutputTypeOpt[]) ?? []);
      setTypeLinks((links.data as { work_type_id: string; output_type_id: string }[]) ?? []);
      setHolidayDates(new Set(((hol.data as { date: string }[]) ?? []).map((h) => h.date.slice(0, 10))));
    });
  }, []);

  // Review events of this project (For Revision rounds, resubmissions).
  async function loadEvents(pid: string) {
    const ids = tasks.filter((x) => x.project_id === pid).map((x) => x.id);
    if (!ids.length) { setEvents([]); return; }
    const { data } = await fetchAllRows<ReturnEvent>((f, t) =>
      supabase.from("task_review_events").select("task_id,review_task_id,action,comment,round,actor_id,created_at").in("task_id", ids).in("action", ["returned", "completed"]).order("created_at", { ascending: false }).order("id").range(f, t)
    );
    setEvents(data);
  }
  // Time on the task being finished (final + still waiting for approval).
  async function loadEntries(taskId: string) {
    const { data } = await fetchAllRows<TimeEntryRow>((f, t) =>
      supabase.from("time_entries").select("*").eq("task_id", taskId).eq("is_archived", false).in("status", ["confirmed", "approved", "pending_confirm", "pending_approval"]).order("id").range(f, t)
    );
    setEntries(data);
  }

  // A new request: fresh data, then open the right dialog.
  useEffect(() => {
    if (!request || !projectId) { setStage(null); return; }
    setStage("loading");
    setEvents(null);
    setEntries(null);
    setNotice("");
    void loadEvents(projectId);
    void loadEntries(request.taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, projectId]);

  const wtNames = useMemo(() => (workTypes ? workTypeNameMap(workTypes) : null), [workTypes]);
  const r1ProjectIds = useMemo(() => new Set(projects.filter((p) => isR1Project(p)).map((p) => p.id)), [projects]);
  const ctx: CompletionContext<T> = useMemo(() => ({ tasks, deps, r1ProjectIds, wtNames }), [tasks, deps, r1ProjectIds, wtNames]);
  const personName = (id: string | null | undefined) => (id ? people.find((p) => p.id === id)?.name ?? null : null);

  const lastReturnByTask = useMemo(() => {
    const m = new Map<string, ReturnEvent>();
    for (const e of events ?? []) if (e.action === "returned" && !m.has(e.task_id)) m.set(e.task_id, e);
    return m;
  }, [events]);
  // A step that sent work back: count its time from the resubmission
  // (the work task's next completion), else from the return itself.
  const reReviewSince = useMemo(() => {
    const byReview = new Map<string, ReturnEvent>();
    for (const e of events ?? []) if (e.action === "returned" && e.review_task_id && !byReview.has(e.review_task_id)) byReview.set(e.review_task_id, e);
    const since = new Map<string, string>();
    for (const [reviewId, ret] of byReview) {
      const resub = (events ?? []).filter((e) => e.action === "completed" && e.task_id === ret.task_id && e.created_at > ret.created_at).map((e) => e.created_at).sort()[0];
      since.set(reviewId, resub ?? ret.created_at);
    }
    return since;
  }, [events]);

  // Everything loaded: decide what opens.
  useEffect(() => {
    if (stage !== "loading" || !request || !task || !wtNames || events === null || entries === null) return;
    if (request.kind === "revision") {
      const c = returnableFor(task, ctx);
      setReturnTarget(c[0]?.id ?? "");
      setReturnComment("");
      setReturnError("");
      setStage("revision");
      return;
    }
    const h = request.handoff ?? handoffFor(task, ctx);
    const rd = computeReadiness(tasks, deps, (t) => r1ProjectIds.has((t as T).project_id), (t) => isReviewStep(t, wtNames)).get(task.id);
    if (r1ProjectIds.has(task.project_id) && rd && rd.waitingOn.length > 0) {
      setStage(null);
      void alert({ title: "Waiting on earlier work", message: `This can be finished once these are done: ${rd.waitingOn.map((w) => w.name).join(", ")}.` }).then(onClose);
      return;
    }
    setHandoff(h);
    setStage("complete");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, request, task, wtNames, events, entries]);

  const hasChildren = (id: string) => tasks.some((x) => x.parent_task_id === id);

  async function recomputeAncestorStatus(childId: string, snapshot: T[]): Promise<void> {
    const child = snapshot.find((t) => t.id === childId);
    if (!child?.parent_task_id) return;
    const parentId = child.parent_task_id;
    const computed = deriveParentStatus(snapshot.filter((t) => t.parent_task_id === parentId).map((t) => t.status));
    const parent = snapshot.find((t) => t.id === parentId);
    if (!parent || parent.status === computed) return;
    const patch = (computed === "Done"
      ? { status: computed, submitted_on: new Date().toISOString(), submitted_by: null }
      : { status: computed, submitted_on: null, submitted_by: null }) as unknown as Partial<T>;
    if (updateParent) await updateParent(parentId, patch);
    else {
      const { error } = await supabase.from("tasks").update(patch as Record<string, unknown>).eq("id", parentId);
      if (!error) onTaskUpdated(parentId, patch);
    }
    await recomputeAncestorStatus(parentId, snapshot.map((t) => (t.id === parentId ? { ...t, ...patch } : t)));
  }

  const actionLabel = actionLabelFor(handoff);

  async function confirmTaskDone(t: T, date: string, outputCount: number, types?: { workTypeId: string | null; outputTypeId: string | null }, graceAnswer?: boolean): Promise<string | null> {
    if (ownHoursFor(entries ?? [], t.id) <= 0) return "Log your time on this task first.";
    const saved: Partial<FlowTask> = {};
    // phase189: Work Type / Output Type changed in the pop-up -> saved with an Audit Trail entry.
    if (types) {
      const { error } = await supabase.rpc("set_task_types_at_completion", { p_task_id: t.id, p_work_type_id: types.workTypeId, p_output_type_id: types.outputTypeId });
      if (error) return friendlyError("change the Work Type / Output Type", error).message ?? "Couldn't change the Work Type / Output Type.";
      t = { ...t, work_type_id: types.workTypeId, output_type_id: types.outputTypeId };
      saved.work_type_id = types.workTypeId;
      saved.output_type_id = types.outputTypeId;
    }
    const outType = outputTypes.find((o) => o.id === t.output_type_id);
    const countsDeliverable = !!outType && outType.counts_deliverable !== false;
    if (countsDeliverable && (t.output_count ?? null) !== outputCount) {
      const { error } = await supabase.from("tasks").update({ output_count: outputCount }).eq("id", t.id);
      if (error) return friendlyError("save the Output Count", error).message ?? "Couldn't save the Output Count.";
      saved.output_count = outputCount;
    }
    const patch = {
      actual_completion_date: date,
      status: "Done",
      submitted_on: new Date().toISOString(),
      submitted_by: me?.id ?? null,
      ...(graceAnswer !== undefined ? { completion_grace_answer: graceAnswer } : {}),
    };
    const { error } = await supabase.from("tasks").update(patch).eq("id", t.id);
    if (error) {
      if (Object.keys(saved).length) onTaskUpdated(t.id, saved as Partial<T>);
      return friendlyError("mark the task Done", error).message ?? "Couldn't mark the task Done.";
    }
    // The database fills the completion date and validation on new projects;
    // read them back so the row shows them straight away (no stale "Validate").
    const { data: fresh } = await supabase
      .from("tasks")
      .select("actual_completion_date,validated_completion_date,validated_by,validation_performed_at,validated_locked_at,auto_validated,submitted_on,completion_timing,completion_grace_answer")
      .eq("id", t.id)
      .maybeSingle();
    const freshTiming = (fresh as { completion_timing?: string | null; actual_completion_date?: string | null } | null) ?? null;
    onTaskUpdated(t.id, { ...saved, ...patch, ...((fresh as object | null) ?? {}) } as unknown as Partial<T>);
    const words = completionWords(t, actionLabel, ctx, personName);
    const resubmit = actionLabel === "Ready for Review" && (t.revision_count ?? 0) > 0;
    const title = actionLabel === "Ready for Review" ? (resubmit ? "Resubmitted for review" : "Submitted for review") : actionLabel === "Pass QA" ? "QA passed" : actionLabel === "Approve" ? "Approved" : "Marked as done";
    // phase228: toast from mock-ups 1-4.
    const kind = actionLabel === "Mark Done" ? freshTiming?.completion_timing ?? null : null;
    const recDate = freshTiming?.actual_completion_date ? formatDate(freshTiming.actual_completion_date) : formatDate(toISO(new Date()));
    if (kind === "early") onToast({ title: "Sent for validation", detail: `${t.name} · Completed ahead of schedule. It will be reviewed in the Approval Center.`, tone: "ok" });
    else if (kind === "on_time") onToast({ title: "Task completed", detail: `${t.name} · Recorded as On Time · ${recDate}`, tone: "ok" });
    else if (kind === "grace_on_time") onToast({ title: "Task completed", detail: `${t.name} · Recorded as On Time (grace period) · Due: ${formatDate(t.current_due_date ?? null)} · Updated: ${formatDate(toISO(new Date()))}`, tone: "ok" });
    else if (kind === "late") onToast({ title: "Task completed", detail: `${t.name} · Recorded as Late · ${recDate}`, tone: "warn" });
    else if (kind === "logged_late") onToast({ title: "Task completed", detail: `${t.name} · Recorded on its due date · ${recDate}`, tone: "ok" });
    else onToast({ title, detail: `${t.name} · ${words[1]}`, tone: "ok" });
    setStage(null);
    onClose();
    await recomputeAncestorStatus(t.id, tasks.map((row) => (row.id === t.id ? { ...row, ...saved, ...patch } : row)));
    return null;
  }

  async function submitReturn() {
    if (!task) return;
    if (!returnComment.trim()) {
      setReturnError("Add a comment so the owner knows what to change.");
      return;
    }
    setReturnBusy(true);
    const { error } = await supabase.rpc("r2_return_task", { p_review_task_id: task.id, p_work_task_id: returnTarget, p_comment: returnComment.trim() });
    setReturnBusy(false);
    if (error) {
      setReturnError(friendlyError("send the task for revision", error).message ?? "Couldn't send the task for revision.");
      return;
    }
    const wt = tasks.find((x) => x.id === returnTarget);
    const who = personName(wt?.assignee_id);
    onToast({ title: "Sent back for revision", detail: `${wt?.name ?? "The work"} is back with ${who ?? "its owner"}, with your comment.`, tone: "warn" });
    setStage(null);
    onClose();
    onChanged();
  }

  const counted = (entries ?? []).filter((e) => isCountedEntry(e));
  const minsSince = (taskId: string, since: string | undefined) =>
    counted.filter((e) => e.task_id === taskId && (!since || e.created_at > since)).reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);

  let body: React.ReactNode = null;
  if (task && stage === "complete") {
    const ct = task;
    const isNew = r1ProjectIds.has(ct.project_id);
    const ot = outputTypes.find((o) => o.id === ct.output_type_id);
    const pendingMin = (entries ?? [])
      .filter((e) => e.status === "pending_confirm" || e.status === "pending_approval")
      .reduce((sum, e) => sum + (e.duration_minutes ?? 0), 0);
    const ret = isNew && (ct.revision_count ?? 0) > 0 ? lastReturnByTask.get(ct.id) : undefined;
    const reSince = !ret && isNew ? reReviewSince.get(ct.id) : undefined;
    const revisionHours = reSince ? Math.round((minsSince(ct.id, reSince) / 60) * 100) / 100 : ret?.created_at ? Math.round((minsSince(ct.id, ret.created_at) / 60) * 100) / 100 : null;
    const words = completionWords(ct, actionLabel, ctx, personName);
    body = (
      <CompleteTaskModal
        key={ct.id}
        info={{
          name: ct.name,
          dueDate: ct.current_due_date ?? null,
          workTypeName: workTypes?.find((w) => w.id === ct.work_type_id)?.name ?? null,
          outputTypeName: ot?.name ?? null,
          countsDeliverable: !!ot && ot.counts_deliverable !== false,
          estimatedHours: ct.estimated_hours ?? null,
          loggedHours: ownHoursFor(entries ?? [], ct.id),
          pendingHours: Math.round((pendingMin / 60) * 100) / 100,
          revisionRole: !ret && isNew && reReviewSince.has(ct.id) ? "review" : "doer",
          revisionHours,
          typeEdit: {
            workTypeId: ct.work_type_id ?? null,
            outputTypeId: ct.output_type_id ?? null,
            workTypes: workTypes ?? [],
            outputTypes,
            links: typeLinks,
          },
        }}
        initialDate={(request?.kind === "complete" && request.initialDate) || toISO(new Date())}
        initialCount={ct.output_count ?? null}
        today={toISO(new Date())}
        actionLabel={actionLabel}
        onLogTime={() => setLogTimeFor("complete")}
        onCancel={() => { setStage(null); onClose(); }}
        onConfirm={(date, count, types, grace) => confirmTaskDone(ct, date, count, types, grace)}
        timing={completionTimingFor(ct, actionLabel, projects.find((p) => p.id === ct.project_id), hasChildren(ct.id), holidayDates)}
        outcome={words[0]}
        autoDate
        subtitle={(() => {
          if (actionLabel === "Ready for Review") {
            const who = /to (.+) for review/.exec(words[0])?.[1];
            return `Confirm the work details before sending this task to ${who ?? "the reviewer"} for review.`;
          }
          return `Confirm the details. ${words[0]}`;
        })()}
        notice={notice}
        onRevision={reviewStepKind(ct, ctx) && canReturnFrom(ct, ctx, me, projects, isClosedStatus) ? () => {
          setReturnTarget(returnableFor(ct, ctx)[0]?.id ?? "");
          setReturnComment("");
          setReturnError("");
          setStage("revision");
        } : undefined}
      />
    );
  } else if (task && stage === "revision") {
    const candidates = returnableFor(task, ctx).map((x) => ({ id: x.id, name: x.name }));
    const target = candidates.find((c) => c.id === returnTarget) ?? candidates[0];
    const MAX = 500;
    const reSince = reReviewSince.get(task.id);
    const needsReviewTime = r1ProjectIds.has(task.project_id) && minsSince(task.id, reSince) <= 0;
    const close = () => { if (!returnBusy) { setStage(null); onClose(); } };
    body = (
      <Modal title="Request Revision" hideHeader onClose={close} width={600}>
        <div style={{ display: "grid", gap: 18, padding: "4px 4px 0" }}>
          {/* 2026-10-23 (Sandra's mock-up) */}
          <DialogHeader
            icon={<PencilLine size={22} />}
            title="Request Revision"
            subtitle="Return this task to the assignee for changes. Once updated and resubmitted, it will return to you for review."
            onClose={returnBusy ? undefined : close}
          />
          <SummaryBand
            items={[
              {
                label: "Task",
                value:
                  candidates.length > 1 ? (
                    <select value={returnTarget} onChange={(e) => setReturnTarget(e.target.value)} style={{ fontSize: 13, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", maxWidth: "100%" }}>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={target?.name}>{target?.name ?? "—"}</span>
                  ),
              },
              { label: "Current stage", value: <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={task.name}>{task.name}</span> },
            ]}
          />
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>Revision instructions <span style={{ color: "var(--danger-text)" }}>*</span></span>
            <textarea
              value={returnComment}
              maxLength={MAX}
              onChange={(e) => { setReturnComment(e.target.value.slice(0, MAX)); if (returnError) setReturnError(""); }}
              rows={4}
              placeholder="Scenario 2 doesn't follow the SOP sequence. Please swap steps 3 and 4."
              style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 13.5, padding: "10px 12px", borderRadius: 8, border: "1px solid #9cc3f0", resize: "vertical" }}
            />
            <span style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 11.5, color: "var(--muted)" }}>
              <span>Describe what needs to be corrected so the assignee can take action.</span>
              <span style={{ flexShrink: 0 }}>{returnComment.length}/{MAX}</span>
            </span>
          </label>
          {needsReviewTime && (
            <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--warning-border, #f3d48b)", background: "var(--warning-bg, #fff8e6)", fontSize: 12.5 }}>
              <span aria-hidden="true" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: "#f59e0b", color: "#fff", fontWeight: 800, fontSize: 15 }}>!</span>
              <span style={{ flex: 1, minWidth: 200, display: "grid", gap: 2 }}>
                <strong style={{ fontSize: 13.5, color: "var(--text)" }}>Review time required</strong>
                <span style={{ color: "var(--text-secondary)" }}>{reSince ? "Log the time you spent reviewing the resubmitted work before sending it back." : "Log the time you spent reviewing before sending it back."}</span>
              </span>
              <button type="button" className="btn-secondary" onClick={() => setLogTimeFor("revision")} style={{ padding: "7px 16px", fontSize: 12.5, background: "#fff" }}>Log time</button>
            </div>
          )}
          {returnError && <div style={{ color: "var(--danger-text)", fontSize: 12 }}>{returnError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <button className="btn-secondary" disabled={returnBusy} onClick={close} style={{ padding: "9px 20px" }}>Cancel</button>
            <button className="btn-primary" disabled={returnBusy || !returnComment.trim() || needsReviewTime} onClick={() => void submitReturn()} style={{ padding: "9px 20px", display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Send size={15} /> {returnBusy ? "Sending…" : "Request Revision"}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <>
      {body}
      {task && logTimeFor && me && (
        <LogTimeModal
          personId={me.id}
          isFullAccess={me.access_level === "full"}
          presetTaskId={task.id}
          onClose={() => setLogTimeFor(null)}
          onSaved={() => {
            if (logTimeFor === "complete") setNotice(`Time logged. Now click ${actionLabel} to finish.`);
            setLogTimeFor(null);
            void loadEntries(task.id);
            onChanged();
          }}
        />
      )}
      {confirmDialog}
    </>
  );
}

/** The bottom-right confirmation after a hand-off (2026-10-22). */
export function DoneToast({ toast, onClose }: { toast: DoneToastData | null; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const h = window.setTimeout(onClose, 7000);
    return () => window.clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);
  if (!toast) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", right: 20, bottom: 20, zIndex: 1300, display: "flex", gap: 12, alignItems: "flex-start", background: "#fff", color: "#0f2942", padding: "12px 14px 12px 12px", borderRadius: 10, border: `1px solid ${toast.tone === "ok" ? "#9fd9b9" : "#f3d48b"}`, borderLeft: `5px solid ${toast.tone === "ok" ? "#16a34a" : "#d97706"}`, boxShadow: "0 12px 32px rgba(15,41,66,.22)", width: "min(400px, calc(100vw - 32px))" }}>
      <span aria-hidden="true" style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800, color: "#fff", background: toast.tone === "ok" ? "#16a34a" : "#d97706" }}>{toast.tone === "ok" ? "✓" : "↺"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{toast.title}</span>
        <span style={{ display: "block", fontSize: 12.5, color: "#435a73", marginTop: 2 }}>{toast.detail}</span>
      </span>
      <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", color: "#6d8198", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2, width: "auto" }}>×</button>
    </div>
  );
}
