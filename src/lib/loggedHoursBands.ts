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

// 2026-09-23 (dynamic expected hours): `loggedHoursTier` used to assume
// every day is a flat 7.5h shift, hardcoding the tier thresholds as raw
// hour counts. That broke the moment a person had an approved half-day
// or full-day time off -- e.g. someone on a half-day (3.75h expected)
// who logged 2.8h read as "Very low" against the full 7.5h scale, when
// really they were AT expected for their actual day. `expectedHours` is
// now a required second input (the caller supplies the person's real
// expected hours for that specific day -- see
// `expectedHoursForDay`/`dailyCapacityHours` in dailyAllocation.ts,
// already the one shared source of truth for half-day/off-day capacity
// used by Utilization/WBS/My Dashboard). Internally this normalizes to
// a percentage-of-expected ratio and applies the SAME percentage bands
// regardless of shift length, so a half-day and a full day read
// consistently. The five-tier percentage bands below are Sandra's
// explicit spec (2026-09-23): <50% / 50-84% / 85-113% / 114-133% / >133%
// -- these replace the earlier hand-picked hour cutoffs (3.75/6.5/8.5/10
// against an implicit 7.5h), which worked out to almost the same ratios
// by coincidence but weren't expressed as percentages.
//
// `expectedHours <= 0` means a full-day approved time off (or a
// holiday) -- Sandra: "the day should not be evaluated as underworked
// ... no productivity color should be applied." That's a DIFFERENT
// case from "off"/no-hours-logged-yet on a normal workday (still
// tiered, unlogged reads as the neutral "off" tier below) -- Time Off
// short-circuits before the ratio math runs at all, and the caller
// decides whether to print "Time Off" or the actual hours (rare: still
// logging hours on a day marked off).
export function loggedHoursTier(hours: number, expectedHours: number): HoursTier {
  if (expectedHours <= 0) return { key: "time_off", label: "Time Off", fg: "var(--muted)", tone: "neutral" };
  if (hours <= 0) return { key: "off", label: "— / Off", fg: "var(--muted)", tone: "neutral" };
  const pct = hours / expectedHours;
  if (pct < 0.5) return { key: "very_low", label: "Very low", bg: "var(--danger-bg)", fg: "var(--danger-text)", tone: "danger" };
  if (pct < 0.85) return { key: "below", label: "Below expected", bg: "var(--warning-bg)", fg: "var(--warning-text)", tone: "warning" };
  if (pct <= 1.13) return { key: "expected", label: "Within expected", bg: "var(--success-bg)", fg: "var(--success-text)", tone: "success" };
  if (pct <= 1.33) return { key: "above", label: "Above expected", bg: "var(--orange-bg)", fg: "var(--orange-text)", tone: "orange" };
  return { key: "excessive", label: "Significantly above", bg: "var(--danger-bg)", fg: "var(--danger-text)", tone: "danger" };
}

// Legend for the bottom of the Daily Activity table / My Logged Hours card.
// Ranges shown here are for a REGULAR 7.5h day, as a reference -- the
// actual tiering (loggedHoursTier) is percentage-of-expected, so an
// approved half-day or reduced day is judged against its own smaller
// expected-hours figure using these same percentage cutoffs, not
// against 7.5h. "Time Off" is its own row: a full-day approved time
// off day is never colored red/amber/green (see loggedHoursTier).
// 2026-09-23 (Sandra: "remove the expected work [percentages] ... let's
// stick with Very Low, Below, Within, Above, Significantly Above --
// remove the arrows in the legend too, having it in the display works
// and is straightforward") -- plain labels only, no % breakdown; arrow
// icons stay on the actual day cells (HoursOverview/MyDashboard) but are
// no longer duplicated in the legend itself.
export const LOGGED_HOURS_LEGEND = [
  { range: "Time Off", label: "Time Off", tone: "neutral" as const },
  { range: "— / Off", label: "No hours logged", tone: "neutral" as const },
  { range: "<3.75h", label: "Very low", tone: "danger" as const },
  { range: "3.75–6.37h", label: "Below expected", tone: "warning" as const },
  { range: "6.38–8.47h", label: "Within expected", tone: "success" as const },
  { range: "8.48–9.97h", label: "Above expected", tone: "orange" as const },
  { range: ">9.97h", label: "Significantly above", tone: "danger" as const },
];
