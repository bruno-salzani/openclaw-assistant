import type { VectorDB } from "./vector-db.js";

type ChromaCollection = { id: string; name: string };

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

export class ChromaVectorDb implements VectorDB {
  private readonly url: string;

  private readonly collection: string;

  private collectionId: string | null = null;

  constructor(params: { url: string; collection: string }) {
    this.url = params.url.replace(/\/+$/, "");
    this.collection = params.collection;
  }

  private async ensureCollectionId() {
    if (this.collectionId) return this.collectionId;
    const list = (await httpJson(`${this.url}/api/v1/collections`, { method: "GET" })) as
      | ChromaCollection[]
      | null;
    const found = Array.isArray(list) ? list.find((c) => c?.name === this.collection) : undefined;
    if (found?.id) {
      this.collectionId = String(found.id);
      return this.collectionId;
    }
    const created = (await httpJson(`${this.url}/api/v1/collections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: this.collection, metadata: {} }),
    })) as ChromaCollection | null;
    if (!created?.id) throw new Error("Chroma collection create failed");
    this.collectionId = String(created.id);
    return this.collectionId;
  }

  async init() {
    await this.ensureCollectionId();
  }

  async insert(input: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }) {
    const id = await this.ensureCollectionId();
    await httpJson(`${this.url}/api/v1/collections/${encodeURIComponent(id)}/add`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ids: [String(input.id)],
        embeddings: [input.embedding],
        documents: [String(input.text ?? "")],
        metadatas: [input.metadata ?? {}],
      }),
    });
  }

  async search(input: { query: number[]; limit?: number; filter?: Record<string, unknown> }) {
    const id = await this.ensureCollectionId();
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(50, Number(input.limit))) : 5;
    const res = (await httpJson(`${this.url}/api/v1/collections/${encodeURIComponent(id)}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query_embeddings: [input.query],
        n_results: limit,
        where: input.filter && typeof input.filter === "object" ? input.filter : undefined,
        include: ["metadatas", "documents", "distances"],
      }),
    })) as any;

    const ids = Array.isArray(res?.ids?.[0]) ? res.ids[0] : [];
    const docs = Array.isArray(res?.documents?.[0]) ? res.documents[0] : [];
    const metas = Array.isArray(res?.metadatas?.[0]) ? res.metadatas[0] : [];
    const distances = Array.isArray(res?.distances?.[0]) ? res.distances[0] : [];

    return ids.map((rid: any, i: number) => ({
      id: String(rid),
      score: Number.isFinite(distances[i]) ? 1 - Number(distances[i]) : undefined,
      text: typeof docs[i] === "string" ? docs[i] : "",
      metadata: metas[i] && typeof metas[i] === "object" ? metas[i] : undefined,
    }));
  }
}
