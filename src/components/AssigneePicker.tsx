// phase126l (Sandra 2026-10-01): once a project has started, a new task
// must have an Assignee from the moment it's created. This promise-based
// picker is shown before the insert; cancelling aborts the add.
import { useRef, useState } from "react";
import Modal from "./Modal";

interface Option {
  id: string;
  name: string;
}

export function useAssigneePicker(people: Option[]) {
  const [state, setState] = useState<{ title: string; defaultId: string } | null>(null);
  const [sel, setSel] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  function pick(title: string, defaultId?: string | null): Promise<string | null> {
    setSel(defaultId ?? "");
    setState({ title, defaultId: defaultId ?? "" });
    return new Promise((res) => {
      resolver.current = res;
    });
  }
  function finish(v: string | null) {
    resolver.current?.(v);
    resolver.current = null;
    setState(null);
  }

  const element = state ? (
    <Modal title={state.title} onClose={() => finish(null)} width={380}>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: "0 0 10px" }}>
        This project has started, so every new task needs an Assignee. You can change it later, but not remove it.
      </p>
      <select
        autoFocus
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        style={{ width: "100%", fontSize: 13, padding: "7px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 14 }}
      >
        <option value="">Select a team member…</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={() => finish(null)} style={{ padding: "6px 12px", fontSize: 12, border: "1px solid var(--border)", background: "var(--surface)", borderRadius: "var(--radius-btn)", cursor: "pointer" }}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!sel}
          onClick={() => finish(sel)}
          style={{ padding: "6px 12px", fontSize: 12, border: "none", background: sel ? "var(--accent)" : "var(--border)", color: "#fff", borderRadius: "var(--radius-btn)", cursor: sel ? "pointer" : "default", fontWeight: 600 }}
        >
          Add task
        </button>
      </div>
    </Modal>
  ) : null;

  return { pick, element };
}
