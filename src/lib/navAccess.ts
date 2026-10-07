// 2026-10-08 (Sandra): Roles & Permissions. Each person has ONE role
// (people.role_id -> app_roles), picked in User Management; roles are edited
// in Site Settings > Roles & Permissions. No automatic roles, no per-person
// exceptions. The role decides sidebar pages and System Views here; the
// database copies its access level / approval rights / admin pages onto the
// person (phase174) so every existing rule keeps working.
// Hiding a page hides the sidebar item and its route; data permissions stay
// in the database rules.
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import type { Person } from "./useSession";

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

export interface AppRole {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  full_access: boolean;
  can_approve_start: boolean;
  can_approve_close: boolean;
  can_access_user_management: boolean;
  can_access_reports: boolean;
  can_access_site_settings: boolean;
  pages: Partial<Record<NavPage, boolean>>;
  system_views: string[];
}

const FALLBACK_PAGES: Record<NavPage, boolean> = { team_dashboard: false, utilization: false, productivity: false, time_off: true, archive: false, knowledge_base: true, feedback: true };
const FALLBACK_VIEWS = ["system_my_active_portfolio", "system_my_full_portfolio", "system_active_project_portfolio", "system_tasks_my_open", "system_tasks_my_calendar", "system_tasks_my_done"];
const ALL_PAGES: Record<NavPage, boolean> = { team_dashboard: true, utilization: true, productivity: true, time_off: true, archive: true, knowledge_base: true, feedback: true };

let rolesCache: AppRole[] | null = null;
export async function loadRoles(force = false): Promise<AppRole[]> {
  if (rolesCache && !force) return rolesCache;
  const { data, error } = await supabase.from("app_roles").select("*").order("sort_order").order("name");
  rolesCache = error ? [] : ((data as AppRole[]) ?? []);
  return rolesCache;
}
export function clearRolesCache() { rolesCache = null; accessCache.clear(); }

export interface NavAccess {
  loaded: boolean;
  role: AppRole | null;
  pages: Record<NavPage, boolean>;
  views: Set<string>;
}

export function accessForRole(role: AppRole | null): Omit<NavAccess, "loaded"> {
  if (!role) return { role: null, pages: FALLBACK_PAGES, views: new Set(FALLBACK_VIEWS) };
  return {
    role,
    pages: { ...FALLBACK_PAGES, ...Object.fromEntries(Object.entries(role.pages ?? {}).filter(([, v]) => typeof v === "boolean")) } as Record<NavPage, boolean>,
    views: new Set(Array.isArray(role.system_views) ? role.system_views : FALLBACK_VIEWS),
  };
}

type PersonWithRole = Person & { role_id?: string | null };

const accessCache = new Map<string, NavAccess>();
export function useNavAccess(p: Person | null | undefined): NavAccess {
  const roleId = (p as PersonWithRole | null | undefined)?.role_id ?? "";
  const key = p ? `${p.id}:${roleId}` : "";
  const fallback: NavAccess = { loaded: false, role: null, pages: ALL_PAGES, views: new Set(SYSTEM_VIEW_OPTIONS.map((v) => v.id)) };
  const [acc, setAcc] = useState<NavAccess>(() => accessCache.get(key) ?? fallback);
  useEffect(() => {
    if (!p) return;
    const cached = accessCache.get(key);
    if (cached) { setAcc(cached); return; }
    let cancelled = false;
    loadRoles().then((roles) => {
      const next: NavAccess = { loaded: true, ...accessForRole(roles.find((r) => r.id === roleId) ?? null) };
      accessCache.set(key, next);
      if (!cancelled) setAcc(next);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return acc;
}

/** Plain-language notes shown beside the role picker, so the right role is easy to choose. */
export function roleHints(role: AppRole | null, directReports: number, openProjectsOwned: number): string[] {
  const hints: string[] = [];
  if (!role) return ["No role yet. Pick one so this person sees the right pages."];
  if (directReports > 0 && !role.pages.team_dashboard) hints.push(`Has ${directReports} direct report${directReports === 1 ? "" : "s"}, but this role can't see Team Dashboard.`);
  if (directReports > 0 && !role.can_approve_start) hints.push("Their team's Start Project requests go to the next person up who can approve them.");
  if (openProjectsOwned > 0 && !role.system_views.includes("system_tasks_owner_open")) hints.push(`Owns ${openProjectsOwned} open project${openProjectsOwned === 1 ? "" : "s"}, but this role doesn't include the "Tasks in My Projects" view.`);
  if (directReports === 0 && role.full_access && !role.can_access_user_management && !role.can_access_site_settings) hints.push("Full Access with no admin pages and no direct reports. Check this is intended.");
  return hints;
}

/** A starting suggestion from the data. Sandra picks; nothing is automatic. */
export function suggestedRole(roles: AppRole[], directReports: number, current: AppRole | null): AppRole | null {
  if (directReports > 0 && !current?.pages.team_dashboard) {
    return roles.find((r) => r.name.toLowerCase() === "supervisor") ?? roles.find((r) => r.pages.team_dashboard && !r.can_access_site_settings) ?? null;
  }
  return null;
}
