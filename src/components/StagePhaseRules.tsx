// 2026-10-09 (Sandra): Site Settings > Customizations > Stage -> Phase rules.
// For each Stage, which Phase the project gets and whether Tempo sets it
// automatically (locked) or the owner picks it (manual). Stored in
// app_settings.stage_phase_rules; applied by the a_project_lifecycle trigger.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useConfirm } from "../lib/useConfirm";
import { friendlyError } from "../lib/prompts";

export type StagePhaseRules = { draft?: { phase?: string | null; auto?: boolean }; closed?: { phase?: string | null; auto?: boolean } };
export const DEFAULT_STAGE_PHASE_RULES: StagePhaseRules = { draft: { phase: "Scoping", auto: true }, closed: { phase: "Done", auto: true } };

export async function fetchStagePhaseRules(): Promise<StagePhaseRules> {
  const { data } = await supabase.from("app_settings").select("stage_phase_rules").eq("id", true).single();
  return ((data as { stage_phase_rules?: StagePhaseRules } | null)?.stage_phase_rules ?? DEFAULT_STAGE_PHASE_RULES) as StagePhaseRules;
}

const ROWS: { key: "draft" | "closed"; stage: string; hint: string }[] = [
  { key: "draft", stage: "Draft / Awaiting Start", hint: "While the project is being planned (before Start Project)." },
  { key: "closed", stage: "Closed", hint: "When Close Project is approved." },
];

export default function StagePhaseRulesPanel() {
  const { alert, dialog } = useConfirm();
  const [rules, setRules] = useState<StagePhaseRules | null>(null);
  const [phases, setPhases] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchStagePhaseRules().then(setRules);
    void supabase.from("project_phases").select("name,is_active,sort_order").eq("is_active", true).order("sort_order").then(({ data }) => setPhases(((data ?? []) as { name: string }[]).map((p) => p.name)));
  }, []);

  async function save(next: StagePhaseRules) {
    setBusy(true);
    const { error } = await supabase.from("app_settings").update({ stage_phase_rules: next }).eq("id", true);
    if (!error) await supabase.rpc("apply_stage_phase_rules");
    setBusy(false);
    if (error) { await alert(friendlyError("save the Stage → Phase rules", error)); return; }
    setRules(next);
  }

  if (!rules) return <p style={{ fontSize: 12, color: "var(--muted)" }}>Loading…</p>;
  const cell = { padding: "10px 8px", borderTop: "1px solid var(--border)", fontSize: 12.5, verticalAlign: "middle" as const };
  return (
    <div>
      {dialog}
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--navy)", marginBottom: 4 }}>Stage → Phase rules</div>
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 14 }}>
        Choose the Phase for each Stage, and whether Tempo sets it <b>automatically</b> (owners can't change it) or the owner picks it (<b>manual</b>). Changes apply to existing projects right away.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ fontSize: 11, color: "var(--muted)", textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>Stage</th>
            <th style={{ padding: "6px 8px", width: 170 }}>Phase</th>
            <th style={{ padding: "6px 8px", width: 190 }}>Set by</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const r = rules[row.key] ?? {};
            const auto = r.auto ?? true;
            return (
              <tr key={row.key}>
                <td style={cell}>
                  <div style={{ fontWeight: 600, color: "var(--navy)" }}>{row.stage}</div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{row.hint}</div>
                </td>
                <td style={cell}>
                  <select
                    disabled={busy}
                    value={r.phase ?? ""}
                    onChange={(e) => void save({ ...rules, [row.key]: { ...r, auto, phase: e.target.value || null } })}
                    style={{ fontSize: 12, padding: "5px 6px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", width: "100%" }}
                  >
                    <option value="">No Phase</option>
                    {phases.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td style={cell}>
                  <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
                    {[true, false].map((v) => (
                      <button
                        key={String(v)}
                        disabled={busy}
                        onClick={() => auto !== v && void save({ ...rules, [row.key]: { ...r, auto: v } })}
                        style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 12px", border: "none", cursor: "pointer", background: auto === v ? "var(--accent)" : "transparent", color: auto === v ? "#fff" : "var(--text-secondary)" }}
                      >
                        {v ? "Automatic" : "Manual"}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
          <tr>
            <td style={cell}>
              <div style={{ fontWeight: 600, color: "var(--navy)" }}>Active / Closing</div>
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>While the project is being delivered.</div>
            </td>
            <td style={{ ...cell, color: "var(--text-secondary)" }}>Owner picks</td>
            <td style={{ ...cell, fontSize: 11.5, color: "var(--text-secondary)" }}>Manual · owners get a reminder when it's empty</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
