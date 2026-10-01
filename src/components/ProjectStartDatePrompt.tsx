// phase127f (Sandra 2026-10-01: "always ask for a project start date before
// adding new tasks"). Promise-based prompt, same shape as AssigneePicker:
// if the project already has a Start date it resolves immediately; if not,
// it asks for one, saves it to projects.start_date, and resolves with it.
// Cancelling aborts the add. Task Start dates anchor to this date, so a
// project without one would otherwise silently anchor every task to today.
import { useRef, useState } from "react";
import Modal from "./Modal";
import { supabase } from "../lib/supabaseClient";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useProjectStartDatePrompt() {
  const [state, setState] = useState<{ projectId: string; projectName: string } | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);

  function ensure(project: { id: string; name?: string | null; start_date: string | null } | null | undefined): Promise<string | null> {
    if (!project) return Promise.resolve(null);
    if (project.start_date) return Promise.resolve(project.start_date.slice(0, 10));
    setValue(todayIso());
    setError(null);
    setState({ projectId: project.id, projectName: project.name ?? "this project" });
    return new Promise((res) => {
      resolver.current = res;
    });
  }
  function finish(v: string | null) {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
    setSaving(false);
  }
  async function confirmDate() {
    if (!state || !value) return;
    setSaving(true);
    const { error: err } = await supabase.from("projects").update({ start_date: value }).eq("id", state.projectId);
    if (err) {
      setSaving(false);
      setError(`Couldn't save the Start date: ${err.message}`);
      return;
    }
    finish(value);
  }

  const element = state ? (
    <Modal title="Set the project Start date first" onClose={() => finish(null)} width={400}>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px", lineHeight: 1.45 }}>
        <strong>{state.projectName}</strong> has no Start date yet. Task dates are planned from it, so set it before adding tasks.
      </p>
      <input
        type="date"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: "100%", fontSize: 13, padding: "7px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: error ? 8 : 14, boxSizing: "border-box" }}
      />
      {error && <div style={{ fontSize: 11.5, color: "var(--danger, #c0392b)", marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={() => finish(null)} style={{ padding: "6px 12px", fontSize: 12, border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "var(--radius-btn)", cursor: "pointer" }}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!value || saving}
          onClick={confirmDate}
          style={{ padding: "6px 12px", fontSize: 12, border: "none", background: value && !saving ? "var(--accent)" : "var(--border)", color: "#fff", borderRadius: "var(--radius-btn)", cursor: value && !saving ? "pointer" : "default", fontWeight: 600 }}
        >
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </Modal>
  ) : null;

  return { ensure, element };
}
