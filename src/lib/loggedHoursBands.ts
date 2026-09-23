// Sandra's 6-tier logged-hours band system (phase64, 2026-09-23), replacing
// the old 4-tier hoursShiftTone (neutral/success/warning/danger) that lived
// duplicated in HoursOverview.tsx (Daily Activity) and MyDashboard.tsx (My
// Logged Hours This Week). The old bands had a real bug, not just a look
// Sandra wanted changed: `ratio <= 1` covered EVERYTHING from a bare 0.1h up
// to a full 7.5h shift as "success" (green) -- so someone who logged almost
// nothing on a work day read exactly the same as someone who logged a full
// shift. Splitting the "at or under a shift" range into Very low / Below
// expected / Within expected fixes that, and mirrors the same reasoning as
// utilizationBands.ts's 6-tier split (High vs Full).
//
// "-- / Off" (no hours expected or none logged yet) is intentionally NOT
// part of this scale -- callers keep deciding that case themselves (a
// weekend/holiday/day-off cell, or simply hasValue===false for a day
// nothing's been logged on yet), same as before. This module only tiers
// hours>0.
//
// Sandra explicitly asked for the SAME red family on both extremes ("the
// numbers themselves tell the approver whether the issue is too little or
// too much") -- Very low and Significantly above both resolve to
// --danger-bg/--danger-text.

export interface HoursTier {
  key: string;
  label: string;
  bg?: string;
  fg: string;
  tone: "neutral" | "danger" | "warning" | "success" | "orange";
}

export function loggedHoursTier(hours: number): HoursTier {
  if (hours <= 0) return { key: "off", label: "— / Off", fg: "var(--muted)", tone: "neutral" };
  if (hours < 3.75) return { key: "very_low", label: "Very low", bg: "var(--danger-bg)", fg: "var(--danger-text)", tone: "danger" };
  if (hours < 6.5) return { key: "below", label: "Below expected", bg: "var(--warning-bg)", fg: "var(--warning-text)", tone: "warning" };
  if (hours <= 8.5) return { key: "expected", label: "Within expected", bg: "var(--success-bg)", fg: "var(--success-text)", tone: "success" };
  if (hours <= 10) return { key: "above", label: "Above expected", bg: "var(--orange-bg)", fg: "var(--orange-text)", tone: "orange" };
  return { key: "excessive", label: "Significantly above", bg: "var(--danger-bg)", fg: "var(--danger-text)", tone: "danger" };
}

// Legend for the bottom of the Daily Activity table / My Logged Hours card.
// A 7.5h shift (+-1h) is the reference "Within expected" band; ranges below
// match the branches above exactly.
export const LOGGED_HOURS_LEGEND = [
  { range: "— / Off", label: "No hours expected/logged", tone: "neutral" as const },
  { range: "<3.75h", label: "Very low", tone: "danger" as const },
  { range: "3.75–6.49h", label: "Below expected", tone: "warning" as const },
  { range: "6.5–8.5h", label: "Within expected", tone: "success" as const },
  { range: "8.51–10h", label: "Above expected", tone: "orange" as const },
  { range: ">10h", label: "Significantly above", tone: "danger" as const },
];
