import { supabase } from "./supabaseClient";

// 2026-09-23 (phase104, Sandra: "no hard delete in the app -- always route
// to archive; Archive page is a recycle bin"). Every delete in the app goes
// through archiveItem(); restore only happens from the Archive page.
// Items are auto-purged 90 days after archiving (pg_cron, server-side).
export type ArchiveKind =
  | "project"
  | "task"
  | "time_entry"
  | "kb_category"
  | "kb_entry"
  | "holiday"
  | "project_type"
  | "project_category"
  | "project_source"
  | "project_phase"
  | "project_planning_type"
  | "work_type"
  | "output_type"
  | "activity_type"
  | "time_entry_reason"
  | "cancellation_reason"
  | "decline_reason";

export const ARCHIVE_RETENTION_DAYS = 90;

export const ARCHIVE_KIND_LABEL: Record<ArchiveKind, string> = {
  project: "Project",
  task: "Task",
  time_entry: "Time Entry",
  kb_category: "KB Category",
  kb_entry: "KB Entry",
  holiday: "Holiday",
  project_type: "Project Type",
  project_category: "Project Category",
  project_source: "Project Source",
  project_phase: "Project Phase",
  project_planning_type: "Planning Type",
  work_type: "Work Type",
  output_type: "Output Type",
  activity_type: "Activity Type",
  time_entry_reason: "Time Logging Reason",
  cancellation_reason: "Cancellation Reason",
  decline_reason: "Decline Reason",
};

export const ARCHIVE_MOVE_NOTE = `It moves to the Archive and can be restored within ${ARCHIVE_RETENTION_DAYS} days.`;

export async function archiveItem(kind: ArchiveKind, id: string, reason?: string): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("archive_item", { p_kind: kind, p_id: id, p_reason: reason ?? null });
  return { error: error ? { message: error.message } : null };
}

export async function restoreItem(kind: ArchiveKind, id: string): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc("restore_item", { p_kind: kind, p_id: id });
  return { error: error ? { message: error.message } : null };
}

// phase117 (2026-09-24, Sandra): tasks can be deleted by the task owner,
// the project owner, or anyone above either of them in the reporting line;
// projects by the project owner or anyone above them (Full Access always).
// Checked BEFORE the confirm dialog so people see who to reach out to
// instead of a failed delete. archive_item enforces the same rule
// server-side. If the check RPC isn't available yet, nothing is blocked
// here and the server stays the gate.
export async function splitByArchivePermission(
  kind: "project" | "task",
  ids: string[]
): Promise<{ allowed: string[]; blocked: { id: string; message: string }[] }> {
  const allowed: string[] = [];
  const blocked: { id: string; message: string }[] = [];
  const results = await Promise.all(ids.map((id) => supabase.rpc("archive_block_reason", { p_kind: kind, p_id: id })));
  results.forEach((res, i) => {
    if (!res.error && typeof res.data === "string" && res.data) blocked.push({ id: ids[i], message: res.data });
    else allowed.push(ids[i]);
  });
  return { allowed, blocked };
}

export function blockedDeleteMessage(blocked: { message: string }[], allowedCount: number): string {
  const lines = blocked.length === 1 ? blocked[0].message : blocked.map((b) => `- ${b.message}`).join("\n");
  const head = blocked.length === 1 ? "" : `${blocked.length} of the selected items can't be deleted by you:\n`;
  const tail = allowedCount > 0 ? `\n\nThe other ${allowedCount} can still be deleted -- you'll be asked to confirm next.` : "";
  return head + lines + tail;
}
