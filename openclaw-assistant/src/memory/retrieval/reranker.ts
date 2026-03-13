import type { LLMProvider } from "../../llm/llm-provider.js";
import type { RetrievalHit } from "./hybrid-search.js";
import { tryParseJson } from "../../infra/json.js";

export async function rerank(params: {
  llm?: LLMProvider;
  query: string;
  hits: RetrievalHit[];
  limit: number;
}): Promise<RetrievalHit[]> {
  const hits = Array.isArray(params.hits) ? params.hits.slice() : [];
  const limit = Math.max(1, Math.min(50, Number(params.limit ?? 10)));
  if (hits.length <= 1) return hits.slice(0, limit);

  const enabled = Boolean(params.llm) && process.env.IA_ASSISTANT_MEMORY_RERANKER_LLM === "1";
  if (!enabled || !params.llm) {
    return hits
      .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
      .slice(0, limit);
  }

  const compact = hits.slice(0, 20).map((h, i) => ({
    idx: i,
    id: h.id,
    source: h.source,
    createdAt: h.createdAt,
    content: String(h.content ?? "").slice(0, 800),
  }));

  const req = [
    "Você é um reranker para RAG.",
    "Ordene os itens por relevância para a query.",
    "Retorne APENAS JSON válido:",
    `{"order":[0,1,2]}`,
    "",
    `Query: ${params.query}`,
    "",
    `Items: ${JSON.stringify(compact)}`,
  ].join("\n");

  const out = await params.llm.chat({
    messages: [
      { role: "system", content: "You are a reranker. Output JSON only." },
      { role: "user", content: req },
    ],
    temperature: 0.1,
    maxTokens: 400,
  });

  const parsed = tryParseJson<{ order?: unknown }>(out);
  const order = Array.isArray(parsed?.order) ? (parsed.order as any[]).map((x) => Number(x)) : [];
  const seen = new Set<number>();
  const ranked: RetrievalHit[] = [];
  for (const idx of order) {
    const i = Number(idx);
    if (!Number.isFinite(i) || i < 0 || i >= compact.length) continue;
    if (seen.has(i)) continue;
    seen.add(i);
    ranked.push(hits[i]!);
  }
  for (let i = 0; i < hits.length && ranked.length < limit; i += 1) {
    if (seen.has(i)) continue;
    ranked.push(hits[i]!);
  }
  return ranked.slice(0, limit);
}
