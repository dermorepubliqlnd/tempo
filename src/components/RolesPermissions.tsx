// 2026-10-08 (Sandra): Site Settings > Roles & Permissions. Create roles and
// tick what each one can do; people get ONE role in User Management.
// Saving a role updates everyone who has it (phase174 trigger).
import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useConfirm } from "../lib/useConfirm";
import { friendlyError } from "../lib/prompts";
import { NAV_PAGES, SYSTEM_VIEW_OPTIONS, clearRolesCache, loadRoles, type AppRole } from "../lib/navAccess";

type BoolKey = "full_access" | "can_approve_start" | "can_approve_close" | "can_access_user_management" | "can_access_reports" | "can_access_site_settings";
type Row =
  | { kind: "bool"; key: BoolKey; label: string; hint?: string }
  | { kind: "page"; key: string; label: string }
  | { kind: "view"; key: string; label: string };

const GROUPS: { title: string; rows: Row[] }[] = [
  { title: "Access", rows: [{ kind: "bool", key: "full_access", label: "Full Access", hint: "Sees and edits everything in Tempo" }] },
  { title: "Approvals", rows: [
    { kind: "bool", key: "can_approve_start", label: "Can approve Start Project" },
    { kind: "bool", key: "can_approve_close", label: "Can approve Close Project" },
  ] },
  { title: "Admin pages", rows: [
    { kind: "bool", key: "can_access_user_management", label: "User Management" },
    { kind: "bool", key: "can_access_reports", label: "Reports" },
    { kind: "bool", key: "can_access_site_settings", label: "Site Settings" },
  ] },
  { title: "Sidebar pages", rows: NAV_PAGES.map((p) => ({ kind: "page" as const, key: p.key, label: p.label })) },
  { title: "Projects System Views", rows: SYSTEM_VIEW_OPTIONS.filter((v) => v.table === "projects").map((v) => ({ kind: "view" as const, key: v.id, label: v.label })) },
  { title: "Tasks System Views", rows: SYSTEM_VIEW_OPTIONS.filter((v) => v.table === "tasks").map((v) => ({ kind: "view" as const, key: v.id, label: v.label })) },
];

export default function RolesPermissions({ meRoleId }: { meRoleId: string | null }) {
  const { confirm, alert, dialog } = useConfirm();
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");

  async function load() {
    const rs = await loadRoles(true);
    setRoles(rs);
    const { data } = await supabase.from("people").select("role_id").eq("is_active", true);
    const c: Record<string, number> = {};
    ((data as { role_id: string | null }[]) ?? []).forEach((p) => { if (p.role_id) c[p.role_id] = (c[p.role_id] ?? 0) + 1; });
    setCounts(c);
  }
  useEffect(() => { load(); }, []);

  async function save(role: AppRole, patch: Partial<AppRole>) {
    setRoles((prev) => prev.map((r) => (r.id === role.id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("app_roles").update(patch).eq("id", role.id);
    if (error) { await alert(friendlyError("save this role", error)); load(); return; }
    clearRolesCache();
  }

  function valueOf(role: AppRole, row: Row): boolean {
    if (row.kind === "bool") return role[row.key];
    if (row.kind === "page") return !!role.pages?.[row.key as keyof AppRole["pages"]];
    return role.system_views.includes(row.key);
  }

  async function toggle(role: AppRole, row: Row, value: boolean) {
    if (role.id === meRoleId && !value && (row.key === "can_access_user_management" || row.key === "can_access_site_settings" || row.key === "full_access")) {
      const ok = await confirm({ title: "Remove this from your own role?", message: "You have this role, so you'd lose access to this page right away.", confirmLabel: "Remove it", danger: true });
      if (!ok) return;
    }
    if ((counts[role.id] ?? 0) > 0 && (row.key === "full_access" || row.kind === "bool")) {
      const ok = await confirm({ title: `Change "${role.name}"?`, message: `This changes access for the ${counts[role.id]} people with this role right away.`, confirmLabel: "Change role" });
      if (!ok) return;
    }
    if (row.kind === "bool") return save(role, { [row.key]: value } as Partial<AppRole>);
    if (row.kind === "page") return save(role, { pages: { ...role.pages, [row.key]: value } });
    const views = value ? [...role.system_views, row.key] : role.system_views.filter((v) => v !== row.key);
    return save(role, { system_views: SYSTEM_VIEW_OPTIONS.map((v) => v.id).filter((id) => views.includes(id)) });
  }

  async function addRole() {
    const name = newName.trim();
    if (!name) return;
    const src = roles.find((r) => r.id === copyFrom);
    const base = src
      ? { full_access: src.full_access, can_approve_start: src.can_approve_start, can_approve_close: src.can_approve_close, can_access_user_management: src.can_access_user_management, can_access_reports: src.can_access_reports, can_access_site_settings: src.can_access_site_settings, pages: src.pages, system_views: src.system_views }
      : {};
    const { error } = await supabase.from("app_roles").insert({ name, description: src ? `Based on ${src.name}.` : null, sort_order: roles.length + 1, ...base });
    if (error) { await alert(friendlyError("add the role", error)); return; }
    setNewName(""); setCopyFrom("");
    clearRolesCache(); load();
  }

  async function removeRole(role: AppRole) {
    if ((counts[role.id] ?? 0) > 0) {
      await alert({ title: "Role still in use", message: `${counts[role.id]} people have "${role.name}". Give them another role in User Management first.` });
      return;
    }
    const ok = await confirm({ title: `Delete "${role.name}"?`, message: "Nobody has this role, so nothing else changes.", confirmLabel: "Delete role", danger: true });
    if (!ok) return;
    const { error } = await supabase.from("app_roles").delete().eq("id", role.id);
    if (error) { await alert(friendlyError("delete the role", error)); return; }
    clearRolesCache(); load();
  }

  const cell: CSSProperties = { padding: "6px 8px", textAlign: "center", borderTop: "1px solid var(--border)" };
  const input: CSSProperties = { fontSize: 12, padding: "5px 8px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Roles &amp; Permissions</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
          Tick what each role can do. Give each person one role in User Management. Changes apply to everyone with that role right away.
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px", minWidth: 220 }}></th>
              {roles.map((r) => (
                <th key={r.id} style={{ padding: "6px 8px", minWidth: 130, verticalAlign: "bottom" }}>
                  <input
                    defaultValue={r.name}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) save(r, { name: v }); }}
                    style={{ ...input, fontWeight: 700, width: 120, textAlign: "center" }}
                    title="Rename"
                  />
                  <div style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 400, marginTop: 3 }}>
                    {counts[r.id] ?? 0} {(counts[r.id] ?? 0) === 1 ? "person" : "people"}
                    <button onClick={() => removeRole(r)} title="Delete role" style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", verticalAlign: "middle" }}><Trash2 size={11} /></button>
                  </div>
                </th>
              ))}
            </tr>
            <tr>
              <td style={{ padding: "4px 8px", fontSize: 11, color: "var(--muted)" }}>What this role is for</td>
              {roles.map((r) => (
                <td key={r.id} style={{ padding: "4px 8px" }}>
                  <textarea
                    defaultValue={r.description ?? ""}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (r.description ?? "")) save(r, { description: v || null }); }}
                    rows={3}
                    style={{ ...input, width: 130, fontSize: 11, resize: "vertical" }}
                  />
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <Fragment key={g.title}>
                <tr>
                  <td colSpan={roles.length + 1} style={{ padding: "12px 8px 4px", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>{g.title}</td>
                </tr>
                {g.rows.map((row) => (
                  <tr key={row.key}>
                    <td style={{ ...cell, textAlign: "left" }} title={row.kind === "bool" ? row.hint : undefined}>{row.label}</td>
                    {roles.map((r) => (
                      <td key={r.id} style={cell}>
                        <input type="checkbox" checked={valueOf(r, row)} onChange={(e) => toggle(r, row, e.target.checked)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New role name, e.g. Trainer" style={{ ...input, width: 200 }} />
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={input}>
          <option value="">Start empty</option>
          {roles.map((r) => <option key={r.id} value={r.id}>Copy from {r.name}</option>)}
        </select>
        <button onClick={addRole} disabled={!newName.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, padding: "6px 10px", border: "none", borderRadius: "var(--radius-sm)", background: newName.trim() ? "var(--accent)" : "var(--border)", color: "#fff", cursor: newName.trim() ? "pointer" : "default" }}>
          <Plus size={13} /> Add role
        </button>
      </div>
      {dialog}
    </div>
  );
}
