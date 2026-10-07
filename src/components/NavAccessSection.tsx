// 2026-10-07 (Sandra, item E): per-person role + sidebar pages + System Views
// in User Management. Defaults come from the role (Auto unless pinned);
// any tick that differs from the role is saved as this person's override.
import { useEffect, useState } from "react";
import type { Person } from "../lib/useSession";
import {
  NAV_PAGES, NAV_ROLES, NAV_ROLE_LABEL, SYSTEM_VIEW_OPTIONS, computeAccess, loadAutoRole, loadRoleDefaults,
  type NavPage, type NavPerson, type NavRole, type RoleDefaults,
} from "../lib/navAccess";

interface Props {
  person: Person;
  isEdit: boolean;
  onUpdate: (patch: { nav_role?: NavRole | null; page_access?: Partial<Record<NavPage, boolean>> | null; system_views?: string[] | null }) => void;
}

export default function NavAccessSection({ person, isEdit, onUpdate }: Props) {
  const p = person as NavPerson;
  const [defaults, setDefaults] = useState<RoleDefaults | null>(null);
  const [autoRole, setAutoRole] = useState<NavRole | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadRoleDefaults(), loadAutoRole(p)]).then(([d, r]) => {
      if (!cancelled) { setDefaults(d); setAutoRole(r); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id, person.access_level]);
  if (!defaults || !autoRole) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>;

  const acc = computeAccess(p, autoRole, defaults);
  const roleDefaults = defaults[acc.role];
  const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: 0.3, margin: "10px 0 4px" };
  const row = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: isEdit ? "pointer" : "default" } as const;

  function setPage(key: NavPage, value: boolean) {
    const next = { ...(p.page_access ?? {}) } as Partial<Record<NavPage, boolean>>;
    if (roleDefaults.pages[key] === value && !(key === "team_dashboard" && p.can_view_team_dashboard === false)) delete next[key];
    else next[key] = value;
    onUpdate({ page_access: Object.keys(next).length ? next : null });
  }
  function setView(id: string, value: boolean) {
    const current = new Set(acc.views);
    if (value) current.add(id); else current.delete(id);
    const list = SYSTEM_VIEW_OPTIONS.map((v) => v.id).filter((x) => current.has(x));
    const same = list.length === roleDefaults.views.length && list.every((x) => roleDefaults.views.includes(x));
    onUpdate({ system_views: same ? null : list });
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>Role</span>
        {isEdit ? (
          <select
            value={p.nav_role ?? ""}
            onChange={(e) => onUpdate({ nav_role: (e.target.value || null) as NavRole | null })}
            style={{ fontSize: 12.5, padding: "4px 6px" }}
          >
            <option value="">Auto ({NAV_ROLE_LABEL[autoRole]})</option>
            {NAV_ROLES.map((r) => <option key={r} value={r}>{NAV_ROLE_LABEL[r]}</option>)}
          </select>
        ) : (
          <strong style={{ fontSize: 13 }}>{NAV_ROLE_LABEL[acc.role]}{p.nav_role ? "" : " (auto)"}</strong>
        )}
        {(acc.customizedPages || acc.customizedViews) && (
          <>
            <span className="status-pill gold" style={{ fontSize: 10 }}>Customized</span>
            {isEdit && (
              <button
                onClick={() => onUpdate({ page_access: null, system_views: null })}
                style={{ fontSize: 11.5, color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
              >
                Reset to role defaults
              </button>
            )}
          </>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
        Auto: Full Access → Full Access; has someone reporting to them → Lead; owns an open project → Project owner; else Member.
      </div>

      <div style={lbl}>Sidebar pages</div>
      {NAV_PAGES.map((pg) => (
        <label key={pg.key} style={row}>
          <input type="checkbox" disabled={!isEdit} checked={acc.pages[pg.key]} onChange={(e) => setPage(pg.key, e.target.checked)} />
          {pg.label}
          {roleDefaults.pages[pg.key] !== acc.pages[pg.key] && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>(changed)</span>}
        </label>
      ))}
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>My Dashboard, Projects &amp; Tasks, Time Tracking and Approval Center are always shown.</div>

      {(["projects", "tasks"] as const).map((table) => (
        <div key={table}>
          <div style={lbl}>{table === "projects" ? "Projects System Views" : "Tasks System Views"}</div>
          {SYSTEM_VIEW_OPTIONS.filter((v) => v.table === table).map((v) => (
            <label key={v.id} style={row}>
              <input type="checkbox" disabled={!isEdit} checked={acc.views.has(v.id)} onChange={(e) => setView(v.id, e.target.checked)} />
              {v.label}
              {roleDefaults.views.includes(v.id) !== acc.views.has(v.id) && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>(changed)</span>}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
