import type { VectorDB, VectorDbSearchResult } from "./vector-db.js";

export class MilvusVectorDb implements VectorDB {
  constructor(
    private readonly _params: {
      url: string;
      collection: string;
      apiKey?: string;
    }
  ) {}

  async insert(_input: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    throw new Error("Milvus adapter not configured: use local/qdrant/chroma/weaviate/pinecone");
  }

  async search(_input: {
    query: number[];
    limit?: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorDbSearchResult[]> {
    throw new Error("Milvus adapter not configured: use local/qdrant/chroma/weaviate/pinecone");
  }
}
