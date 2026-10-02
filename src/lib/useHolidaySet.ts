import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { buildHolidaySet, type HolidaySet } from "./workingDays";

// Loads the Holiday Calendar once for pages that don't already fetch it.
export function useHolidaySet(): HolidaySet {
  const [set, setSet] = useState<HolidaySet>(new Set());
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("holidays")
      .select("date")
      .then(({ data }) => {
        if (!cancelled) setSet(buildHolidaySet(((data as { date: string }[]) ?? []).map((h) => h.date)));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return set;
}
