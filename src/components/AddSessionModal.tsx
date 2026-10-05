import { useMemo, useState, type CSSProperties } from "react";
import Modal from "./Modal";
import { supabase } from "../lib/supabaseClient";
import { toISO } from "../lib/workingDays";

// phase149 (Sandra 2026-10-05): trainers plot their own sessions into an
// operational project (e.g. "Training Delivery - Q4 2026") after it has been
// started. Each session is its own task (Work Type Training Delivery, Output
// Type Session, count 1) -- trainers then log time on it as usual (timer or
// Add Time) and mark it Done for validation.

export interface SessionProjectOption {
  id: string;
  name: string;
  project_number: number;
  owner_id: string | null;
  wbs_status: string;
}

interface Props {
  projects: SessionProjectOption[];
  people: { id: string; name: string }[];
  meId: string;
  isFullAccess: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const labelStyle: CSSProperties = { fontSize: 11, fontWeight: 600, marginBottom: 4, color: "var(--navy)" };
const fieldStyle: CSSProperties = {
  width: "100%",
  fontSize: 12.5,
  padding: "6px 8px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  boxSizing: "border-box",
};

export default function AddSessionModal({ projects, people, meId, isFullAccess, onClose, onSaved }: Props) {
  // Newest project first (highest P-number) -- usually the current quarter.
  const sorted = useMemo(() => [...projects].sort((a, b) => b.project_number - a.project_number), [projects]);
  const [projectId, setProjectId] = useState(sorted[0]?.id ?? "");
  const [name, setName] = useState("");
  const today = toISO(new Date());
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [hours, setHours] = useState("2");
  const [assigneeId, setAssigneeId] = useState(meId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  const project = sorted.find((p) => p.id === projectId);
  const canPickAssignee = isFullAccess || project?.owner_id === meId;
  const hoursNum = Number(hours);
  const valid =
    !!projectId &&
    name.trim().length > 0 &&
    !!startDate &&
    !!endDate &&
    endDate >= startDate &&
    hoursNum > 0 &&
    hoursNum <= 12;

  async function save(addAnother: boolean) {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("add_session_task_range", {
      p_project_id: projectId,
      p_name: name.trim(),
      p_start_date: startDate,
      p_end_date: endDate,
      p_hours: hoursNum,
      p_assignee: canPickAssignee ? assigneeId : meId,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onSaved();
    if (addAnother) {
      setAddedCount((n) => n + 1);
      setName("");
      return;
    }
    onClose();
  }

  return (
    <Modal title="Add Session" onClose={onClose} width={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
          Each session is its own task. Log your time on it as usual (timer or Add Time), then mark it Done for validation.
        </div>
        {sorted.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--danger-text)" }}>
            No open operational project you can add sessions to. Ask the project owner to start this quarter's Training Delivery project.
          </div>
        ) : (
          <>
            <div>
              <div style={labelStyle}>Project</div>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={fieldStyle}>
                {sorted.map((p) => (
                  <option key={p.id} value={p.id}>
                    P-{String(p.project_number).padStart(4, "0")} · {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={labelStyle}>Session</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. GMP Refresher – Production Batch 3"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                style={fieldStyle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save(false);
                }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 10 }}>
              <div>
                <div style={labelStyle}>Session Start Date</div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartDate(next);
                    if (!endDate || endDate < next) setEndDate(next);
                  }}
                  style={fieldStyle}
                />
              </div>
              <div>
                <div style={labelStyle}>Session End Date</div>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div>
                <div style={labelStyle}>Scoped hours</div>
                <input type="number" min={0.25} max={12} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} style={fieldStyle} />
              </div>
            </div>
            {startDate && endDate && endDate < startDate && (
              <div style={{ fontSize: 11, color: "var(--danger-text)" }}>
                Session End Date cannot be earlier than Session Start Date.
              </div>
            )}
            {canPickAssignee && (
              <div>
                <div style={labelStyle}>Trainer</div>
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={fieldStyle}>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === meId ? " (me)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
        {error && <div style={{ fontSize: 11.5, color: "var(--danger-text)" }}>{error}</div>}
        {addedCount > 0 && !error && (
          <div style={{ fontSize: 11.5, color: "var(--success-text)" }}>
            {addedCount} session{addedCount === 1 ? "" : "s"} added. Add the next one or close.
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
          <button
            onClick={onClose}
            style={{ fontSize: 12, padding: "6px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "none", cursor: "pointer", color: "var(--text)" }}
          >
            {addedCount > 0 ? "Done" : "Cancel"}
          </button>
          <button
            onClick={() => save(true)}
            disabled={busy || !valid}
            style={{ fontSize: 12, padding: "6px 12px", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", background: "none", color: "var(--accent)", cursor: busy || !valid ? "default" : "pointer", opacity: busy || !valid ? 0.55 : 1 }}
          >
            Save &amp; add another
          </button>
          <button
            onClick={() => save(false)}
            disabled={busy || !valid}
            style={{ fontSize: 12, padding: "6px 14px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "#fff", cursor: busy || !valid ? "default" : "pointer", opacity: busy || !valid ? 0.55 : 1 }}
          >
            {busy ? "Saving…" : "Add session"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
