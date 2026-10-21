import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// 2026-10-06: the preview build (dermorepubliqlnd.github.io/tempo/preview/)
// shares the live database. It tags every request so database rules staged
// "preview only" (e.g. Draft task privacy before go-live) apply there only.
export const IS_PREVIEW = import.meta.env.VITE_TEMPO_CHANNEL === "preview";

// 2026-10-21: never reuse a browser-cached API response. A PostgREST error
// (300 "more than one relationship") was cached by Chrome and kept Time
// Tracking empty after the database was already fixed.
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: noStoreFetch,
    ...(IS_PREVIEW ? { headers: { "x-tempo-channel": "preview" } } : {}),
  },
});
