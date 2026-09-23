// Logged-hours band system for a standard 7.5-hour workday, shared by
// every place logged hours are shown or evaluated -- Daily Activity
// (HoursOverview.tsx), My Logged Hours This Week + My Work Today
// (MyDashboard.tsx), and the Today's Logs/This Week KPI cards
// (TimeTracking.tsx). Centralized here specifically so all of those
// stay in sync automatically -- see the "How to apply" note at the
// bottom of this file's history in memory for why that matters.
//
// 2026-09-23 (Sandra's "Time Log Status Colors" brief) -- REVISES the
// earlier same-red-both-extremes design: "use red only for
// significantly high hours, not low hours -- low hours should use blue
// shades so users can immediately distinguish under-logging from
// overwork" and "do not label low hours as unproductive, this is only
// a comparison of logged hours vs expected hours." Both callers'
// up/down arrow cues are UNCHANGED (still `colors.key === "very_low"` /
// `"excessive"`) and already render in `currentColor`/`colors.fg`, so
// they automatically pick up whatever font color each tier uses here --
// no separate arrow-color logic needed.
//
// `expectedHours` is a required second input (the caller's own
// expectedHoursForDay/dailyCapacityHours result) so this is always a
// percentage-of-expected ratio, never a hardcoded 7.5h assumption --
// that's also what makes weekly/multi-day views proportional for free:
// pass a week's total logged hours against its own total expected
// hours (sum of each scheduled day's own expected hours, e.g. 3
// scheduled days -> 3 x 7.5h, not a flat 37.5h) and the exact same
// bands apply. Sandra's own example -- a normal 5-day week's "Within
// Expected" range of 32.5-42.5h (+/-1h/day) -- is exactly this ratio
// system already: 32.5/37.5 = 86.67%, 42.5/37.5 = 113.33%, the same
// boundary fractions as the single-day 6.5h/8.5h cutoffs below.
//
// `expectedHours <= 0` means a full-day approved time off (or a
// holiday) -- Sandra: "the day should not be evaluated as underworked
// ... no productivity color should be applied." That's a DIFFERENT
// case from "off"/no-hours-logged-yet on a normal workday (still
// tiered, unlogged reads as the neutral "off" tier below) -- Time Off
// short-circuits before the ratio math runs at all, and the caller
// decides whether to print "Time Off" or the actual hours (rare: still
// logging hours on a day marked off).

export interface HoursTier {
  key: string;
  label: string;
  bg?: string;
  fg: string;
  tone: "neutral" | "danger" | "warning" | "success" | "blue" | "skyblue";
}

// Boundary fractions of expected hours, expressed as exact ratios of
// Sandra's 7.5h-day example (3.75/7.5, 6.5/7.5, 8.5/7.5, 10/7.5) so the
// same cutoffs hold at ANY expected-hours figure, not just 7.5h.
const VERY_LOW_MAX = 0.5; // <3.75h of a 7.5h day
const BELOW_MAX = 6.5 / 7.5; // <6.5h -- Below Expected upper edge
const WITHIN_MAX = 8.5 / 7.5; // <=8.5h -- Within Expected upper edge
const ABOVE_MAX = 10 / 7.5; // <=10h -- Above Expected upper edge

export function loggedHoursTier(hours: number, expectedHours: number): HoursTier {
  if (expectedHours <= 0) return { key: "time_off", label: "Not Evaluated", fg: "var(--muted)", tone: "neutral" };
  if (hours <= 0) return { key: "off", label: "— / Off", fg: "var(--muted)", tone: "neutral" };
  const pct = hours / expectedHours;
  if (pct < VERY_LOW_MAX) return { key: "very_low", label: "Very Low", bg: "var(--blue-bg)", fg: "var(--blue-text)", tone: "blue" };
  if (pct < BELOW_MAX) return { key: "below", label: "Below Expected", bg: "var(--skyblue-bg)", fg: "var(--skyblue-text)", tone: "skyblue" };
  if (pct <= WITHIN_MAX) return { key: "expected", label: "Within Expected", bg: "var(--success-bg)", fg: "var(--success-text)", tone: "success" };
  if (pct <= ABOVE_MAX) return { key: "above", label: "Above Expected", bg: "var(--warning-bg)", fg: "var(--warning-text)", tone: "warning" };
  return { key: "excessive", label: "Significantly Above", bg: "var(--danger-bg)", fg: "var(--danger-text)", tone: "danger" };
}

// Legend for the bottom of the Daily Activity table / My Logged Hours
// card. Ranges shown here are for a REGULAR 7.5h day, as a reference --
// the actual tiering (loggedHoursTier) is percentage-of-expected, so an
// approved half-day or reduced day (or a multi-day week) is judged
// against its own expected-hours figure using these same percentage
// cutoffs, not against a flat 7.5h/37.5h assumption.
export const LOGGED_HOURS_LEGEND = [
  { range: "Time Off", label: "Not Evaluated", tone: "neutral" as const },
  { range: "— / Off", label: "No hours logged", tone: "neutral" as const },
  { range: "<3.75h", label: "Very Low", tone: "blue" as const },
  { range: "3.75–6.49h", label: "Below Expected", tone: "skyblue" as const },
  { range: "6.5–8.5h", label: "Within Expected", tone: "success" as const },
  { range: "8.51–10h", label: "Above Expected", tone: "warning" as const },
  { range: ">10h", label: "Significantly Above", tone: "danger" as const },
];
