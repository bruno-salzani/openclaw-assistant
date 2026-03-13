import type { VectorDB } from "./vector-db.js";

async function httpJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export class PineconeVectorDb implements VectorDB {
  constructor(
    private readonly params: {
      indexHost: string;
      apiKey: string;
      namespace?: string;
    }
  ) {}

  async insert(input: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }) {
    const host = this.params.indexHost.replace(/\/+$/, "");
    await httpJson(`${host}/vectors/upsert`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": this.params.apiKey,
      },
      body: JSON.stringify({
        vectors: [
          {
            id: String(input.id),
            values: input.embedding,
            metadata: { ...(input.metadata ?? {}), content: String(input.text ?? "") },
          },
        ],
        namespace: this.params.namespace,
      }),
    });
  }

  async search(input: { query: number[]; limit?: number; filter?: Record<string, unknown> }) {
    const host = this.params.indexHost.replace(/\/+$/, "");
    const topK = Number.isFinite(input.limit) ? Math.max(1, Math.min(50, Number(input.limit))) : 5;
    const res = (await httpJson(`${host}/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": this.params.apiKey,
      },
      body: JSON.stringify({
        vector: input.query,
        topK,
        includeMetadata: true,
        filter: input.filter && typeof input.filter === "object" ? input.filter : undefined,
        namespace: this.params.namespace,
      }),
    })) as any;
    const matches = Array.isArray(res?.matches) ? res.matches : [];
    return matches.map((m: any) => ({
      id: String(m?.id ?? ""),
      score: Number.isFinite(m?.score) ? Number(m.score) : undefined,
      text: typeof m?.metadata?.content === "string" ? String(m.metadata.content) : "",
      metadata: m?.metadata && typeof m.metadata === "object" ? m.metadata : undefined,
    }));
  }
}
