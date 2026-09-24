import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { useSession } from "./useSession";

// 2026-09-24 (Sandra: "Approval Center should only appear for users who
// actually have approval authority"). No new permission flag -- derived
// from what already decides every approval kind (see ApprovalCenter.tsx
// canDecide* functions):
//   - Full Access                       -> everything except Baseline
//   - can_approve_rebaseline            -> Baseline approvals
//   - can_approve_closures              -> Project close
//   - has an active direct report       -> every reporting-line approval
//     (extensions, time entries, corrections, task validation) -- phase112
//     removed project-owner approval rights
// Returns null while loading so callers don't flash the tab.
export function useApprovalAuthority(): boolean | null {
  const { person: me } = useSession();
  const [has, setHas] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!me) {
        setHas(null);
        return;
      }
      if (me.access_level === "full" || me.can_approve_closures || me.can_approve_rebaseline) {
        setHas(true);
        return;
      }
      // phase112: project ownership no longer grants approval rights --
      // only having someone in your reporting line does.
      const { count: reportCount } = await supabase.from("people").select("id", { count: "exact", head: true }).eq("reports_to", me.id).eq("is_active", true);
      if (!cancelled) setHas((reportCount ?? 0) > 0);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [me]);

  return has;
}
