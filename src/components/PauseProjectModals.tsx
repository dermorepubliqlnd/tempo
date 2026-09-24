import { useState, type CSSProperties } from "react";
import { AlertTriangle, PauseCircle } from "lucide-react";
import Modal from "./Modal";
import { PAUSE_CATEGORIES, pauseProject, resolveScheduleReview, pausedDays, type PauseProjectInfo } from "../lib/pause";
import { formatDate } from "../lib/formatDate";
import { toISO } from "../lib/workingDays";

const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.3 };
const input: CSSProperties = { fontSize: 12.5, padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--navy)", background: "var(--surface)", boxSizing: "border-box" };
const primaryBtn: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "8px 14px", cursor: "pointer" };
const ghostBtn: CSSProperties = { fontSize: 12, color: "var(--text-secondary)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 14px", cursor: "pointer" };

// phase118: pausing always goes through this dialog (the DB refuses a pause
// without a reason). One dialog for one or many projects (bulk).
export function PauseProjectModal({
  projects,
  onClose,
  onDone,
}: {
  projects: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState("");
  const [resume, setResume] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError("A pause reason is required.");
      return;
    }
    if (resume && resume < toISO(new Date())) {
      setError("Expected resume date can't be in the past.");
      return;
    }
    setSaving(true);
    const failures: string[] = [];
    for (const p of projects) {
      const { error: err } = await pauseProject(p.id, reason.trim(), category || null, resume || null, note.trim() || null);
      if (err) failures.push(`${p.name}: ${err.message}`);
    }
    setSaving(false);
    if (failures.length) {
      setError(`Couldn't pause:\n${failures.join("\n")}`);
      return;
    }
    onDone();
  }

  return (
    <Modal title={projects.length === 1 ? "Pause project" : `Pause ${projects.length} projects`} onClose={onClose} width={480}>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 0 }}>
        {projects.length === 1 ? <strong>{projects[0].name}</strong> : `${projects.length} selected projects`} will stop being monitored for overdue work while
        paused. Dates and the baseline stay as they are. Time can't be logged on a paused project.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <span style={label}>Pause reason (required)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Temporarily deprioritized to support a higher-priority project" style={{ ...input, width: "100%", resize: "vertical" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <span style={label}>Category (optional)</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...input, width: "100%" }}>
              <option value="">—</option>
              {PAUSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span style={label}>Expected resume (optional)</span>
            <input type="date" value={resume} onChange={(e) => setResume(e.target.value)} style={{ ...input, width: "100%" }} />
          </div>
        </div>
        <div>
          <span style={label}>Additional note (optional)</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, width: "100%" }} />
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>The date, time and your name are recorded automatically and added to the project's Notes.</p>
        {error && <div style={{ fontSize: 12, color: "var(--danger-text)", whiteSpace: "pre-wrap" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button onClick={submit} disabled={saving} style={{ ...primaryBtn, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <PauseCircle size={13} /> {saving ? "Pausing…" : "Pause project"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Shown right after a project moves from Paused back to an active status,
// and reused by the WBS banner's "Resolve" flow.
export function ScheduleReviewModal({
  project,
  justResumed,
  onClose,
  onReviewWbs,
  onResolved,
}: {
  project: PauseProjectInfo & { id: string; name: string };
  justResumed: boolean;
  onClose: () => void;
  onReviewWbs?: () => void;
  onResolved: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = pausedDays(project);

  async function resolve(outcome: "no_change" | "schedule_updated") {
    setSaving(true);
    const { error: err } = await resolveScheduleReview(project.id, outcome, note.trim() || null);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onResolved();
  }

  return (
    <Modal title={justResumed ? "Project resumed" : "Schedule review"} onClose={onClose} width={500}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "var(--warning-bg)", border: "1px solid #f3dfb8", borderRadius: "var(--radius-md)", padding: "10px 12px", marginBottom: 12 }}>
        <AlertTriangle size={16} style={{ color: "var(--warning-text)", flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: "var(--navy)", lineHeight: 1.5 }}>
          <strong>{project.name}</strong> was paused for {days} day{days === 1 ? "" : "s"}
          {project.paused_at ? ` (from ${formatDate(toISO(new Date(project.paused_at)))})` : ""}. Review the WBS and confirm whether the timeline needs to change.
        </div>
      </div>
      <ul style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.6 }}>
        <li>
          <strong>Dates need to change:</strong> request new dates through extension requests (task due dates, or a Project Timeline Extension), then
          mark the schedule as updated.
        </li>
        <li>
          <strong>Dates still work:</strong> confirm no schedule change is needed.
        </li>
        <li>Until you confirm, dates that passed during the pause show as "Review pending" and time can't be logged on this project.</li>
      </ul>
      <span style={label}>Note (optional)</span>
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...input, width: "100%", marginBottom: 12 }} />
      {error && <div style={{ fontSize: 12, color: "var(--danger-text)", marginBottom: 10 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {onReviewWbs && (
          <button onClick={onReviewWbs} style={ghostBtn}>
            Review WBS
          </button>
        )}
        <button onClick={() => resolve("schedule_updated")} disabled={saving} style={ghostBtn}>
          Schedule updated
        </button>
        <button onClick={() => resolve("no_change")} disabled={saving} style={primaryBtn}>
          No schedule change needed
        </button>
      </div>
    </Modal>
  );
}

// WBS page banner: Paused details, or the pending Schedule Review with the
// button that resolves it.
export function PauseReviewBanner({
  project,
  canResolve,
  onResolved,
}: {
  project: PauseProjectInfo & { id: string; name: string; pause_reason?: string | null; pause_expected_resume?: string | null };
  canResolve: boolean;
  onResolved: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (project.status === "Paused") {
    return (
      <div className="card" style={{ padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#f3ecfa", borderColor: "#e2d3f0" }}>
        <PauseCircle size={15} style={{ color: "#7b4fb0", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#7b4fb0" }}>
          Paused{project.paused_at ? ` since ${formatDate(toISO(new Date(project.paused_at)))}` : ""}
        </span>
        {project.pause_reason && <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Reason: {project.pause_reason}</span>}
        {project.pause_expected_resume && <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Expected resume: {formatDate(project.pause_expected_resume)}</span>}
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Overdue monitoring and time logging are suspended. Dates and baseline are unchanged.</span>
      </div>
    );
  }
  if (!project.schedule_review_required) return null;
  const days = pausedDays(project);
  return (
    <>
      <div className="card" style={{ padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "var(--warning-bg)", borderColor: "#f3dfb8" }}>
        <AlertTriangle size={15} style={{ color: "var(--warning-text)", flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--warning-text)" }}>Schedule Review Required</span>
        <span style={{ fontSize: 11.5, color: "var(--text-secondary)", flex: "1 1 300px" }}>
          Resumed after {days} day{days === 1 ? "" : "s"} on pause. Check the dates below; request extensions for any task that needs a new date. Time
          logging restarts once the review is confirmed.
        </span>
        {canResolve && (
          <button
            onClick={() => setOpen(true)}
            style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", borderRadius: "var(--radius-sm)", padding: "6px 12px", cursor: "pointer" }}
          >
            Confirm schedule review
          </button>
        )}
      </div>
      {open && (
        <ScheduleReviewModal
          project={project}
          justResumed={false}
          onClose={() => setOpen(false)}
          onResolved={() => {
            setOpen(false);
            onResolved();
          }}
        />
      )}
    </>
  );
}
