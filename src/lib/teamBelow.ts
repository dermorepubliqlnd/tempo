// 2026-10-14 (Sandra, phase190b): on ongoing containers anyone can add a task
// for themselves, and a supervisor for anyone below them in the reporting line
// (same chain as approvals). This lists who the current person may assign.
export function selfAndTeamBelow(meId: string, people: { id: string; reports_to: string | null }[]): string[] {
  const byId = new Map(people.map((p) => [p.id, p.reports_to]));
  const out: string[] = [meId];
  for (const p of people) {
    if (p.id === meId) continue;
    let cur = byId.get(p.id) ?? null;
    let depth = 0;
    while (cur && depth < 20) {
      if (cur === meId) {
        out.push(p.id);
        break;
      }
      cur = byId.get(cur) ?? null;
      depth++;
    }
  }
  return out;
}
