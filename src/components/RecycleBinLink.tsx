// 2026-10-07 (item E): Archive left the members' sidebar; everyone can still
// reach it from the pages where things get moved to Archive.
import { Link } from "react-router-dom";
import { Archive } from "lucide-react";

export default function RecycleBinLink() {
  return (
    <Link
      to="/archive"
      title="Restore things moved to Archive (kept 90 days)"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textDecoration: "none", whiteSpace: "nowrap" }}
    >
      <Archive size={13} /> Recycle bin
    </Link>
  );
}
