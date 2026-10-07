// 2026-10-07 (phase168): PostgREST returns at most 1,000 rows per request.
// time_entries passed 1,000 counted rows, so pages that loaded them in one
// request silently dropped the newest entries (Spent Hrs showed 0.00).
// Page through with .range() until a short page comes back. The builder
// MUST include a stable .order(...) (ending in a unique column like id).
const PAGE = 1000;
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { data: out, error };
    const rows = (data as T[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out, error: null };
}
