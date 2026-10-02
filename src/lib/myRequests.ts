// 2026-10-02 (Sandra): "do the team have a single view to see their
// requests and status?" -- everything a person has submitted for approval,
// normalized into one shape. Used by Approval Center > My Requests and the
// My Dashboard "My Requests" card.
import { supabase } from "./supabaseClient";
import { timeLogId } from "./timeTracking";

export type MyRequestKind = "time" | "correction" | "extension" | "project_extension" | "baseline" | "closure" | "task_completion";
export type MyRequestStatus = "pending" | "approved" | "rejected";

export interface MyRequestRow {
  key: string;
  kind: MyRequestKind;
  typeLabel: string;
  refId: string | null;
  item: string;
  context: string;
  asked: string;
  status: MyRequestStatus;
  statusLabel: string;
  submittedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  link: string;
  taskId?: string | null;
  currentDueDate?: string | null;
}

export const MY_REQUEST_KIND_LABEL: Record<MyRequestKind, string> = {
  time: "Time Log",
  correction: "Time Correction",
  extension: "Task Extension",
  project_extension: "Project Timeline Extension",
  baseline: "Project Start",
  closure: "Project Close",
  task_completion: "Task Validation",
};

function norm(s: string | null | undefined): MyRequestStatus {
  const v = (s ?? "").toLowerCase();
  if (v === "approved" || v === "validated") return "approved";
  if (v === "rejected" || v === "declined") return "rejected";
  return "pending";
}

const fmtShort = (d: string | null | undefined) =>
  d ? new Date(d.length <= 10 ? d + "T00:00:00" : d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export async function loadMyRequests(meId: string, sinceDays = 90): Promise<MyRequestRow[]> {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const [{ data: people }, { data: te }, { data: corr }, { data: ext }, { data: bl }, { data: cl }, { data: tasks }] = await Promise.all([
    supabase.from("people").select("id,name"),
    supabase
      .from("time_entries")
      .select("id,entry_number,status,started_at,ended_at,duration_minutes,created_at,decided_by,decided_at,decision_notes,is_follow_up,task:tasks(id,name,project_id,project:projects(name)),activity_type:non_project_activity_types(name)")
      .eq("person_id", meId)
      .in("status", ["pending_approval", "approved", "rejected"])
      .eq("is_archived", false)
      .gte("created_at", since),
    supabase
      .from("time_entry_correction_requests")
      .select("id,status,created_at,decided_by,decided_at,decision_notes,proposed_started_at,proposed_ended_at,entry:time_entries(entry_number,task:tasks(name,project:projects(name)),activity_type:non_project_activity_types(name))")
      .eq("requested_by", meId)
      .neq("status", "cancelled")
      .gte("created_at", since),
    supabase
      .from("extension_requests")
      .select("id,status,created_at,decided_by,decided_at,decision_notes,requested_new_due_date,request_type,task:tasks!extension_requests_task_id_fkey(id,name,task_number,current_due_date,project_id,project:projects(name)),project:projects!extension_requests_project_id_fkey(id,name)")
      .eq("requested_by", meId)
      .gte("created_at", since),
    supabase.from("project_baseline_requests").select("id,project_id,status,requested_at,decided_by,decided_at,decision_reason,decline_reason,project:projects(name,project_number)").eq("requested_by", meId).gte("requested_at", since),
    supabase.from("project_closure_requests").select("id,project_id,status,requested_at,decided_by,decided_at,decision_reason,project:projects(name,project_number)").eq("requested_by", meId).gte("requested_at", since),
    supabase
      .from("tasks")
      .select("id,name,task_number,project_id,actual_completion_date,submitted_on,validated_completion_date,validated_by,validation_performed_at,completion_adjustment_reason,project:projects(name)")
      .eq("assignee_id", meId)
      .eq("status", "Done")
      .eq("is_archived", false)
      .gte("actual_completion_date", since.slice(0, 10)),
  ]);
  const nameOf = new Map(((people as { id: string; name: string }[]) ?? []).map((p) => [p.id, p.name]));
  const pn = (id: string | null | undefined) => (id ? nameOf.get(id) ?? "—" : null);
  const rows: MyRequestRow[] = [];
  type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  ((te as Any[]) ?? []).forEach((r) => {
    const st = norm(r.status === "pending_approval" ? "pending" : r.status);
    const mins = r.duration_minutes ?? 0;
    rows.push({
      key: `time-${r.id}`,
      kind: "time",
      typeLabel: r.is_follow_up ? "Follow-up Time" : r.activity_type ? "Non-project Time" : "Time Log",
      refId: timeLogId(r.entry_number),
      item: r.task?.name ?? r.activity_type?.name ?? "Time entry",
      context: r.task?.project?.name ?? "Non-project",
      asked: `${(mins / 60).toFixed(1)}h on ${fmtShort(r.started_at)}`,
      status: st,
      statusLabel: st === "pending" ? "Pending" : st === "approved" ? "Approved" : "Rejected",
      submittedAt: r.created_at,
      decidedBy: pn(r.decided_by),
      decidedAt: r.decided_at,
      note: r.decision_notes,
      link: "/time-tracking?scope=mine",
    });
  });
  ((corr as Any[]) ?? []).forEach((r) => {
    const st = norm(r.status);
    rows.push({
      key: `corr-${r.id}`,
      kind: "correction",
      typeLabel: "Time Correction",
      refId: timeLogId(r.entry?.entry_number),
      item: r.entry?.task?.name ?? r.entry?.activity_type?.name ?? "Time entry",
      context: r.entry?.task?.project?.name ?? "Non-project",
      asked: r.proposed_started_at ? `New time ${new Date(r.proposed_started_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${r.proposed_ended_at ? "–" + new Date(r.proposed_ended_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : ""}` : "Correction",
      status: st,
      statusLabel: st === "pending" ? "Pending" : st === "approved" ? "Approved" : "Rejected",
      submittedAt: r.created_at,
      decidedBy: pn(r.decided_by),
      decidedAt: r.decided_at,
      note: r.decision_notes,
      link: "/time-tracking?scope=mine",
    });
  });
  ((ext as Any[]) ?? []).forEach((r) => {
    if (r.request_type === "start_date") return;
    const st = norm(r.status);
    const isProject = !!r.project;
    rows.push({
      key: `ext-${r.id}`,
      kind: isProject ? "project_extension" : "extension",
      typeLabel: isProject ? "Project Timeline Extension" : "Task Extension",
      refId: !isProject && r.task?.task_number ? `T-${String(r.task.task_number).padStart(4, "0")}` : null,
      item: isProject ? r.project?.name ?? "Project" : r.task?.name ?? "Task",
      context: isProject ? "Whole project" : r.task?.project?.name ?? "—",
      asked: `New due date ${fmtShort(r.requested_new_due_date)}`,
      status: st,
      statusLabel: st === "pending" ? "Pending" : st === "approved" ? "Approved" : "Rejected",
      submittedAt: r.created_at,
      decidedBy: pn(r.decided_by),
      decidedAt: r.decided_at,
      note: r.decision_notes,
      link: isProject ? `/projects/${r.project?.id}/wbs` : `/projects/${r.task?.project_id}`,
      taskId: isProject ? null : r.task?.id ?? null,
      currentDueDate: isProject ? null : r.task?.current_due_date ?? null,
    });
  });
  ((bl as Any[]) ?? []).forEach((r) => {
    const st = norm(r.status);
    rows.push({
      key: `bl-${r.id}`,
      kind: "baseline",
      typeLabel: "Project Start",
      refId: r.project?.project_number ? `P-${String(r.project.project_number).padStart(4, "0")}` : null,
      item: r.project?.name ?? "Project",
      context: "Start Project (lock baseline)",
      asked: "Start the project",
      status: st,
      statusLabel: st === "pending" ? "Pending" : st === "approved" ? "Approved" : "Declined",
      submittedAt: r.requested_at,
      decidedBy: pn(r.decided_by),
      decidedAt: r.decided_at,
      note: [r.decline_reason, r.decision_reason].filter(Boolean).join(" — ") || null,
      link: `/projects/${r.project_id}/wbs`,
    });
  });
  ((cl as Any[]) ?? []).forEach((r) => {
    const st = norm(r.status);
    rows.push({
      key: `cl-${r.id}`,
      kind: "closure",
      typeLabel: "Project Close",
      refId: r.project?.project_number ? `P-${String(r.project.project_number).padStart(4, "0")}` : null,
      item: r.project?.name ?? "Project",
      context: "Close project",
      asked: "Close the project",
      status: st,
      statusLabel: st === "pending" ? "Pending" : st === "approved" ? "Approved" : "Declined",
      submittedAt: r.requested_at,
      decidedBy: pn(r.decided_by),
      decidedAt: r.decided_at,
      note: r.decision_reason ?? null,
      link: `/projects/${r.project_id}/wbs`,
    });
  });
  ((tasks as Any[]) ?? []).forEach((r) => {
    const validated = !!r.validated_completion_date;
    rows.push({
      key: `tv-${r.id}`,
      kind: "task_completion",
      typeLabel: "Task Validation",
      refId: r.task_number ? `T-${String(r.task_number).padStart(4, "0")}` : null,
      item: r.name,
      context: r.project?.name ?? "—",
      asked: `Completed ${fmtShort(r.actual_completion_date ?? r.submitted_on)}`,
      status: validated ? "approved" : "pending",
      statusLabel: validated ? "Validated" : "Awaiting validation",
      submittedAt: r.submitted_on ?? r.actual_completion_date ?? new Date().toISOString(),
      decidedBy: pn(r.validated_by),
      decidedAt: r.validation_performed_at ?? (validated ? r.validated_completion_date : null),
      note: r.completion_adjustment_reason ?? null,
      link: `/projects/${r.project_id}`,
    });
  });
  return rows.sort((a, b) => new Date(b.decidedAt ?? b.submittedAt).getTime() - new Date(a.decidedAt ?? a.submittedAt).getTime());
}
