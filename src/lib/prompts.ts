// 2026-10-07 (Sandra): one standard for every pop-up.
//   Title: up to 6 words, says what is happening ("Move 3 tasks to Archive?").
//   Message: one sentence, up to ~25 words, what will happen / what to do.
//   items: a short list (ConfirmDialog shows 5, then "and N more").
//   Buttons say the action ("Move to Archive", "Keep editing"), not OK/Confirm.
//   Errors: plain words + what to do; raw database text goes in `details`.
//   No "--", no internal terms (baseline lock, RPC, row, etc.).
import type { AlertOptions } from "./useConfirm";

type ErrLike = { message?: string } | string | null | undefined;

const TECHNICAL = /(violates|constraint|column|relation|syntax|null value|PGRST|function|operator|permission denied for|invalid input|uuid|record "new"|duplicate key)/i;

function sentence(text: string): string {
  let t = text.trim().replace(/\s+--\s+/g, ". ").replace(/\s+/g, " ");
  if (!t) return t;
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

/** "Couldn't <action>" with a plain message; technical text moved to details. */
export function friendlyError(action: string, err: ErrLike): AlertOptions {
  const raw = (typeof err === "string" ? err : err?.message) ?? "";
  let message: string;
  if (/row-level security|permission denied|not authorized/i.test(raw)) {
    message = "You don't have permission to do this. Ask your supervisor or a Full Access user if you think you should.";
  } else if (/failed to fetch|network|timeout|load failed/i.test(raw)) {
    message = "Tempo couldn't reach the server. Check your connection and try again.";
  } else if (/jwt|session|refresh token/i.test(raw)) {
    message = "Your session has expired. Sign in again, then retry.";
  } else if (/duplicate key|already exists/i.test(raw)) {
    message = "This already exists. Check for a duplicate before trying again.";
  } else if (!raw) {
    message = "Something went wrong. Please try again.";
  } else if (TECHNICAL.test(raw)) {
    message = "Something went wrong while saving. Please try again, or send the details below to Sandra.";
  } else {
    // Our own database messages are already written for people.
    return { title: `Couldn't ${action}`, message: sentence(raw) };
  }
  return { title: `Couldn't ${action}`, message, details: raw || undefined };
}
