import type { MemoryEntry } from "../memory-types.js";
import type { MemorySystem } from "../memory-system.js";

export type RetrievalHit = MemoryEntry & {
  source: "semantic" | "keyword";
  score?: number;
};

function tokenize(q: string) {
  return String(q ?? "")
    .toLowerCase()
    .split(/[^a-z0-9À-ÿ]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 40);
}

function keywordScore(query: string, text: string) {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  const hay = String(text ?? "").toLowerCase();
  let hits = 0;
  for (const tok of q) if (hay.includes(tok)) hits += 1;
  return hits / q.length;
}

export async function hybridSearch(params: {
  memory: Pick<MemorySystem, "search">;
  query: string;
  limit: number;
  workspaceId?: string;
  userId?: string;
}): Promise<RetrievalHit[]> {
  const semanticLimit = Math.max(1, Math.min(50, Math.round(params.limit)));
  const keywordLimit = Math.max(1, Math.min(50, Math.round(params.limit)));
  const keywordEnabled = process.env.IA_ASSISTANT_MEMORY_KEYWORD_SEARCH !== "0";

  const [semantic, keyword] = await Promise.all([
    params.memory.search(params.query, {
      limit: semanticLimit,
      workspaceId: params.workspaceId,
      userId: params.userId,
    }),
    keywordEnabled
      ? params.memory.search(params.query, {
          type: "exact",
          limit: keywordLimit,
          workspaceId: params.workspaceId,
          userId: params.userId,
        })
      : Promise.resolve([] as MemoryEntry[]),
  ]);

  const byKey = new Map<string, RetrievalHit>();
  for (const m of semantic) {
    const id = String(m.id ?? "");
    const key = id || String(m.content ?? "").slice(0, 160);
    byKey.set(key, { ...m, source: "semantic", score: typeof (m as any).score === "number" ? (m as any).score : undefined });
  }
  for (const m of keyword) {
    const id = String(m.id ?? "");
    const key = id || String(m.content ?? "").slice(0, 160);
    const prev = byKey.get(key);
    const score = keywordScore(params.query, m.content);
    if (!prev) byKey.set(key, { ...m, source: "keyword", score });
    else byKey.set(key, { ...prev, score: Math.max(prev.score ?? 0, score) });
  }

  return Array.from(byKey.values())
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, Math.max(1, Math.min(50, params.limit)));
}

