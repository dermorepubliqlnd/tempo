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
//   - owns an active project            -> extensions, time entries,
//                                          corrections, task validation on it
//   - has an active direct report       -> manager-chain approvals
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
      const [{ count: ownedCount }, { count: reportCount }] = await Promise.all([
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", me.id)
          .eq("is_archived", false)
          .neq("wbs_status", "closed"),
        supabase.from("people").select("id", { count: "exact", head: true }).eq("reports_to", me.id).eq("is_active", true),
      ]);
      if (!cancelled) setHas((ownedCount ?? 0) > 0 || (reportCount ?? 0) > 0);
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [me]);

  return has;
}
