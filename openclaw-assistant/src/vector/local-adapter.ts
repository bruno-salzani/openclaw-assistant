import type { VectorDB, VectorDbSearchResult } from "./vector-db.js";

type Entry = {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
};

function cosineSimilarity(a: number[], b: number[]) {
  const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  const denom = magA * magB;
  return denom === 0 ? 0 : dotProduct / denom;
}

export class LocalVectorDb implements VectorDB {
  private readonly store: Entry[] = [];

  async insert(input: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }) {
    const entry: Entry = {
      id: String(input.id),
      text: String(input.text ?? ""),
      embedding: Array.isArray(input.embedding) ? input.embedding.map(Number) : [],
      metadata: input.metadata,
    };
    this.store.push(entry);
  }

  async search(input: {
    query: number[];
    limit?: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorDbSearchResult[]> {
    const query = Array.isArray(input.query) ? input.query.map(Number) : [];
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(50, Number(input.limit))) : 5;
    const filter = input.filter && typeof input.filter === "object" ? input.filter : undefined;
    const scored = this.store
      .filter((e) => {
        if (!filter) return true;
        const meta = e.metadata ?? {};
        for (const [k, v] of Object.entries(filter)) {
          if ((meta as any)[k] !== v) return false;
        }
        return true;
      })
      .map((e) => ({ e, score: cosineSimilarity(query, e.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored.map(({ e, score }) => ({
      id: e.id,
      score,
      text: e.text,
      metadata: e.metadata,
    }));
  }
}
