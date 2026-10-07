// 2026-10-07 (Sandra, item E): edit what each role sees by default.
// Saved to app_settings.role_defaults (Full Access only).
import { useEffect, useState } from "react";
import Modal from "./Modal";
import { supabase } from "../lib/supabaseClient";
import {
  BUILTIN_ROLE_DEFAULTS, NAV_PAGES, NAV_ROLES, NAV_ROLE_LABEL, SYSTEM_VIEW_OPTIONS, loadRoleDefaults, type RoleDefaults,
} from "../lib/navAccess";

export default function RoleDefaultsModal({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<RoleDefaults | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadRoleDefaults(true).then(setD); }, []);

  async function save() {
    if (!d) return;
    setSaving(true);
    const { error: err } = await supabase.from("app_settings").update({ role_defaults: d }).eq("id", true);
    setSaving(false);
    if (err) { setError("Couldn't save the role defaults. Please try again."); return; }
    await loadRoleDefaults(true);
    onClose();
    window.location.reload();
  }

  const th = { fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, padding: "6px 8px", textAlign: "center" as const };
  const td = { fontSize: 12.5, padding: "5px 8px" };
  return (
    <Modal title="Role defaults: what each role sees" onClose={onClose} width={640}>
      {!d ? <div style={{ fontSize: 12 }}>Loading…</div> : (
        <>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 0 }}>
            Ticks apply to everyone with that role unless their own settings are customized in User Management.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr><th style={{ ...th, textAlign: "left" }}>Sidebar page</th>{NAV_ROLES.map((r) => <th key={r} style={th}>{NAV_ROLE_LABEL[r]}</th>)}</tr>
            </thead>
            <tbody>
              {NAV_PAGES.map((pg) => (
                <tr key={pg.key} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}>{pg.label}</td>
                  {NAV_ROLES.map((r) => (
                    <td key={r} style={{ ...td, textAlign: "center" }}>
                      <input type="checkbox" checked={d[r].pages[pg.key]} onChange={(e) => setD({ ...d, [r]: { ...d[r], pages: { ...d[r].pages, [pg.key]: e.target.checked } } })} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr><th style={{ ...th, textAlign: "left", paddingTop: 14 }}>System View</th>{NAV_ROLES.map((r) => <th key={r} style={{ ...th, paddingTop: 14 }}>{NAV_ROLE_LABEL[r]}</th>)}</tr>
              {SYSTEM_VIEW_OPTIONS.map((v) => (
                <tr key={v.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}>{v.table === "projects" ? "Projects · " : "Tasks · "}{v.label}</td>
                  {NAV_ROLES.map((r) => (
                    <td key={r} style={{ ...td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={d[r].views.includes(v.id)}
                        onChange={(e) => setD({ ...d, [r]: { ...d[r], views: e.target.checked ? [...d[r].views, v.id] : d[r].views.filter((x) => x !== v.id) } })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {error && <div style={{ color: "var(--danger-text)", fontSize: 12, marginTop: 8 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button onClick={() => setD(JSON.parse(JSON.stringify(BUILTIN_ROLE_DEFAULTS)))} style={{ fontSize: 12, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Restore Tempo's defaults</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ fontSize: 12.5, padding: "6px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface)", cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ fontSize: 12.5, fontWeight: 600, padding: "6px 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "#fff", cursor: "pointer" }}>{saving ? "Saving…" : "Save role defaults"}</button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
