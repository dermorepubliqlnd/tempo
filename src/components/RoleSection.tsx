// 2026-10-08 (Sandra): one Role per person. Shows what the role gives, plus
// plain hints and a suggestion so the right role is easy to pick.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Person } from "../lib/useSession";
import { NAV_PAGES, SYSTEM_VIEW_OPTIONS, loadRoles, roleHints, suggestedRole, type AppRole } from "../lib/navAccess";

interface Props {
  person: Person & { role_id?: string | null };
  isEdit: boolean;
  onChangeRole: (roleId: string) => void;
}

export default function RoleSection({ person, isEdit, onChangeRole }: Props) {
  const [roles, setRoles] = useState<AppRole[] | null>(null);
  const [reports, setReports] = useState(0);
  const [owned, setOwned] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [rs, rep, own] = await Promise.all([
        loadRoles(true),
        supabase.from("people").select("id", { count: "exact", head: true }).eq("reports_to", person.id).eq("is_active", true),
        supabase.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", person.id).eq("is_archived", false).not("status", "in", "(Completed,Cancelled)").neq("wbs_status", "closed"),
      ]);
      if (cancelled) return;
      setRoles(rs);
      setReports(rep.count ?? 0);
      setOwned(own.count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [person.id]);
  if (!roles) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</div>;

  const role = roles.find((r) => r.id === person.role_id) ?? null;
  const hints = roleHints(role, reports, owned);
  const suggestion = suggestedRole(roles, reports, role);
  const pages = role ? NAV_PAGES.filter((p) => role.pages[p.key]).map((p) => p.label.replace(" (sidebar item)", "")) : [];
  const views = role ? SYSTEM_VIEW_OPTIONS.filter((v) => role.system_views.includes(v.id)).length : 0;
  const rights = role
    ? [role.full_access ? "Full Access" : "Standard access", role.can_approve_start ? "Approves Start Project" : null, role.can_approve_close ? "Approves Close Project" : null,
       [role.can_access_user_management && "User Management", role.can_access_reports && "Reports", role.can_access_site_settings && "Site Settings"].filter(Boolean).join(", ") || null].filter(Boolean)
    : [];

  return (
    <div style={{ fontSize: 13 }}>
      {isEdit ? (
        <select value={person.role_id ?? ""} onChange={(e) => e.target.value && onChangeRole(e.target.value)} style={{ fontSize: 13, padding: "6px 8px", minWidth: 220 }}>
          {!role && <option value="">Choose a role…</option>}
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      ) : (
        <strong>{role?.name ?? "No role"}</strong>
      )}
      {role?.description && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>{role.description}</div>}
      {role && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          <li>{rights.join(" · ")}</li>
          <li>Sidebar: My Dashboard, Projects &amp; Tasks, Time Tracking, Approval Center{pages.length ? `, ${pages.join(", ")}` : ""}</li>
          <li>{views} System View{views === 1 ? "" : "s"}</li>
        </ul>
      )}
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
        {reports} direct report{reports === 1 ? "" : "s"} · owns {owned} open project{owned === 1 ? "" : "s"}
      </div>
      {hints.map((h, i) => (
        <div key={i} style={{ fontSize: 12, color: "var(--warning-text, #9a6700)", background: "var(--warning-bg, #fff8e1)", borderRadius: "var(--radius-sm)", padding: "6px 8px", marginTop: 6 }}>{h}</div>
      ))}
      {isEdit && suggestion && suggestion.id !== role?.id && (
        <button onClick={() => onChangeRole(suggestion.id)} style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "var(--accent)", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 10px", cursor: "pointer" }}>
          Suggested: {suggestion.name}. Use it
        </button>
      )}
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>Change what a role includes in Site Settings → Roles &amp; Permissions.</div>
    </div>
  );
}
