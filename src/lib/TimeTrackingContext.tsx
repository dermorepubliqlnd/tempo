import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "./supabaseClient";
import { useSession } from "./useSession";
import { startTimer as rpcStart, stopTimer as rpcStop, startNonProjectTimer as rpcStartNonProject, discardTimerEntry as rpcDiscard } from "./timeTracking";
import type { TimeEntryRow } from "./timeTracking";

// App-wide timer state: which task (if any) the current person has
// running right now, plus any of their own entries stuck in
// pending_confirm (a stop or an idle auto-stop that hasn't been reviewed
// yet). Lives above the router (see App.tsx) so both the persistent
// tracker bar in AppLayout and the per-task Start/Stop buttons in
// Projects.tsx share one source of truth instead of polling separately.
//
// Only one timer can run per person globally (DB-enforced via a partial
// unique index -- see [[project_capaciq_time_tracking]]), so "the running
// entry" is always at most one row.

// 2026-09-29 (phase123): a running/pending timer can now be a
// NON-PROJECT timer (task_id null, activity_type_id set). task_name
// carries the display label either way (task name or Activity Type
// name) so every existing "Timing X" / "Stop the timer running on X
// first" string keeps working unchanged.
interface RunningEntry {
  id: string;
  task_id: string | null;
  activity_type_id: string | null;
  is_non_project: boolean;
  task_name: string;
  started_at: string;
}

interface PendingConfirmEntry {
  id: string;
  task_id: string | null;
  activity_type_id: string | null;
  is_non_project: boolean;
  task_name: string;
  notes: string | null;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  auto_stopped: boolean;
  auto_stop_reason?: "limit" | "10pm" | null;
}

interface TimeTrackingContextValue {
  running: RunningEntry | null;
  pendingConfirm: PendingConfirmEntry[];
  busy: boolean;
  start: (task: { id: string; name: string }) => Promise<{ error?: string }>;
  startNonProject: (activityType: { id: string; name: string }) => Promise<{ error?: string }>;
  discard: (entryId: string) => Promise<{ error?: string }>;
  requestStop: () => Promise<{ error?: string }>;
  refresh: () => Promise<void>;
  openConfirmModalFor: string | null;
  setOpenConfirmModalFor: (id: string | null) => void;
  // Bumped after any action that can change a task's confirmed/approved
  // Spent Hrs total (currently: confirming a pending entry). Projects.tsx
  // watches this to know when to re-fetch its own time_entries rollup --
  // it fetches independently from this context's own running/pending
  // poll, so without this a just-confirmed entry wouldn't show up in
  // Spent Hrs until the next full page reload.
  version: number;
  bumpVersion: () => void;
}

const TimeTrackingContext = createContext<TimeTrackingContextValue | null>(null);

export function useTimeTracking(): TimeTrackingContextValue {
  const ctx = useContext(TimeTrackingContext);
  if (!ctx) throw new Error("useTimeTracking must be used inside TimeTrackingProvider");
  return ctx;
}

export function TimeTrackingProvider({ children }: { children: ReactNode }) {
  const { person: me } = useSession();
  const [running, setRunning] = useState<RunningEntry | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [openConfirmModalFor, setOpenConfirmModalFor] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!me) {
      setRunning(null);
      setPendingConfirm([]);
      return;
    }
    // Opportunistic idle auto-stop: cheap to call, only touches rows past
    // the configured threshold, and this is the one place guaranteed to
    // run every time anyone has the app open (see [[project_capaciq_time_tracking]]
    // for why a real server-side cron job is also scheduled as a backstop).
    await supabase.rpc("auto_stop_idle_timers");

    const { data } = await supabase
      .from("time_entries")
      .select("id, task_id, activity_type_id, started_at, ended_at, duration_minutes, auto_stopped, auto_stop_reason, status, reason_notes, task:tasks(name), activity_type:non_project_activity_types(name)")
      .eq("person_id", me.id)
      .eq("is_archived", false)
      .in("status", ["running", "pending_confirm"])
      .order("started_at", { ascending: false });

    const rows = (data as unknown as (TimeEntryRow & { task: { name: string } | null; activity_type: { name: string } | null })[]) ?? [];
    const runningRow = rows.find((r) => r.status === "running");
    // 2026-09-29 (phase123): timers can run against a task OR a
    // non-project Activity Type, so task_id may be null here now.
    const labelOf = (r: (typeof rows)[number]) =>
      r.task_id ? r.task?.name ?? "Untitled task" : r.activity_type?.name ?? "Non-project";
    setRunning(
      runningRow
        ? {
            id: runningRow.id,
            task_id: runningRow.task_id,
            activity_type_id: runningRow.activity_type_id ?? null,
            is_non_project: !runningRow.task_id,
            task_name: labelOf(runningRow),
            started_at: runningRow.started_at,
          }
        : null
    );
    setPendingConfirm(
      rows
        .filter((r) => r.status === "pending_confirm")
        .map((r) => ({
          id: r.id,
          task_id: r.task_id,
          activity_type_id: r.activity_type_id ?? null,
          is_non_project: !r.task_id,
          task_name: labelOf(r),
          notes: r.reason_notes,
          started_at: r.started_at,
          ended_at: r.ended_at!,
          duration_minutes: r.duration_minutes ?? 0,
          auto_stopped: r.auto_stopped,
          auto_stop_reason: r.auto_stop_reason ?? null,
        }))
    );
  }, [me]);

  useEffect(() => {
    refresh();
    pollRef.current = window.setInterval(refresh, 60_000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [refresh]);

  // Surface the confirm modal automatically the moment a stop/auto-stop
  // produces a pending_confirm row, unless one's already open (don't yank
  // focus away mid-review) or the person already dismissed it this
  // session by closing without confirming -- in that case it just waits
  // quietly in the tracker bar's "N unconfirmed" reminder until picked up.
  useEffect(() => {
    if (openConfirmModalFor) return;
    if (pendingConfirm.length > 0) setOpenConfirmModalFor(pendingConfirm[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConfirm.length]);

  async function start(task: { id: string; name: string }) {
    setBusy(true);
    const res = await rpcStart(task.id);
    setBusy(false);
    if (res.error) return { error: res.error };
    await refresh();
    return {};
  }

  async function startNonProject(activityType: { id: string; name: string }) {
    setBusy(true);
    const res = await rpcStartNonProject(activityType.id);
    setBusy(false);
    if (res.error) return { error: res.error };
    await refresh();
    return {};
  }

  async function discard(entryId: string) {
    setBusy(true);
    const res = await rpcDiscard(entryId);
    setBusy(false);
    if (res.error) return { error: res.error };
    await refresh();
    return {};
  }

  async function requestStop() {
    if (!running) return { error: "No timer is running" };
    setBusy(true);
    const res = await rpcStop(running.id);
    setBusy(false);
    if (res.error) return { error: res.error };
    await refresh();
    return {};
  }

  return (
    <TimeTrackingContext.Provider
      value={{ running, pendingConfirm, busy, start, startNonProject, discard, requestStop, refresh, openConfirmModalFor, setOpenConfirmModalFor, version, bumpVersion }}
    >
      {children}
    </TimeTrackingContext.Provider>
  );
}
