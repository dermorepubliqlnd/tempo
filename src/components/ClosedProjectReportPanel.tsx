import { useEffect, useState } from "react";
import { Lightbulb, Plus, TrendingUp, Lock, Flag } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { formatDate } from "../lib/formatDate";

// 2026-09-21 (Sandra: "when a project is closed, instead of having a
// separate page, can we all be routed to the WBS page ... but the
// utilization snapshot will no longer be there. We just want to see
// [Baseline/Final/Variance + Automated Insight], followed by [Lessons
// Learned + Tasks added/grown]"). This is BaselineReport.tsx's core
// logic and cards, lifted out of that standalone page and dropped into
// WbsPlanning.tsx for closed projects -- the page-level chrome (back
// link, h1, the "Closed -- Final Scope is locked" banner, the redundant
// "Go to WBS Planning" link) is deliberately dropped since the caller
// (WbsPlanning.tsx) already has all of that itself. See
// [[project_capaciq_baseline_vs_final]]/[[project_capaciq_phase4_6_workflow_completion]]
// for this panel's data lineage; BaselineReport.tsx and the
// /projects/:id/baseline route are retired in favor of this.

interface TaskRow {
  id: string;
  parent_task_id: string | null;
  name: string;
  estimated_hours: number | null;
  start_date: string | null;
  current_due_date: string | null;
  is_archived: boolean;
  created_at: string;
}
interface BaselineRow {
  id: string;
  version_number: number;
  captured_at: string;
  total_est_hours: number;
  task_count: number;
  start_date: string | null;
  end_date: string | null;
}
interface SnapshotTaskRow {
  task_id: string;
  name: string;
  estimated_hours: number | null;
}
interface CloseoutRow {
  id: string;
  closed_at: string;
  total_est_hours: number;
  task_count: number;
  start_date: string | null;
  end_date: string | null;
  closed_by: string | null;
}
interface PersonLite {
  id: string;
  name: string;
}

function liveTotals(tasks: TaskRow[]) {
  const roots = tasks.filter((t) => !t.parent_task_id);
  const totalEstHours = roots.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0);
  const starts = tasks.map((t) => t.start_date).filter((d): d is string => !!d);
  const ends = tasks.map((t) => t.current_due_date).filter((d): d is string => !!d);
  return {
    totalEstHours,
    taskCount: tasks.length,
    startDate: starts.length ? starts.reduce((a, b) => (b < a ? b : a)) : null,
    endDate: ends.length ? ends.reduce((a, b) => (b > a ? b : a)) : null,
  };
}

export default function ClosedProjectReportPanel({
  projectId,
  actualCloseDate,
  lessonsLearnedWorked,
  lessonsLearnedNotWorked,
}: {
  projectId: string;
  actualCloseDate: string | null;
  lessonsLearnedWorked: string | null;
  lessonsLearnedNotWorked: string | null;
}) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [baseline, setBaseline] = useState<BaselineRow | null>(null);
  const [baselineTasks, setBaselineTasks] = useState<SnapshotTaskRow[]>([]);
  const [closeout, setCloseout] = useState<CloseoutRow | null>(null);
  const [closeoutTasks, setCloseoutTasks] = useState<SnapshotTaskRow[]>([]);
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [{ data: tks }, { data: bl }, { data: co }, { data: ppl }] = await Promise.all([
        supabase
          .from("tasks")
          .select("id,parent_task_id,name,estimated_hours,start_date,current_due_date,is_archived,created_at")
          .eq("project_id", projectId)
          .eq("is_archived", false),
        supabase
          .from("project_baselines")
          .select("id,version_number,captured_at,total_est_hours,task_count,start_date,end_date")
          .eq("project_id", projectId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase.from("project_closeouts").select("id,closed_at,total_est_hours,task_count,start_date,end_date,closed_by").eq("project_id", projectId).maybeSingle(),
        supabase.from("people").select("id,name"),
      ]);
      if (!active) return;
      setTasks((tks as TaskRow[]) ?? []);
      setBaseline((bl as BaselineRow) ?? null);
      setCloseout((co as CloseoutRow) ?? null);
      setPeople((ppl as PersonLite[]) ?? []);
      if (bl) {
        const { data: blt } = await supabase.from("project_baseline_tasks").select("task_id,name,estimated_hours").eq("baseline_id", (bl as BaselineRow).id);
        if (active) setBaselineTasks((blt as SnapshotTaskRow[]) ?? []);
      } else if (active) {
        setBaselineTasks([]);
      }
      if (co) {
        const { data: cot } = await supabase.from("project_closeout_tasks").select("task_id,name,estimated_hours").eq("closeout_id", (co as CloseoutRow).id);
        if (active) setCloseoutTasks((cot as SnapshotTaskRow[]) ?? []);
      } else if (active) {
        setCloseoutTasks([]);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  if (loading) return <div style={{ padding: 14, color: "var(--muted)", fontSize: 12.5 }}>Loading report…</div>;
  if (!baseline) {
    return (
      <div className="card" style={{ padding: 14, fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
        No baseline was ever captured for this project, so a Baseline vs Final report can't be shown.
      </div>
    );
  }

  const live = liveTotals(tasks);
  const finalTotals = closeout ? { totalEstHours: closeout.total_est_hours, taskCount: closeout.task_count, endDate: closeout.end_date } : null;
  const hoursDelta = (finalTotals ? finalTotals.totalEstHours : live.totalEstHours) - baseline.total_est_hours;
  const taskDelta = (finalTotals ? finalTotals.taskCount : live.taskCount) - baseline.task_count;
  const compareEnd = finalTotals ? finalTotals.endDate : live.endDate;
  const endDaysDelta =
    baseline.end_date && compareEnd ? Math.round((new Date(compareEnd).getTime() - new Date(baseline.end_date).getTime()) / 86400000) : null;

  const baselineTaskIds = new Set(baselineTasks.map((t) => t.task_id));
  const compareTaskList = closeout ? closeoutTasks : tasks.map((t) => ({ task_id: t.id, name: t.name, estimated_hours: t.estimated_hours }));
  const addedTasks = compareTaskList.filter((t) => !baselineTaskIds.has(t.task_id));
  const baselineHoursById = new Map(baselineTasks.map((t) => [t.task_id, t.estimated_hours ?? 0]));
  const grownTasks = compareTaskList
    .filter((t) => baselineHoursById.has(t.task_id) && (t.estimated_hours ?? 0) > (baselineHoursById.get(t.task_id) ?? 0))
    .map((t) => ({ ...t, delta: (t.estimated_hours ?? 0) - (baselineHoursById.get(t.task_id) ?? 0) }));

  const createdAtByTaskId = new Map(tasks.map((t) => [t.id, t.created_at]));
  const LATE_ADDITION_WINDOW_DAYS = 14;
  const compareEndTime = compareEnd ? new Date(compareEnd).getTime() : null;
  const addedTasksWithCreated = addedTasks.map((t) => ({ ...t, created_at: createdAtByTaskId.get(t.task_id) ?? null }));
  const lateAddedTasks = addedTasksWithCreated.filter((t) => {
    if (!t.created_at || compareEndTime === null) return false;
    const daysBeforeEnd = (compareEndTime - new Date(t.created_at).getTime()) / 86400000;
    return daysBeforeEnd >= 0 && daysBeforeEnd <= LATE_ADDITION_WINDOW_DAYS;
  });
  const lateAddedHours = lateAddedTasks.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0);
  const addedHoursTotal = addedTasks.reduce((sum, t) => sum + (t.estimated_hours ?? 0), 0);
  const grownHoursTotal = grownTasks.reduce((sum, t) => sum + t.delta, 0);

  function buildInsight(): string {
    if (!finalTotals || endDaysDelta === null) {
      if (endDaysDelta !== null && endDaysDelta > 0) {
        return `Based on the live plan, this project is currently tracking ${endDaysDelta} day(s) past its original baseline end date${
          addedTasks.length > 0 ? `, with ${addedTasks.length} task(s) added since baseline (+${addedHoursTotal}h)` : ""
        }${grownTasks.length > 0 ? `${addedTasks.length > 0 ? " and" : ","} ${grownTasks.length} task(s) that grew in scope (+${grownHoursTotal}h)` : ""}. Not yet closed out -- this is a preview, not final.`;
      }
      return "Not enough signal yet to generate an insight -- close this project out to get a final read on how it tracked against baseline.";
    }
    const onTime = endDaysDelta <= 0;
    if (onTime) {
      const extra =
        addedTasks.length > 0 || grownTasks.length > 0
          ? ` despite ${[
              addedTasks.length > 0 ? `${addedTasks.length} task(s) added (+${addedHoursTotal}h)` : null,
              grownTasks.length > 0 ? `${grownTasks.length} task(s) that grew in scope (+${grownHoursTotal}h)` : null,
            ]
              .filter(Boolean)
              .join(" and ")}`
          : "";
      return `Closed ${endDaysDelta === 0 ? "exactly on" : `${Math.abs(endDaysDelta)} day(s) ahead of`} its baseline end date${extra}.`;
    }
    const causes: string[] = [];
    if (lateAddedTasks.length > 0) {
      causes.push(
        `${lateAddedTasks.length} task${lateAddedTasks.length === 1 ? "" : "s"} added within ${LATE_ADDITION_WINDOW_DAYS} days of close (+${lateAddedHours}h) -- late-breaking or urgent work that wasn't part of the original plan`
      );
    }
    const earlyAddedCount = addedTasks.length - lateAddedTasks.length;
    if (earlyAddedCount > 0) {
      causes.push(`${earlyAddedCount} more task${earlyAddedCount === 1 ? "" : "s"} added earlier in the project (+${addedHoursTotal - lateAddedHours}h)`);
    }
    if (grownTasks.length > 0) {
      causes.push(`${grownTasks.length} existing task${grownTasks.length === 1 ? "" : "s"} that grew in scope (+${grownHoursTotal}h)`);
    }
    const causeText = causes.length > 0 ? ` Likely contributors: ${causes.join("; ")}.` : " No added or grown tasks account for it -- worth a closer look at what else shifted the timeline.";
    return `Closed ${endDaysDelta} day(s) later than its baseline end date.${causeText}`;
  }
  const insightText = buildInsight();

  function statCard(label: string, icon: React.ReactNode, tone: string, rows: { label: string; value: string }[]) {
    return (
      <div className="card" style={{ padding: 14, flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: tone, fontWeight: 600, fontSize: 12.5 }}>
          {icon}
          {label}
        </div>
        {rows.map((r) => (
          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
            <span style={{ color: "var(--muted)" }}>{r.label}</span>
            <span style={{ fontWeight: 600 }}>{r.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        {statCard(`Baseline V${baseline.version_number} (at lock)`, <Lock size={13} />, "var(--navy)", [
          { label: "Captured", value: formatDate(baseline.captured_at.slice(0, 10)) },
          { label: "Est. hours", value: `${baseline.total_est_hours}` },
          { label: "Tasks", value: `${baseline.task_count}` },
          { label: "Start", value: baseline.start_date ? formatDate(baseline.start_date) : "—" },
          { label: "End", value: baseline.end_date ? formatDate(baseline.end_date) : "—" },
        ])}

        {statCard(closeout ? "Final (closed out)" : "Final — not closed out yet", <Flag size={13} />, closeout ? "#1a7f37" : "var(--muted)", [
          {
            label: closeout ? "Project Closed" : "Live (preview)",
            value: closeout ? (actualCloseDate ? formatDate(actualCloseDate) : "—") : "current",
          },
          { label: "Est. hours", value: `${finalTotals ? finalTotals.totalEstHours : live.totalEstHours}` },
          { label: "Tasks", value: `${finalTotals ? finalTotals.taskCount : live.taskCount}` },
          { label: "End", value: compareEnd ? formatDate(compareEnd) : "—" },
          ...(closeout
            ? [
                { label: "Signed Off Date", value: formatDate(closeout.closed_at.slice(0, 10)) },
                { label: "Approved By", value: people.find((p) => p.id === closeout.closed_by)?.name ?? "—" },
              ]
            : []),
        ])}

        {statCard("Variance", <TrendingUp size={13} />, hoursDelta > 0 || taskDelta > 0 ? "#b45309" : "var(--navy)", [
          { label: "Hours", value: `${hoursDelta >= 0 ? "+" : ""}${hoursDelta}` },
          { label: "Tasks", value: `${taskDelta >= 0 ? "+" : ""}${taskDelta}` },
          { label: "End date", value: endDaysDelta === null ? "—" : `${endDaysDelta >= 0 ? "+" : ""}${endDaysDelta} day(s)` },
        ])}
      </div>

      <div
        className="card"
        style={{
          padding: 14,
          marginBottom: 14,
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          background: "#eef2ff",
          borderColor: "#c7d2fe",
        }}
      >
        <Lightbulb size={15} style={{ color: "#4338ca", flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#4338ca", marginBottom: 3 }}>Automated Insight</div>
          <div style={{ fontSize: 12.5, color: "#312e81", lineHeight: 1.5 }}>{insightText}</div>
        </div>
      </div>

      {(lessonsLearnedWorked || lessonsLearnedNotWorked) && (
        <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flexBasis: "100%", fontWeight: 600, fontSize: 12.5, marginBottom: 2 }}>
            Lessons Learned{actualCloseDate ? ` -- closed ${formatDate(actualCloseDate)}` : ""}
          </div>
          <div style={{ flex: "1 1 300px", minWidth: 260 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>What Worked</div>
            <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{lessonsLearnedWorked || "—"}</div>
          </div>
          <div style={{ flex: "1 1 300px", minWidth: 260 }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 4 }}>What Didn't Work</div>
            <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{lessonsLearnedNotWorked || "—"}</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div className="card" style={{ padding: 14, flex: 1, minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontWeight: 600, fontSize: 12.5 }}>
            <Plus size={13} /> Tasks added since baseline ({addedTasks.length})
          </div>
          {addedTasks.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>None.</div>
          ) : (
            addedTasks.map((t) => (
              <div key={t.task_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                <span>{t.name}</span>
                <span style={{ color: "var(--muted)" }}>{t.estimated_hours ?? 0}h</span>
              </div>
            ))
          )}
        </div>

        <div className="card" style={{ padding: 14, flex: 1, minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontWeight: 600, fontSize: 12.5 }}>
            <TrendingUp size={13} /> Tasks whose hours grew ({grownTasks.length})
          </div>
          {grownTasks.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>None.</div>
          ) : (
            grownTasks.map((t) => (
              <div key={t.task_id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
                <span>{t.name}</span>
                <span style={{ color: "#b45309" }}>+{t.delta}h</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
