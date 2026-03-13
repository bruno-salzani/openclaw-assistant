import type { VectorDB } from "./vector-db.js";
import { LocalVectorDb } from "./local-adapter.js";
import { QdrantVectorDb } from "./qdrant-adapter.js";
import { ChromaVectorDb } from "./chroma-adapter.js";
import { WeaviateVectorDb } from "./weaviate-adapter.js";
import { PineconeVectorDb } from "./pinecone-adapter.js";

function envNum(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export async function getVectorDB(): Promise<VectorDB> {
  const kind = String(process.env.VECTOR_DB ?? "qdrant").toLowerCase();
  const collection = String(
    process.env.VECTOR_DB_COLLECTION ??
      process.env.OPENCLAW_X_QDRANT_COLLECTION ??
      "openclaw_memory"
  );
  const vectorSize = envNum("VECTOR_DB_DIM", 1536);

  if (kind === "local") return new LocalVectorDb();

  if (kind === "qdrant") {
    const url = String(process.env.VECTOR_DB_URL ?? process.env.OPENCLAW_X_QDRANT_URL ?? "");
    if (!url.trim()) return new LocalVectorDb();
    const db = new QdrantVectorDb({ url, collection, vectorSize });
    await db.init();
    return db;
  }

  if (kind === "chroma") {
    const url = String(process.env.CHROMA_URL ?? process.env.VECTOR_DB_URL ?? "");
    if (!url.trim()) return new LocalVectorDb();
    const db = new ChromaVectorDb({ url, collection });
    await db.init();
    return db;
  }

  if (kind === "weaviate") {
    const url = String(process.env.WEAVIATE_URL ?? process.env.VECTOR_DB_URL ?? "");
    const className = String(process.env.WEAVIATE_CLASS ?? process.env.VECTOR_DB_CLASS ?? "Memory");
    if (!url.trim()) return new LocalVectorDb();
    const apiKey = process.env.WEAVIATE_API_KEY ? String(process.env.WEAVIATE_API_KEY) : undefined;
    return new WeaviateVectorDb({ url, className, apiKey });
  }

  if (kind === "pinecone") {
    const apiKey = String(process.env.PINECONE_API_KEY ?? "");
    const indexHost = String(process.env.PINECONE_INDEX_HOST ?? "");
    const namespace = process.env.PINECONE_NAMESPACE
      ? String(process.env.PINECONE_NAMESPACE)
      : undefined;
    if (!apiKey.trim() || !indexHost.trim()) return new LocalVectorDb();
    return new PineconeVectorDb({ apiKey, indexHost, namespace });
  }

  if (kind === "milvus") {
    const url = String(process.env.MILVUS_URL ?? "");
    if (url.trim())
      console.warn(
        "[VectorDB] MILVUS_URL set but Milvus REST adapter is not enabled; using LocalVectorDb"
      );
    return new LocalVectorDb();
  }

  return new LocalVectorDb();
}
