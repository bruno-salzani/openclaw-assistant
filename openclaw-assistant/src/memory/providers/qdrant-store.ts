import type { SemanticMemory, MemoryEntry } from "../memory-types.js";
import { QdrantClient } from "@qdrant/js-client-rest";

export class QdrantStore implements SemanticMemory {
  private client: QdrantClient | null = null;

  private readonly collection: string;

  private readonly localStore: { vector: number[]; entry: MemoryEntry }[] = [];

  constructor(url?: string, collection = "openclaw_memory") {
    this.collection = collection;
    if (url) {
      this.client = new QdrantClient({ url });
    }
  }

  async init() {
    if (this.client) {
      const result = await this.client.getCollections();
      const exists = result.collections.some((c) => c.name === this.collection);
      if (!exists) {
        await this.client.createCollection(this.collection, {
          vectors: { size: 1536, distance: "Cosine" }, // OpenAI embedding size
        });
      }
    }
  }

  async add(content: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      metadata,
      createdAt: Date.now(),
    };

    if (this.client) {
      await this.client.upsert(this.collection, {
        points: [
          {
            id: entry.id,
            vector,
            payload: { content, ...metadata, createdAt: entry.createdAt },
          },
        ],
      });
    } else {
      this.localStore.push({ vector, entry });
    }
  }

  async search(
    vector: number[],
    limit = 5,
    filter?: Record<string, unknown>
  ): Promise<MemoryEntry[]> {
    if (this.client) {
      const must: any[] = [];
      if (filter && typeof filter === "object") {
        for (const [k, v] of Object.entries(filter)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
            must.push({ key: k, match: { value: v } });
          }
        }
      }
      const res = await this.client.search(this.collection, {
        vector,
        limit,
        with_payload: true,
        ...(must.length > 0 ? { filter: { must } } : {}),
      });
      return res.map((match) => ({
        id: String(match.id),
        content: String(match.payload?.content ?? ""),
        metadata: match.payload as Record<string, unknown>,
        createdAt: Number(match.payload?.createdAt ?? 0),
      }));
    } else {
      // Simple cosine similarity scan
      return this.localStore
        .filter((x) => {
          if (!filter || typeof filter !== "object") return true;
          const meta = x.entry.metadata ?? {};
          for (const [k, v] of Object.entries(filter)) {
            if ((meta as any)[k] !== v) return false;
          }
          return true;
        })
        .map((item) => ({
          item,
          score: this.cosineSimilarity(vector, item.vector),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.item.entry);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magA * magB);
  }
}
