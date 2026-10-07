// phase130 (2026-10-02, Sandra): approvals keep the reporting line, but
// every item is ROUTED to one approver. Mirrors effective_approver() in
// phase130_migration.sql (the server is the authoritative gate):
//   1. nearest active manager of the subject (top of chain -> themselves)
//   2. if that manager has an active delegation today -> the delegate
//   3. else if that manager is on leave today (Time Off "off") -> go up
//      one level and repeat; nobody above -> stays with them.
import { supabase } from "./supabaseClient";
import { toISO } from "./workingDays";

export interface ChainPerson {
  id: string;
  reports_to: string | null;
  is_active: boolean;
}

export interface ApprovalDelegation {
  id: string;
  delegator_id: string;
  delegate_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  cancelled_at: string | null;
}

export interface RoutingData {
  chain: ChainPerson[];
  onLeaveToday: Set<string>;
  delegations: ApprovalDelegation[];
  today: string;
}

export function manilaToday(): string {
  return toISO(new Date());
}

export async function loadRoutingData(chain: ChainPerson[]): Promise<RoutingData> {
  const today = manilaToday();
  const [{ data: leave }, { data: dels }] = await Promise.all([
    supabase.from("person_availability").select("person_id").eq("date", today).eq("status", "off"),
    supabase.from("approval_delegations").select("*").is("cancelled_at", null).gte("end_date", today).order("start_date"),
  ]);
  return {
    chain,
    onLeaveToday: new Set(((leave as { person_id: string }[]) ?? []).map((r) => r.person_id)),
    delegations: (dels as ApprovalDelegation[]) ?? [],
    today,
  };
}

export function nearestActiveManagerOf(chain: ChainPerson[], personId: string | null): string | null {
  if (!personId) return null;
  let current = chain.find((p) => p.id === personId)?.reports_to ?? null;
  let depth = 0;
  while (current && depth < 20) {
    const mgr = chain.find((p) => p.id === current);
    if (mgr?.is_active) return mgr.id;
    current = mgr?.reports_to ?? null;
    depth += 1;
  }
  return null;
}

export function activeDelegationFor(data: RoutingData, delegatorId: string): ApprovalDelegation | null {
  const activeIds = new Set(data.chain.filter((p) => p.is_active).map((p) => p.id));
  const hits = data.delegations
    .filter((d) => d.delegator_id === delegatorId && !d.cancelled_at && d.start_date <= data.today && d.end_date >= data.today && activeIds.has(d.delegate_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return hits[0] ?? null;
}

// Returns who the item is routed to, plus whose queue they're covering
// (null when they're the normal approver).
export function routeApproval(data: RoutingData, subjectId: string | null): { approverId: string | null; actingFor: string | null } {
  if (!subjectId) return { approverId: null, actingFor: null };
  let m = nearestActiveManagerOf(data.chain, subjectId);
  if (!m) return { approverId: subjectId, actingFor: null };
  const original = m;
  for (let i = 0; i < 20; i++) {
    const d = activeDelegationFor(data, m);
    if (d && d.delegate_id !== subjectId) return { approverId: d.delegate_id, actingFor: original };
    if (data.onLeaveToday.has(m)) {
      const up = nearestActiveManagerOf(data.chain, m);
      if (!up) return { approverId: m, actingFor: m === original ? null : original };
      m = up;
      continue;
    }
    return { approverId: m, actingFor: m === original ? null : original };
  }
  return { approverId: m, actingFor: m === original ? null : original };
}

// 2026-10-08 (Sandra, item J): Start Project and Close Project requests are
// routed like everything else. Start at the requester's routed approver
// (routeApproval above: leave + delegation applied) and walk up the
// reporting line (active people) to the first person who holds the right:
//   start -> can_approve_rebaseline
//   close -> can_approve_closures or Full Access
// Mirrors project_request_approver() in phase172_project_approvals.sql.
// approverId null = nobody in the line holds the right (anyone with the
// right may decide, no routing).
export interface ApprovalRightsPerson {
  id: string;
  can_approve_rebaseline?: boolean | null;
  can_approve_closures?: boolean | null;
  access_level?: string | null;
}

export type ProjectRequestKind = "start" | "close";

export function holdsProjectRight(p: ApprovalRightsPerson | undefined, kind: ProjectRequestKind): boolean {
  if (!p) return false;
  return kind === "start" ? !!p.can_approve_rebaseline : !!p.can_approve_closures || p.access_level === "full";
}

export function routeProjectRequest(
  data: RoutingData,
  rights: Map<string, ApprovalRightsPerson>,
  kind: ProjectRequestKind,
  requesterId: string | null
): { approverId: string | null; actingFor: string | null } {
  if (!requesterId) return { approverId: null, actingFor: null };
  const first = routeApproval(data, requesterId);
  let p = first.approverId;
  for (let i = 0; p && i < 25; i++) {
    const person = data.chain.find((c) => c.id === p);
    if (person?.is_active && holdsProjectRight(rights.get(p), kind)) {
      return { approverId: p, actingFor: p === first.approverId ? first.actingFor : null };
    }
    p = nearestActiveManagerOf(data.chain, p);
  }
  return { approverId: null, actingFor: null };
}
