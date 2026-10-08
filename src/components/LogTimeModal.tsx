// 2026-10-08 (Sandra, item H): ONE "Log time" form, same checks everywhere.
// Replaces Time Tracking's Add Time form and the old FollowUpTimeModal
// (Projects "+" on a Done task); My Dashboard's Add Time opens it in place.
//   - Type: Project task / Non-project (activity type).
//   - The task list includes the person's Done tasks, labelled
//     "(Done – logs as follow-up)". Picking one switches the form to
//     follow-up (3 reasons) and submits via submitFollowUpTimeEntry.
//   - Same checks for every type: end before start = error (no more silent
//     11:59 PM clamp), future time = error, overlap = error naming the entry,
//     weekend/holiday soft confirm.
//   - The DB repeats these checks (phase173 zy_time_entry_guard, staging
//     first); its messages arrive as error text and are shown via friendlyError.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Modal from "./Modal";
import { supabase } from "../lib/supabaseClient";
import { useConfirm } from "../lib/useConfirm";
import { friendlyError } from "../lib/prompts";
import { formatDate } from "../lib/formatDate";
import { timeEntryOutcomeMessage } from "../lib/autoApprovals";
import { buildHolidayNameMap, nonWorkingDayConfirmMessage, type HolidayNameMap } from "../lib/workingDays";
import {
  FOLLOW_UP_REASON_LABEL,
  type FollowUpReason,
  timeLogId,
  submitManualTimeEntry,
  submitNonProjectTimeEntry,
  submitFollowUpTimeEntry,
} from "../lib/timeTracking";

export type LogTimeMode = "project" | "non_project";

interface TaskOption {
  id: string;
  name: string;
  assignee_id: string | null;
  project_id: string;
  parent_task_id: string | null;
  current_due_date: string | null;
  status: string | null;
  project: { id: string; name: string; timelines_locked: boolean; wbs_status: string } | null;
}
interface NamedRow {
  id: string;
  name: string;
  is_active: boolean;
}
interface OverlapEntry {
  id: string;
  entry_number: number | null;
  started_at: string;
  ended_at: string | null;
  status: string;
  activity_type_id: string | null;
  non_project_entry_number: number | null;
  task: { name: string; task_number: number | null } | null;
  activity_type: { name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  pending_confirm: "Needs confirming",
  confirmed: "Final",
  pending_approval: "Awaiting approval",
  approved: "Final",
  rejected: "Rejected",
};

const TASK_SELECT = "id,name,assignee_id,project_id,parent_task_id,current_due_date,status,is_scoping,project:projects(id,name,timelines_locked,wbs_status)";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function timeKey(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function clockRange(startedAt: string, endedAt: string | null): string {
  const f = (v: string) => new Date(v).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return endedAt ? `${f(startedAt)} to ${f(endedAt)}` : `${f(startedAt)}, still running`;
}
function overlapTaskLabel(row: OverlapEntry): string {
  const id = row.task?.task_number
    ? `T-${String(row.task.task_number).padStart(4, "0")}`
    : row.non_project_entry_number
    ? `NP-${String(row.non_project_entry_number).padStart(4, "0")}`
    : "";
  const name = row.activity_type_id ? row.activity_type?.name ?? "Non-project" : row.task?.name ?? "Untitled task";
  return id ? `${id} ${name}` : name;
}

// Searchable combobox (moved here from TimeTracking.tsx, unchanged).
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

export default function LogTimeModal({
  personId,
  isFullAccess = false,
  initialMode = "project",
  presetTaskId,
  onClose,
  onSaved,
}: {
  /** The signed-in person (people.id). */
  personId: string;
  isFullAccess?: boolean;
  initialMode?: LogTimeMode;
  /** Open pre-set to this task (Projects "+" on a Done task). The task may be
   * someone else's when a Full Access user logs follow-up on their behalf. */
  presetTaskId?: string;
  onClose: () => void;
  /** Called after a successful submit (the outcome message has been shown). */
  onSaved: () => void;
}) {
  const { confirm, alert, dialog } = useConfirm();
  const [mode, setMode] = useState<LogTimeMode>(presetTaskId ? "project" : initialMode);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [parentIds, setParentIds] = useState<Set<string>>(new Set());
  const [activityTypes, setActivityTypes] = useState<NamedRow[]>([]);
  const [reasons, setReasons] = useState<NamedRow[]>([]);
  const [holidayNames, setHolidayNames] = useState<HolidayNameMap>(new Map());
  const [assigneeName, setAssigneeName] = useState<string | null>(null);

  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState(presetTaskId ?? "");
  const [activityTypeId, setActivityTypeId] = useState("");
  const [reasonCategory, setReasonCategory] = useState("");
  const [followUpReason, setFollowUpReason] = useState<FollowUpReason | "">("");
  const [notes, setNotes] = useState("");
  const [loggedHours, setLoggedHours] = useState<number | null>(null);

  // Default: the hour that just ended (start 1 hour ago, end now), so the
  // form opens on a valid, already-passed range.
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    const s = new Date(now.getTime() - 60 * 60000);
    return s.getDate() === now.getDate() ? timeKey(s) : "00:00";
  });
  const [endTime, setEndTime] = useState(() => timeKey(new Date()));

  const [error, setError] = useState<string | null>(null);
  const [futureBlocked, setFutureBlocked] = useState(false);
  const [overlap, setOverlap] = useState<OverlapEntry | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: mine }, { data: preset }, { data: types }, { data: reasonRows }, { data: holidays }] = await Promise.all([
        supabase.from("tasks").select(TASK_SELECT).eq("is_archived", false).eq("assignee_id", personId),
        presetTaskId ? supabase.from("tasks").select(TASK_SELECT).eq("id", presetTaskId).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("non_project_activity_types").select("id,name,is_active").order("sort_order"),
        supabase.from("time_entry_reasons").select("id,name,is_active").order("sort_order"),
        supabase.from("holidays").select("date,name"),
      ]);
      if (cancelled) return;
      const list = ((mine as unknown as TaskOption[]) ?? []).slice();
      const p = preset as unknown as TaskOption | null;
      if (p && !list.some((t) => t.id === p.id)) list.push(p);
      // Follow-up isn't offered on parent tasks (same rule as the Projects "+").
      const doneIds = list.filter((t) => t.status === "Done").map((t) => t.id);
      let parents = new Set<string>();
      if (doneIds.length > 0) {
        const { data: kids } = await supabase.from("tasks").select("parent_task_id").eq("is_archived", false).in("parent_task_id", doneIds);
        parents = new Set(((kids as { parent_task_id: string }[] | null) ?? []).map((k) => k.parent_task_id));
      }
      if (p && p.assignee_id && p.assignee_id !== personId) {
        const { data: person } = await supabase.from("people").select("name").eq("id", p.assignee_id).maybeSingle();
        if (!cancelled) setAssigneeName((person as { name: string } | null)?.name ?? "the assignee");
      }
      if (cancelled) return;
      setTasks(list);
      setParentIds(parents);
      const at = (types as NamedRow[]) ?? [];
      setActivityTypes(at);
      setActivityTypeId((cur) => cur || at.find((a) => a.is_active)?.id || "");
      const rs = (reasonRows as NamedRow[]) ?? [];
      setReasons(rs);
      setReasonCategory((cur) => cur || rs.find((r) => r.is_active)?.name || "");
      setHolidayNames(buildHolidayNameMap((holidays as { date: string; name: string }[] | null) ?? []));
      if (p) setProjectId(p.project_id);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [personId, presetTaskId]);

  // Same "loggable" rule as before (baseline locked, project not closed),
  // now with Done tasks included as follow-up options.
  const loggableTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.project?.timelines_locked || (t as { is_scoping?: boolean }).is_scoping) &&
          t.project?.wbs_status !== "closed" &&
          (t.status !== "Done" || !parentIds.has(t.id))
      ),
    [tasks, parentIds]
  );
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of loggableTasks) if (t.project && !seen.has(t.project.id)) seen.set(t.project.id, t.project.name);
    return Array.from(seen, ([id, label]) => ({ id, label }));
  }, [loggableTasks]);
  const taskOptions = loggableTasks
    .filter((t) => t.project_id === projectId)
    .map((t) => ({ id: t.id, label: t.status === "Done" ? `${t.name} (Done – logs as follow-up)` : t.name }));

  const selectedTask = tasks.find((t) => t.id === taskId) ?? null;
  const isFollowUp = mode === "project" && selectedTask?.status === "Done";
  const onBehalfOf = isFollowUp && selectedTask?.assignee_id && selectedTask.assignee_id !== personId ? assigneeName ?? "the assignee" : null;
  const entryPersonId = isFollowUp && selectedTask?.assignee_id ? selectedTask.assignee_id : personId;

  // Logged so far on the chosen task (Final entries only, same as Logged hours).
  useEffect(() => {
    setLoggedHours(null);
    if (!taskId) return;
    let cancelled = false;
    supabase
      .from("time_entries")
      .select("duration_minutes")
      .eq("task_id", taskId)
      .eq("is_archived", false)
      .in("status", ["confirmed", "approved"])
      .then(({ data }) => {
        if (cancelled) return;
        const mins = ((data as { duration_minutes: number | null }[] | null) ?? []).reduce((s, e) => s + (e.duration_minutes ?? 0), 0);
        setLoggedHours(Math.round((mins / 60) * 100) / 100);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const start = new Date(`${date}T${startTime}`);
  const end = new Date(`${date}T${endTime}`);
  const validTimes = !isNaN(start.getTime()) && !isNaN(end.getTime());
  const minutes = validTimes ? Math.round((end.getTime() - start.getTime()) / 60000) : 0;

  function clearMessages() {
    setError(null);
    setFutureBlocked(false);
    setOverlap(null);
  }

  async function submit() {
    clearMessages();
    // What
    if (mode === "non_project") {
      if (!activityTypeId) return setError("Choose an activity type.");
      const at = activityTypes.find((a) => a.id === activityTypeId);
      if (at?.name === "Others" && !notes.trim()) return setError('Add a note saying what this was when "Others" is selected.');
    } else {
      if (!taskId || !selectedTask) return setError("Choose a task.");
      if (isFollowUp) {
        if (!followUpReason) return setError("Choose a follow-up reason.");
        if (onBehalfOf && !isFullAccess) return setError("Only the task's assignee can log follow-up time on it.");
        if (onBehalfOf && !notes.trim()) return setError(`Add a note explaining why you're logging this on ${onBehalfOf}'s behalf.`);
      } else {
        if (!reasonCategory) return setError("Choose a reason.");
        if (reasonCategory === "Other" && !notes.trim()) return setError('Add a note when "Other" is selected.');
      }
    }
    // When (same rules for every type)
    if (!validTimes) return setError("Enter a date, start time and end time.");
    if (end.getTime() <= start.getTime()) {
      return setError("The end time is before the start time. Change the end time. For work that ran past midnight, log the part after midnight as a separate entry on the next day.");
    }
    if (start.getTime() > Date.now() || end.getTime() > Date.now()) {
      setFutureBlocked(true);
      return;
    }
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    // Overlap: the same DB lookup the server uses (find_time_entry_overlap).
    const { data: conflictId } = await supabase.rpc("find_time_entry_overlap", {
      p_person_id: entryPersonId,
      p_started_at: startIso,
      p_ended_at: endIso,
      p_exclude_ids: [],
    });
    if (conflictId) {
      const { data: row } = await supabase
        .from("time_entries")
        .select("id, entry_number, started_at, ended_at, status, activity_type_id, non_project_entry_number, task:tasks(name, task_number), activity_type:non_project_activity_types(name)")
        .eq("id", conflictId as unknown as string)
        .maybeSingle();
      if (row) {
        setOverlap(row as unknown as OverlapEntry);
        return;
      }
      return setError("This time overlaps another entry. Change the start or end time.");
    }
    // Weekend / holiday: soft confirm, never blocks.
    const warn = nonWorkingDayConfirmMessage(date, holidayNames);
    if (warn && !(await confirm({ title: "Log time on a day off?", message: warn, confirmLabel: "Log anyway" }))) return;

    setSaving(true);
    const res =
      mode === "non_project"
        ? await submitNonProjectTimeEntry(personId, activityTypeId, startIso, endIso, notes.trim())
        : isFollowUp
        ? await submitFollowUpTimeEntry(taskId, startIso, endIso, followUpReason as FollowUpReason, notes.trim())
        : await submitManualTimeEntry(taskId, startIso, endIso, reasonCategory, notes.trim() || reasonCategory);
    if (res.error) {
      setSaving(false);
      await alert(friendlyError("log this time", res.error));
      return;
    }
    const outcome = isFollowUp
      ? { title: "Follow-up time sent for approval", message: "It counts toward the task once it's approved in Approval Center. The task stays Done." }
      : await timeEntryOutcomeMessage(res.id, "");
    setSaving(false);
    await alert(outcome);
    onSaved();
  }

  const input: CSSProperties = { width: "100%", fontSize: 12, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxSizing: "border-box" };
  const label: CSSProperties = { display: "block", fontSize: 11, color: "var(--muted)", marginBottom: 3 };
  const banner: CSSProperties = {
    color: "var(--danger-text)", fontSize: 11.5, marginBottom: 8, padding: "8px 10px",
    background: "var(--danger-bg)", border: "1px solid var(--danger-text)", borderRadius: "var(--radius-sm)",
  };
  const h = Math.floor(Math.max(0, minutes) / 60);
  const m = Math.max(0, minutes) % 60;
  const activityType = activityTypes.find((a) => a.id === activityTypeId);
  const title = isFollowUp ? "Log follow-up time" : "Log time";

  return (
    <Modal title={title} onClose={onClose} width={500}>
      {dialog}
      {loading ? (
        <div style={{ padding: 10, fontSize: 12, color: "var(--muted)" }}>Loading…</div>
      ) : (
        <>
          {!presetTaskId && (
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {(["project", "non_project"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setMode(k);
                    clearMessages();
                  }}
                  style={{
                    flex: 1, textAlign: "center", padding: "8px 0", borderRadius: "var(--radius-sm)",
                    border: `1px solid ${mode === k ? "var(--accent)" : "var(--border)"}`,
                    background: mode === k ? "var(--accent-bg, #eaf2fb)" : "transparent",
                    fontSize: 12, fontWeight: mode === k ? 600 : 500,
                    color: mode === k ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer",
                  }}
                >
                  {k === "project" ? "Project task" : "Non-project"}
                </button>
              ))}
            </div>
          )}

          {mode === "non_project" ? (
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={label}>Activity type</span>
              <select value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)} style={input}>
                {activityTypes
                  .filter((a) => a.is_active || a.id === activityTypeId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
          ) : presetTaskId && selectedTask ? (
            <div style={{ marginBottom: 8 }}>
              <span style={label}>Task</span>
              <div style={{ fontSize: 12.5, color: "var(--navy)" }}>
                <strong>{selectedTask.name}</strong>
                {selectedTask.project ? <span style={{ color: "var(--muted)" }}> · {selectedTask.project.name}</span> : null}
              </div>
            </div>
          ) : (
            <>
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={label}>Project</span>
                <SearchSelect
                  placeholder="Choose a project…"
                  value={projectId}
                  onChange={(id) => {
                    setProjectId(id);
                    setTaskId("");
                    clearMessages();
                  }}
                  options={projectOptions}
                />
              </label>
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={label}>Task (assigned to you)</span>
                <SearchSelect
                  placeholder={projectId ? "Choose a task…" : "Choose a project first"}
                  value={taskId}
                  onChange={(id) => {
                    setTaskId(id);
                    clearMessages();
                  }}
                  disabled={!projectId}
                  options={taskOptions}
                />
                {projectOptions.length === 0 && (
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    None of your tasks can take time right now. Their project hasn't been started (Start Project) or it's closed.
                  </span>
                )}
              </label>
            </>
          )}

          {isFollowUp && (
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 10 }}>
              This task is Done, so this is <strong>follow-up time</strong>: extra work after it was marked Done. The task stays Done and keeps its validated
              date. Follow-up time always goes to the approver in Approval Center.
            </div>
          )}
          {onBehalfOf && (
            <div className="status-pill warning" style={{ display: "inline-block", fontSize: 11, marginBottom: 10 }}>
              Logging on behalf of {onBehalfOf}
            </div>
          )}

          {mode === "project" && selectedTask && (
            <div
              style={{
                display: "flex", gap: 16, fontSize: 11.5, color: "var(--navy)", background: "var(--surface-2, #f5f6f8)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 10px", marginBottom: 10,
              }}
            >
              <span>
                <strong>Logged so far:</strong> {loggedHours === null ? "…" : `${loggedHours}h`}
              </span>
              <span>
                <strong>Due:</strong> {selectedTask.current_due_date ? formatDate(selectedTask.current_due_date) : "—"}
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <label style={{ display: "block", marginBottom: 4, flex: 1.3 }}>
              <span style={label}>Log date</span>
              <input type="date" value={date} onChange={(e) => { setDate(e.target.value); clearMessages(); }} style={input} />
            </label>
            <label style={{ display: "block", marginBottom: 4, flex: 1 }}>
              <span style={label}>Start time</span>
              <input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); clearMessages(); }} style={input} />
            </label>
            <label style={{ display: "block", marginBottom: 4, flex: 1 }}>
              <span style={label}>End time</span>
              <input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); clearMessages(); }} style={input} />
            </label>
          </div>
          <div style={{ fontSize: 10.5, color: minutes > 0 ? "var(--muted)" : "var(--danger-text)", marginBottom: 8 }}>
            {minutes > 0 ? `${h > 0 ? `${h}h ` : ""}${m}m` : "The end time must be after the start time, on the same day."}
          </div>

          {mode === "project" && isFollowUp && (
            <>
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={label}>Follow-up reason (required)</span>
                <select value={followUpReason} onChange={(e) => setFollowUpReason(e.target.value as FollowUpReason)} style={input}>
                  <option value="">Choose a reason…</option>
                  {(Object.keys(FOLLOW_UP_REASON_LABEL) as FollowUpReason[]).map((k) => (
                    <option key={k} value={k}>
                      {FOLLOW_UP_REASON_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: 10 }}>
                <span style={label}>What was done{onBehalfOf ? " (required)" : " (optional)"}</span>
                <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Revised copy for temporary shutdown" style={input} />
              </label>
            </>
          )}
          {mode === "project" && !isFollowUp && (
            <>
              <label style={{ display: "block", marginBottom: 8 }}>
                <span style={label}>Reason</span>
                <select value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)} style={input}>
                  {reasons
                    .filter((r) => r.is_active || r.name === reasonCategory)
                    .map((r) => (
                      <option key={r.id} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <label style={{ display: "block", marginBottom: 10 }}>
                <span style={label}>{reasonCategory === "Other" ? "Specify" : "Additional details (optional)"}</span>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={reasonCategory === "Other" ? "What happened?" : undefined}
                  style={input}
                />
              </label>
            </>
          )}
          {mode === "non_project" && (
            <label style={{ display: "block", marginBottom: 10 }}>
              <span style={label}>Notes {activityType?.name === "Others" ? "(required for Others)" : "(optional)"}</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={activityType?.name === "Others" ? "What was this?" : "e.g. Weekly team sync"}
                style={input}
              />
            </label>
          )}

          {error && <div style={{ color: "var(--danger-text)", fontSize: 11.5, marginBottom: 8 }}>{error}</div>}
          {futureBlocked && (
            <div style={banner}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Can't log future time</div>
              <div>Time entries can only cover time that has already passed. Change the end time to now or earlier.</div>
            </div>
          )}
          {overlap && (
            <div style={banner}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Time overlaps another entry</div>
              <div>{onBehalfOf ? `${onBehalfOf} already has` : "You already have"} time logged in this period:</div>
              <div><strong>Log ID:</strong> {timeLogId(overlap.entry_number)}</div>
              <div><strong>Task:</strong> {overlapTaskLabel(overlap)}</div>
              <div><strong>Time:</strong> {clockRange(overlap.started_at, overlap.ended_at)}</div>
              <div><strong>Status:</strong> {STATUS_LABEL[overlap.status] ?? overlap.status}</div>
              <div style={{ marginTop: 6 }}>Change the start or end time.</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={saving} onClick={submit}>
              {saving ? "Logging…" : isFollowUp ? "Log follow-up time" : "Log time"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
