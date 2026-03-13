import type { SemanticMemory, MemoryEntry } from "../memory-types.js";
import type { VectorDB } from "../../vector/vector-db.js";

export class VectorStore implements SemanticMemory {
  constructor(private readonly db: VectorDB) {}

  async init() {
    if (typeof this.db.init === "function") await this.db.init();
  }

  async add(content: string, vector: number[], metadata?: Record<string, unknown>): Promise<void> {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      metadata,
      createdAt: Date.now(),
    };
    await this.db.insert({
      id: entry.id,
      text: entry.content,
      embedding: vector,
      metadata: { ...(metadata ?? {}), createdAt: entry.createdAt },
    });
  }

  async search(
    vector: number[],
    limit = 5,
    filter?: Record<string, unknown>
  ): Promise<MemoryEntry[]> {
    const hits = await this.db.search({ query: vector, limit, filter });
    return hits.map((h) => ({
      id: String(h.id),
      content: String(h.text ?? (h.metadata as any)?.content ?? ""),
      metadata: h.metadata,
      createdAt: Number((h.metadata as any)?.createdAt ?? 0),
    }));
  }
}
