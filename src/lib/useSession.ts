import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

export interface Person {
  id: string;
  name: string;
  email: string;
  access_level: "full" | "limited";
  reports_to: string | null;
  daily_capacity_hours: number;
  is_active: boolean;
  auth_user_id: string | null;
  color: string | null;
  can_approve_closures: boolean;
  // Sandra, 2026-07-29: authorization flag for the re-baselining approval
  // workflow -- same flat, non-tiered pattern as can_approve_closures
  // above. (Its sibling can_approve_reopening was removed 2026-08-21: it
  // was never wired to anything -- see canReopenTask in Projects.tsx for
  // the real manager-chain check that replaced it for task reopening.)
  can_approve_rebaseline: boolean;
  // phase132: page access toggles.
  can_view_team_dashboard?: boolean;
  can_access_user_management?: boolean;
  can_access_reports?: boolean;
  can_access_site_settings?: boolean;
  // Sandra, 2026-08-14: CSV bulk-import fields for User Management --
  // Employee ID (org identifier, distinct from the internal uuid) and
  // Role/job title (function like "Trainer" or "Content Developer",
  // distinct from access_level's Admin/Limited permission tier).
  employee_id: string | null;
  job_title: string | null;
  // phase126d: false = not expected to log time (excluded from expected /
  // missing hours). Capacity & utilization are unaffected.
  tracks_time?: boolean;
}

// 2026-10-04 (Sandra): everyone is signed out at 10:00 PM Philippine time
// so the day starts with a fresh sign-in. Rule: if this session's sign-in
// happened before the most recent 10 PM PH cutoff, sign out. Checked on
// load, every minute, and whenever the tab regains focus -- so a laptop
// left open overnight is signed out at 10 PM, and one that was closed is
// signed out the moment it's opened the next morning.
export const AUTO_LOGOUT_FLAG = "tempo_auto_logged_out";
const PH_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8, no daylight saving
const CUTOFF_HOUR_PH = 22;
export function mostRecentAutoLogoutCutoff(now: Date = new Date()): Date {
  const ph = new Date(now.getTime() + PH_OFFSET_MS);
  let cutoff = Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate(), CUTOFF_HOUR_PH) - PH_OFFSET_MS;
  if (cutoff > now.getTime()) cutoff -= 24 * 60 * 60 * 1000;
  return new Date(cutoff);
}
// Tempo's own sign-in stamp (ms epoch), written at the moment someone
// actually signs in (Login form, or arriving from an invite/recovery link).
// Not Supabase's last_sign_in_at: that one moves on every background token
// refresh, so a session restored in the morning could slip past the rule.
export const SIGNED_IN_AT_KEY = "tempo_signed_in_at";
export function markSignedInNow() {
  try { localStorage.setItem(SIGNED_IN_AT_KEY, String(Date.now())); } catch { /* ignore */ }
}
function signedInBeforeCutoff(session: Session | null): boolean {
  if (!session) return false;
  try {
    if (sessionStorage.getItem("capaciq_pending_auth_type")) return false; // mid invite/recovery
  } catch { /* ignore */ }
  let at = 0;
  try { at = Number(localStorage.getItem(SIGNED_IN_AT_KEY) ?? 0); } catch { /* ignore */ }
  return !at || at < mostRecentAutoLogoutCutoff().getTime();
}

// Tracks the current Supabase Auth session and the matching `people` row
// (which carries access_level, used everywhere we need to gate a screen
// or action to Full Access users). `loading` is true until both the
// session and, if present, the person record have been resolved at least
// once — screens should show nothing (not a login redirect) while true.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadPerson(userId: string) {
      const { data } = await supabase.from("people").select("*").eq("auth_user_id", userId).single();
      if (active) setPerson((data as Person) ?? null);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (data.session?.user) {
        loadPerson(data.session.user.id).finally(() => active && setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;
      setSession(newSession);
      if (newSession?.user) {
        loadPerson(newSession.user.id);
      } else {
        setPerson(null);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let signingOut = false;
    const check = () => {
      if (signingOut || !signedInBeforeCutoff(session)) return;
      signingOut = true;
      try { sessionStorage.setItem(AUTO_LOGOUT_FLAG, "1"); } catch { /* ignore */ }
      try { localStorage.removeItem(SIGNED_IN_AT_KEY); } catch { /* ignore */ }
      void supabase.auth.signOut({ scope: "local" }).finally(() => { signingOut = false; });
    };
    check();
    const timer = window.setInterval(check, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [session]);

  return { session, person, loading };
}
