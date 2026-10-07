import { useMemo, useState, type CSSProperties } from "react";
import Modal from "./Modal";
import { supabase } from "../lib/supabaseClient";

interface PersonOption {
  id: string;
  name: string;
}

interface ExistingSession {
  name: string;
  start_date: string | null;
  assignee_id: string | null;
}

interface Props {
  projectId: string;
  projectName: string;
  people: PersonOption[];
  existingSessions: ExistingSession[];
  onClose: () => void;
  onImported: () => void;
}

interface ParsedRow {
  rowNumber: number;
  session: string;
  startDate: string;
  endDate: string;
  hours: number;
  trainerText: string;
  trainerId: string | null;
  errors: string[];
  duplicate: boolean;
  importError?: string;
  imported?: boolean;
}

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 650,
  color: "var(--navy)",
  marginBottom: 4,
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return raw;
    return null;
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    const y = Number(slash[3]);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  return null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((v) => v.trim());
}

function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let quoted = false;

  const flush = () => {
    if (current.trim()) rows.push(parseCsvLine(current));
    current = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        current += '""';
        i += 1;
      } else {
        quoted = !quoted;
        current += ch;
      }
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return rows;
}

function downloadTemplate() {
  const csv = [
    "Session,Start Date,End Date,Estimated Hours,Trainer",
    '"TS-2026-074 - NEO",2026-10-09,2026-10-09,4,"Fritzie Dipon"',
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tempo-training-delivery-sessions-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BulkUploadSessionsModal({
  projectId,
  projectName,
  people,
  existingSessions,
  onClose,
  onImported,
}: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const peopleByName = useMemo(() => {
    const map = new Map<string, PersonOption[]>();
    people.forEach((person) => {
      const key = normalize(person.name);
      const bucket = map.get(key) ?? [];
      bucket.push(person);
      map.set(key, bucket);
    });
    return map;
  }, [people]);

  const existingKeys = useMemo(() => {
    return new Set(
      existingSessions
        .filter((s) => s.start_date && s.assignee_id)
        .map((s) => `${normalize(s.name)}|${s.start_date!.slice(0, 10)}|${s.assignee_id}`)
    );
  }, [existingSessions]);

  async function handleFile(file: File | null) {
    setRows([]);
    setSummary(null);
    setFileError(null);
    setFileName(file?.name ?? "");
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setFileError("Please upload a CSV file.");
      return;
    }

    const text = await file.text();
    const rawRows = splitCsvRows(text);
    if (rawRows.length < 2) {
      setFileError("The CSV must contain the header row plus at least one session.");
      return;
    }

    // Estimated Hours (renamed from Scoped Hours, 2026-10-07) -- old templates still accepted.
    const header = rawRows[0].map(normalize).map((h) => (h === "estimated hours" ? "scoped hours" : h));
    const required = ["session", "start date", "end date", "scoped hours", "trainer"];
    const indexes = Object.fromEntries(required.map((name) => [name, header.indexOf(name)])) as Record<string, number>;
    const missing = required.filter((name) => indexes[name] < 0);
    if (missing.length) {
      setFileError(`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.map((m) => (m === "scoped hours" ? "estimated hours" : m)).join(", ")}.`);
      return;
    }

    if (rawRows.length - 1 > 200) {
      setFileError("Temporary bulk upload is limited to 200 sessions per CSV.");
      return;
    }

    const seen = new Set<string>();
    const parsed = rawRows.slice(1).map((cols, idx): ParsedRow => {
      const errors: string[] = [];
      const session = cols[indexes["session"]]?.trim() ?? "";
      const startRaw = cols[indexes["start date"]]?.trim() ?? "";
      const endRaw = cols[indexes["end date"]]?.trim() ?? "";
      const hoursRaw = cols[indexes["scoped hours"]]?.trim() ?? "";
      const trainerText = cols[indexes["trainer"]]?.trim() ?? "";

      const startDate = parseDate(startRaw) ?? "";
      const endDate = parseDate(endRaw) ?? "";
      const hours = Number(hoursRaw);
      const trainers = peopleByName.get(normalize(trainerText)) ?? [];
      const trainerId = trainers.length === 1 ? trainers[0].id : null;

      if (!session) errors.push("Session is required");
      if (!startDate) errors.push("Invalid Start Date");
      if (!endDate) errors.push("Invalid End Date");
      if (startDate && endDate && endDate < startDate) errors.push("End Date is before Start Date");
      if (!Number.isFinite(hours) || hours <= 0 || hours > 12) errors.push("Estimated Hours must be > 0 and <= 12");
      if (!trainerText) errors.push("Trainer is required");
      else if (trainers.length === 0) errors.push("Trainer not found");
      else if (trainers.length > 1) errors.push("Trainer name matches multiple people");

      const key = trainerId && startDate ? `${normalize(session)}|${startDate}|${trainerId}` : "";
      const duplicate = !!key && (existingKeys.has(key) || seen.has(key));
      if (key) seen.add(key);

      return {
        rowNumber: idx + 2,
        session,
        startDate,
        endDate,
        hours,
        trainerText,
        trainerId,
        errors,
        duplicate,
      };
    });

    setRows(parsed);
  }

  const invalidCount = rows.filter((r) => r.errors.length > 0).length;
  const duplicateCount = rows.filter((r) => r.duplicate).length;
  const readyRows = rows.filter((r) => r.errors.length === 0 && !r.duplicate && !r.imported);

  async function importRows() {
    if (!readyRows.length || busy) return;
    setBusy(true);
    setSummary(null);

    let imported = 0;
    let failed = 0;
    const next = [...rows];

    for (let i = 0; i < next.length; i += 1) {
      const row = next[i];
      if (row.errors.length || row.duplicate || row.imported || !row.trainerId) continue;

      const { error } = await supabase.rpc("add_session_task_range", {
        p_project_id: projectId,
        p_name: row.session,
        p_start_date: row.startDate,
        p_end_date: row.endDate,
        p_hours: row.hours,
        p_assignee: row.trainerId,
      });

      if (error) {
        next[i] = { ...row, importError: error.message };
        failed += 1;
      } else {
        next[i] = { ...row, imported: true, importError: undefined };
        imported += 1;
      }
      setRows([...next]);
    }

    setBusy(false);
    if (imported > 0) onImported();
    setSummary(
      `${imported} session${imported === 1 ? "" : "s"} imported${failed ? `; ${failed} failed` : ""}${duplicateCount ? `; ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped` : ""}.`
    );
  }

  return (
    <Modal title="Bulk Upload Sessions" onClose={busy ? () => {} : onClose} width={900}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}>
          Temporary CSV uploader for <strong>{projectName}</strong>. Required columns: Session, Start Date, End Date, Estimated Hours, Trainer.
          Dates may be YYYY-MM-DD or MM/DD/YYYY.
        </div>

        <div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 360px" }}>
            <div style={labelStyle}>CSV file</div>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              style={{ width: "100%", fontSize: 12 }}
            />
          </div>
          <button type="button" className="btn-secondary" onClick={downloadTemplate} disabled={busy}>
            Download CSV template
          </button>
        </div>

        {fileName && !fileError && <div style={{ fontSize: 11, color: "var(--muted)" }}>Loaded: {fileName}</div>}
        {fileError && <div style={{ fontSize: 11.5, color: "var(--danger-text)" }}>{fileError}</div>}

        {rows.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11.5 }}>
              <span><strong>{rows.length}</strong> rows</span>
              <span style={{ color: invalidCount ? "var(--danger-text)" : "var(--success-text)" }}><strong>{invalidCount}</strong> invalid</span>
              <span style={{ color: duplicateCount ? "var(--warning-text)" : "var(--muted)" }}><strong>{duplicateCount}</strong> duplicates</span>
              <span style={{ color: "var(--success-text)" }}><strong>{readyRows.length}</strong> ready to import</span>
            </div>

            <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead style={{ position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>
                  <tr>
                    {["Row", "Session", "Start", "End", "Hours", "Trainer", "Status"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "7px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontWeight: 650 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const status = row.imported
                      ? "Imported"
                      : row.importError
                      ? row.importError
                      : row.errors.length
                      ? row.errors.join("; ")
                      : row.duplicate
                      ? "Duplicate — skipped"
                      : "Ready";
                    const statusColor = row.imported
                      ? "var(--success-text)"
                      : row.importError || row.errors.length
                      ? "var(--danger-text)"
                      : row.duplicate
                      ? "var(--warning-text)"
                      : "var(--text)";
                    return (
                      <tr key={row.rowNumber} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{row.rowNumber}</td>
                        <td style={{ padding: "6px 8px", minWidth: 190 }}>{row.session || "—"}</td>
                        <td style={{ padding: "6px 8px" }}>{row.startDate || "—"}</td>
                        <td style={{ padding: "6px 8px" }}>{row.endDate || "—"}</td>
                        <td style={{ padding: "6px 8px" }}>{Number.isFinite(row.hours) ? row.hours : "—"}</td>
                        <td style={{ padding: "6px 8px", minWidth: 140 }}>{row.trainerText || "—"}</td>
                        <td style={{ padding: "6px 8px", color: statusColor, minWidth: 180 }}>{status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {summary && <div style={{ fontSize: 11.5, color: "var(--success-text)", fontWeight: 600 }}>{summary}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
            {summary ? "Done" : "Cancel"}
          </button>
          <button type="button" className="btn-primary" disabled={busy || readyRows.length === 0} onClick={() => void importRows()}>
            {busy ? "Importing…" : `Import ${readyRows.length || ""} Valid Session${readyRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
