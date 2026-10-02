// phase132 (2026-10-02, Sandra): per-user page access toggles in User
// Management. Team Dashboard can be granted to anyone; the admin pages
// also require Full Access (their edits are Full-Access-only in the DB).
import type { Person } from "./useSession";

export type PageKey = "team_dashboard" | "user_management" | "reports" | "site_settings";

export function canAccessPage(p: Person | null | undefined, page: PageKey): boolean {
  if (!p) return false;
  const full = p.access_level === "full";
  switch (page) {
    case "team_dashboard":
      return p.can_view_team_dashboard !== false;
    case "user_management":
      return full && p.can_access_user_management !== false;
    case "reports":
      return full && p.can_access_reports !== false;
    case "site_settings":
      return full && p.can_access_site_settings !== false;
  }
}
