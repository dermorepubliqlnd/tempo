import { createPortal } from "react-dom";
import { X, Pencil } from "lucide-react";
import type { CSSProperties } from "react";
import type { Person } from "../lib/useSession";
import { defaultColorFor, isValidHex } from "../lib/personColors";

// Right-side user-details drawer for User Management (2026-08-20
// redesign). Follows the same drawer convention as NotesSidebar.tsx --
// createPortal to document.body, a transparent click-outside-to-close
// backdrop, `position: fixed` panel pinned to the right edge, full
// height, box-shadow -- just a bit narrower (view-only field density is
// lower than Notes' chat thread) and with two render modes instead of
// one.
//
// Main UX objective this exists for (Sandra, 2026-08-20 brief): "the key
// issue with the current page is there's not enough distinction between
// View State and Edit State." Selecting a row always opens this drawer
// in `mode="view"` (read-only, no inputs at all) -- only clicking
// "Edit user" (here, or from the row's ... menu) switches to
// `mode="edit"`, which is the ONLY place editable controls appear.
//
// Access level, approval-flag, and color changes save immediately when
// changed in Edit mode (same optimistic-update handlers Admin.tsx always
// had -- changeAccessLevel/toggleApprovalFlag/saveColor, each with its
// own confirm dialog / error handling already). "Save changes" in the
// footer only covers the plain-field group (name/email/reports_to/
// capacity/employee_id/job_title) via the existing saveEdit -- see the
// redesign report for why this split (option a) was chosen over fully
// batching everything behind one Save button.
const DRAWER_WIDTH = 440;

export interface UserDrawerProps {
  person: Person;
  people: Person[];
  mode: "view" | "edit";
  onClose: () => void;
  onEnterEdit: () => void;

  // Plain-field edit state (name/email/reports_to/capacity/employee_id/job_title)
  editName: string;
  setEditName: (v: string) => void;
  editEmail: string;
  setEditEmail: (v: string) => void;
  editReportsTo: string;
  setEditReportsTo: (v: string) => void;
  editCapacity: string;
  setEditCapacity: (v: string) => void;
  editEmployeeId: string;
  setEditEmployeeId: (v: string) => void;
  editJobTitle: string;
  setEditJobTitle: (v: string) => void;
  editSaving: boolean;
  onCancelEdit: () => void;
  onSaveEdit: () => void;

  // Immediate-save handlers (unchanged from the pre-redesign page)
  onChangeAccessLevel: (level: "limited" | "full") => void;
  onToggleApprovalFlag: (field: "can_approve_closures" | "can_approve_rebaseline" | "can_view_team_dashboard" | "can_access_user_management" | "can_access_reports" | "can_access_site_settings", value: boolean) => void;
  // phase132: the signed-in admin (can't switch off their own User Management).
  meId?: string;
  onSaveColor: (hex: string | null) => void;
  onToggleTracksTime: (value: boolean) => void;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ person, size = 40 }: { person: Person; size?: number }) {
  const bg = person.color || defaultColorFor(person.id);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.38,
        flexShrink: 0,
      }}
    >
      {initialsFor(person.name)}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

export default function UserDrawer({
  meId,
  person,
  people,
  mode,
  onClose,
  onEnterEdit,
  editName,
  setEditName,
  editEmail,
  setEditEmail,
  editReportsTo,
  setEditReportsTo,
  editCapacity,
  setEditCapacity,
  editEmployeeId,
  setEditEmployeeId,
  editJobTitle,
  setEditJobTitle,
  editSaving,
  onCancelEdit,
  onSaveEdit,
  onChangeAccessLevel,
  onToggleApprovalFlag,
  onSaveColor,
  onToggleTracksTime,
}: UserDrawerProps) {
  const manager = people.find((x) => x.id === person.reports_to);
  const approvalCount = [person.can_approve_closures, person.can_approve_rebaseline].filter(Boolean).length;
  const isEdit = mode === "edit";

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,41,66,0.25)", zIndex: 150 }} />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: DRAWER_WIDTH,
          background: "var(--surface)",
          boxShadow: "-4px 0 16px rgba(0,0,0,0.15)",
          zIndex: 151,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
              <Avatar person={person} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "var(--navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {person.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{person.job_title || "—"}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <span className={`status-pill ${person.is_active ? "success" : "neutral"}`}>{person.is_active ? "Active" : "Deactivated"}</span>
            {isEdit && <span className="status-pill warning">Editing</span>}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px" }}>
          <Section title="Employment">
            {isEdit ? (
              <>
                <Field label="Employee ID">
                  <input
                    value={editEmployeeId}
                    onChange={(e) => setEditEmployeeId(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Full name">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} spellCheck={false} autoComplete="off" style={inputStyle} />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    title="Changes their login email too"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Role">
                  <input
                    value={editJobTitle}
                    onChange={(e) => setEditJobTitle(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    style={inputStyle}
                  />
                </Field>
                <Field label="Manager (reports to)">
                  <select value={editReportsTo} onChange={(e) => setEditReportsTo(e.target.value)} style={inputStyle}>
                    <option value="">— none —</option>
                    {people
                      .filter((x) => x.id !== person.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            ) : (
              <>
                <Field label="Employee ID">{person.employee_id ?? "—"}</Field>
                <Field label="Email">{person.email}</Field>
                <Field label="Role">{person.job_title ?? "—"}</Field>
                <Field label="Manager">{manager?.name ?? "—"}</Field>
              </>
            )}
          </Section>

          <Section title="Capacity">
            {isEdit ? (
              <Field label="Daily capacity (hrs)">
                <input type="number" step="0.5" value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} style={{ ...inputStyle, width: 100 }} />
              </Field>
            ) : (
              <Field label="Daily capacity">{person.daily_capacity_hours} hrs/day</Field>
            )}
            <Field label="Capacity and Time Tracking">
              {isEdit ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }} title="Untick for people who don't log time and aren't part of delivery capacity (e.g. leadership). They're left out of expected hours, Missing Hours, Utilization and capacity.">
                  <input type="checkbox" checked={person.tracks_time !== false} onChange={(e) => onToggleTracksTime(e.target.checked)} />
                  {person.tracks_time !== false ? "Yes" : "No"}
                </label>
              ) : person.tracks_time !== false ? (
                "Yes"
              ) : (
                <span className="status-pill neutral">Excluded</span>
              )}
            </Field>
            <Field label="Planner color">
              {isEdit ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    value={person.color || defaultColorFor(person.id)}
                    onChange={(e) => onSaveColor(e.target.value)}
                    title="Pick a color -- used for this team member's bars in the WBS Gantt chart"
                    style={{ width: 30, height: 26, padding: 0, border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", background: "none" }}
                  />
                  <input
                    key={`${person.id}-${person.color ?? "default"}`}
                    type="text"
                    defaultValue={person.color ?? ""}
                    placeholder={defaultColorFor(person.id)}
                    spellCheck={false}
                    autoComplete="off"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && !isValidHex(v)) {
                        window.alert(`"${v}" isn't a valid hex color (expected format: #3b82f6). Not saved.`);
                        e.target.value = person.color ?? "";
                        return;
                      }
                      onSaveColor(v || null);
                    }}
                    style={{ ...inputStyle, width: 100, fontFamily: "monospace", fontSize: 11 }}
                  />
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: person.color || defaultColorFor(person.id),
                      border: "1px solid var(--border)",
                      display: "inline-block",
                    }}
                  />
                  <code style={{ fontSize: 12 }}>{person.color || defaultColorFor(person.id)}</code>
                </div>
              )}
            </Field>
          </Section>

          <Section title="System access">
            <Field label="Access level">
              {isEdit ? (
                <select
                  value={person.access_level}
                  onChange={(e) => onChangeAccessLevel(e.target.value as "limited" | "full")}
                  style={{ ...inputStyle, width: 140 }}
                >
                  <option value="limited">Limited</option>
                  <option value="full">Full</option>
                </select>
              ) : (
                <span className={`status-pill ${person.access_level === "full" ? "success" : "neutral"}`}>
                  {person.access_level === "full" ? "Full" : "Limited"}
                </span>
              )}
            </Field>
          </Section>

          <Section title="Approval rights">
            {isEdit ? (
              <>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }} title="Approve or decline Start Project requests (locks the project baseline)">
                  <input
                    type="checkbox"
                    checked={person.can_approve_rebaseline}
                    onChange={(e) => onToggleApprovalFlag("can_approve_rebaseline", e.target.checked)}
                  />
                  Can approve Start Project
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }} title="Approve or reject Close Project requests (Full Access can too)">
                  <input
                    type="checkbox"
                    checked={person.can_approve_closures}
                    onChange={(e) => onToggleApprovalFlag("can_approve_closures", e.target.checked)}
                  />
                  Project Close
                </label>
              </>
            ) : (
              <>
                <Field label="Can approve Start Project">{person.can_approve_rebaseline ? "Yes" : "No"}</Field>
                <Field label="Project Close">{person.can_approve_closures ? "Yes" : "No"}</Field>
                {approvalCount === 0 && <div style={{ fontSize: 11, color: "var(--muted)" }}>No approval permissions granted.</div>}
              </>
            )}
          </Section>

          {/* phase132 (Sandra): per-user page access. Admin pages also need Full Access. */}
          <Section title="Page access">
            {(() => {
              const isFull = person.access_level === "full";
              const items: { field: "can_view_team_dashboard" | "can_access_user_management" | "can_access_reports" | "can_access_site_settings"; label: string; admin: boolean }[] = [
                { field: "can_view_team_dashboard", label: "Team Dashboard", admin: false },
                { field: "can_access_user_management", label: "User Management", admin: true },
                { field: "can_access_reports", label: "Reports", admin: true },
                { field: "can_access_site_settings", label: "Site Settings", admin: true },
              ];
              const valueOf = (f: (typeof items)[number]["field"], admin: boolean) => (admin ? isFull && person[f] !== false : person[f] !== false);
              if (!isEdit) {
                return (
                  <>
                    {items.map((it) => (
                      <Field key={it.field} label={it.label}>{valueOf(it.field, it.admin) ? "Yes" : "No"}</Field>
                    ))}
                  </>
                );
              }
              return (
                <>
                  {items.map((it) => {
                    const lockedSelf = it.field === "can_access_user_management" && meId === person.id;
                    const disabled = (it.admin && !isFull) || lockedSelf;
                    return (
                      <label
                        key={it.field}
                        style={{ display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "not-allowed" : "pointer", fontSize: 13, opacity: it.admin && !isFull ? 0.55 : 1 }}
                        title={it.admin && !isFull ? "Requires Full Access" : lockedSelf ? "You can't remove your own User Management access" : undefined}
                      >
                        <input type="checkbox" disabled={disabled} checked={valueOf(it.field, it.admin)} onChange={(e) => onToggleApprovalFlag(it.field, e.target.checked)} />
                        {it.label}
                      </label>
                    );
                  })}
                  {!isFull && <div style={{ fontSize: 11, color: "var(--muted)" }}>Admin pages require Full Access.</div>}
                </>
              );
            })()}
          </Section>
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--border)", padding: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {isEdit ? (
            <>
              <button
                onClick={onCancelEdit}
                disabled={editSaving}
                style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--muted)", background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                Cancel
              </button>
              <button
                onClick={onSaveEdit}
                disabled={editSaving}
                style={{ padding: "8px 16px", fontSize: 12.5, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", opacity: editSaving ? 0.7 : 1 }}
              >
                {editSaving ? "Saving…" : "Save changes"}
              </button>
            </>
          ) : (
            <button
              onClick={onEnterEdit}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                fontSize: 12.5,
                fontWeight: 600,
                color: "#fff",
                background: "var(--navy)",
                border: "none",
                width: "100%",
                justifyContent: "center",
              }}
            >
              <Pencil size={14} />
              Edit user
            </button>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

const inputStyle: CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 0,
  padding: "6px 8px",
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
};
