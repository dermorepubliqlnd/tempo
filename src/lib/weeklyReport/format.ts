import { parseLocalDate } from "../workingDays";
export const fmtMD = (iso: string) => (iso ? parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
