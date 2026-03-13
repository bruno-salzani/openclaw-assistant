import type { RetrievalHit } from "./hybrid-search.js";

export type RetrievalContext = {
  hits: RetrievalHit[];
  contextText: string;
};

function fmtMeta(m: any) {
  if (!m || typeof m !== "object") return "";
  const type = typeof m.type === "string" ? m.type : "";
  const source = typeof m.source === "string" ? m.source : "";
  const sessionId = typeof m.sessionId === "string" ? m.sessionId : "";
  const userId = typeof m.userId === "string" ? m.userId : "";
  const parts = [type, source, sessionId, userId].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export function buildRetrievalContext(params: { hits: RetrievalHit[]; maxChars?: number }): RetrievalContext {
  const maxChars = Math.max(200, Math.min(40_000, Number(params.maxChars ?? 16_000)));
  const hits = Array.isArray(params.hits) ? params.hits : [];
  const lines: string[] = [];
  lines.push("[Memory Retrieval]");
  for (let i = 0; i < Math.min(12, hits.length); i += 1) {
    const h = hits[i]!;
    const score = h.score != null ? ` score=${Number(h.score).toFixed(3)}` : "";
    lines.push(`#${i + 1}${score} ${h.source}${fmtMeta(h.metadata)}: ${String(h.content ?? "").slice(0, 1800)}`);
  }
  const contextText = lines.join("\n").slice(0, maxChars);
  return { hits: hits.slice(0, 12), contextText };
}
