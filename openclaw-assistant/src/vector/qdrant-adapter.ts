import { QdrantClient } from "@qdrant/js-client-rest";

import type { VectorDB } from "./vector-db.js";

export class QdrantVectorDb implements VectorDB {
  private readonly client: QdrantClient;

  private readonly collection: string;

  private readonly vectorSize: number;

  constructor(params: { url: string; collection: string; vectorSize: number }) {
    this.client = new QdrantClient({ url: params.url });
    this.collection = params.collection;
    this.vectorSize = params.vectorSize;
  }

  async init() {
    const result = await this.client.getCollections();
    const exists = result.collections.some((c) => c.name === this.collection);
    if (!exists) {
      await this.client.createCollection(this.collection, {
        vectors: { size: this.vectorSize, distance: "Cosine" },
      });
    }
  }

  async insert(input: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }) {
    const createdAt = Date.now();
    await this.client.upsert(this.collection, {
      points: [
        {
          id: input.id,
          vector: input.embedding,
          payload: {
            content: input.text,
            ...(input.metadata ?? {}),
            createdAt,
          },
        },
      ],
    });
  }

  async search(input: { query: number[]; limit?: number; filter?: Record<string, unknown> }) {
    const must: any[] = [];
    if (input.filter && typeof input.filter === "object") {
      for (const [k, v] of Object.entries(input.filter)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          must.push({ key: k, match: { value: v } });
        }
      }
    }
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(50, Number(input.limit))) : 5;
    const res = await this.client.search(this.collection, {
      vector: input.query,
      limit,
      with_payload: true,
      ...(must.length > 0 ? { filter: { must } } : {}),
    });
    return res.map((match) => ({
      id: String(match.id),
      score: typeof (match as any).score === "number" ? Number((match as any).score) : undefined,
      text: String(match.payload?.content ?? ""),
      metadata: match.payload as Record<string, unknown>,
    }));
  }
}
