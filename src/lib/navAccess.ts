// 2026-10-07 (Sandra, item E): show each role only what it uses.
// Role is AUTO from data unless pinned in User Management:
//   full   = Full Access
//   lead   = someone active reports to them
//   owner  = owns at least one open project (not Completed/Cancelled/closed)
//   member = everyone else
// Each role has defaults for sidebar pages and System Views (built-in below,
// editable in User Management > Role defaults -> app_settings.role_defaults).
// A person can be customised further (people.page_access / people.system_views).
// Hiding a page hides the sidebar item and its route; data permissions are
// unchanged (those stay in the database rules).
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { Person } from "./useSession";

export type NavRole = "member" | "owner" | "lead" | "full";
export const NAV_ROLES: NavRole[] = ["member", "owner", "lead", "full"];
export const NAV_ROLE_LABEL: Record<NavRole, string> = { member: "Member", owner: "Project owner", lead: "Lead", full: "Full Access" };

export type NavPage = "team_dashboard" | "utilization" | "productivity" | "time_off" | "archive" | "knowledge_base" | "feedback";
export const NAV_PAGES: { key: NavPage; label: string; route: string }[] = [
  { key: "team_dashboard", label: "Team Dashboard", route: "/team-dashboard" },
  { key: "utilization", label: "Utilization", route: "/utilization" },
  { key: "productivity", label: "Productivity", route: "/hours-overview" },
  { key: "time_off", label: "Time Off & Holidays", route: "/time-off" },
  { key: "archive", label: "Archive (sidebar item)", route: "/archive" },
  { key: "knowledge_base", label: "Knowledge Base", route: "/knowledge-base" },
  { key: "feedback", label: "Feedback", route: "/feedback" },
];

export const SYSTEM_VIEW_OPTIONS: { id: string; table: "projects" | "tasks"; label: string }[] = [
  { id: "system_my_active_portfolio", table: "projects", label: "My Active Projects" },
  { id: "system_my_full_portfolio", table: "projects", label: "All My Projects" },
  { id: "system_active_project_portfolio", table: "projects", label: "All Active Projects" },
  { id: "system_my_active_projects", table: "projects", label: "Active Projects I Own" },
  { id: "system_all_projects_i_own", table: "projects", label: "All Projects I Own" },
  { id: "system_all_projects", table: "projects", label: "All Projects" },
  { id: "system_tasks_my_open", table: "tasks", label: "My Open Tasks" },
  { id: "system_tasks_my_calendar", table: "tasks", label: "My Task Calendar" },
  { id: "system_tasks_my_done", table: "tasks", label: "My Completed Tasks" },
  { id: "system_tasks_my_by_project", table: "tasks", label: "My Tasks by Project" },
  { id: "system_tasks_owner_open", table: "tasks", label: "Tasks in My Projects" },
  { id: "system_tasks_owner_at_risk", table: "tasks", label: "At-Risk Tasks in My Projects" },
  { id: "system_tasks_org_open", table: "tasks", label: "All Open Tasks" },
  { id: "system_tasks_org_all", table: "tasks", label: "All Tasks" },
];

export type RoleDefaults = Record<NavRole, { pages: Record<NavPage, boolean>; views: string[] }>;

const MEMBER_VIEWS = ["system_my_active_portfolio", "system_my_full_portfolio", "system_active_project_portfolio", "system_tasks_my_open", "system_tasks_my_calendar", "system_tasks_my_done"];
const OWNER_VIEWS = [...MEMBER_VIEWS, "system_my_active_projects", "system_all_projects_i_own", "system_tasks_owner_open", "system_tasks_owner_at_risk"];
const LEAD_VIEWS = [...OWNER_VIEWS, "system_all_projects", "system_tasks_org_open"];
const ALL_VIEWS = SYSTEM_VIEW_OPTIONS.map((v) => v.id);

const MEMBER_PAGES: Record<NavPage, boolean> = { team_dashboard: false, utilization: false, productivity: false, time_off: true, archive: false, knowledge_base: true, feedback: true };
const LEAD_PAGES: Record<NavPage, boolean> = { ...MEMBER_PAGES, team_dashboard: true, utilization: true, productivity: true };
const FULL_PAGES: Record<NavPage, boolean> = { ...LEAD_PAGES, archive: true };

export const BUILTIN_ROLE_DEFAULTS: RoleDefaults = {
  member: { pages: MEMBER_PAGES, views: MEMBER_VIEWS },
  owner: { pages: MEMBER_PAGES, views: OWNER_VIEWS },
  lead: { pages: LEAD_PAGES, views: LEAD_VIEWS },
  full: { pages: FULL_PAGES, views: ALL_VIEWS },
};

export function mergeRoleDefaults(saved: Partial<RoleDefaults> | null | undefined): RoleDefaults {
  const out = JSON.parse(JSON.stringify(BUILTIN_ROLE_DEFAULTS)) as RoleDefaults;
  if (!saved) return out;
  for (const r of NAV_ROLES) {
    const s = saved[r];
    if (!s) continue;
    if (s.pages) out[r].pages = { ...out[r].pages, ...s.pages };
    if (Array.isArray(s.views)) out[r].views = s.views.filter((id) => ALL_VIEWS.includes(id));
  }
  return out;
}

export type NavPerson = Person & {
  nav_role?: NavRole | null;
  page_access?: Partial<Record<NavPage, boolean>> | null;
  system_views?: string[] | null;
};

export function deriveRole(p: NavPerson, hasReports: boolean, ownsOpenProject: boolean): NavRole {
  if (p.access_level === "full") return "full";
  if (hasReports) return "lead";
  if (ownsOpenProject) return "owner";
  return "member";
}

export interface NavAccess {
  loaded: boolean;
  autoRole: NavRole;
  role: NavRole;
  pages: Record<NavPage, boolean>;
  views: Set<string>;
  customizedPages: boolean;
  customizedViews: boolean;
}

export function computeAccess(p: NavPerson, autoRole: NavRole, defaults: RoleDefaults): Omit<NavAccess, "loaded"> {
  const role = (p.nav_role as NavRole | null) ?? autoRole;
  const d = defaults[role];
  const pages = { ...d.pages };
  // phase132's explicit Team Dashboard switch-off still counts as a customisation.
  if (p.can_view_team_dashboard === false) pages.team_dashboard = false;
  const overrides = p.page_access ?? {};
  for (const k of Object.keys(overrides) as NavPage[]) {
    if (typeof overrides[k] === "boolean") pages[k] = overrides[k] as boolean;
  }
  const views = new Set(Array.isArray(p.system_views) ? p.system_views : d.views);
  return {
    autoRole,
    role,
    pages,
    views,
    customizedPages: !!p.page_access && Object.keys(p.page_access).length > 0,
    customizedViews: Array.isArray(p.system_views),
  };
}

let defaultsCache: RoleDefaults | null = null;
export async function loadRoleDefaults(force = false): Promise<RoleDefaults> {
  if (defaultsCache && !force) return defaultsCache;
  const { data, error } = await supabase.from("app_settings").select("role_defaults").limit(1).maybeSingle();
  defaultsCache = mergeRoleDefaults(error ? null : ((data as { role_defaults?: Partial<RoleDefaults> } | null)?.role_defaults ?? null));
  return defaultsCache;
}

export async function loadAutoRole(p: NavPerson): Promise<NavRole> {
  if (p.access_level === "full") return "full";
  const [reports, owned] = await Promise.all([
    supabase.from("people").select("id", { count: "exact", head: true }).eq("reports_to", p.id).eq("is_active", true),
    supabase.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", p.id).not("status", "in", "(Completed,Cancelled)").neq("wbs_status", "closed").eq("is_archived", false),
  ]);
  return deriveRole(p, (reports.count ?? 0) > 0, (owned.count ?? 0) > 0);
}

const accessCache = new Map<string, NavAccess>();
export function useNavAccess(p: Person | null | undefined): NavAccess {
  const key = p ? `${p.id}:${JSON.stringify([(p as NavPerson).nav_role, (p as NavPerson).page_access, (p as NavPerson).system_views, p.access_level, p.can_view_team_dashboard])}` : "";
  const fallback: NavAccess = { loaded: false, autoRole: "member", role: "member", pages: FULL_PAGES, views: new Set(ALL_VIEWS), customizedPages: false, customizedViews: false };
  const [acc, setAcc] = useState<NavAccess>(() => accessCache.get(key) ?? fallback);
  useEffect(() => {
    if (!p) return;
    const cached = accessCache.get(key);
    if (cached) { setAcc(cached); return; }
    let cancelled = false;
    (async () => {
      const [defaults, autoRole] = await Promise.all([loadRoleDefaults(), loadAutoRole(p as NavPerson)]);
      const next: NavAccess = { loaded: true, ...computeAccess(p as NavPerson, autoRole, defaults) };
      accessCache.set(key, next);
      if (!cancelled) setAcc(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return acc;
}
