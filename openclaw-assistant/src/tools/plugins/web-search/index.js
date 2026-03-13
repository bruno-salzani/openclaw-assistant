export async function handler(input) {
  const query = String(input?.query ?? "");
  if (!query.trim()) return { ok: false, error: "query is required" };
  return { ok: true, query, results: [] };
}
