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

export class WeaviateVectorDb implements VectorDB {
  private readonly url: string;

  private readonly className: string;

  private readonly apiKey?: string;

  constructor(params: { url: string; className: string; apiKey?: string }) {
    this.url = params.url.replace(/\/+$/, "");
    this.className = params.className;
    this.apiKey = params.apiKey;
  }

  private headers() {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) h.authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async insert(input: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }) {
    await httpJson(`${this.url}/v1/objects`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        id: String(input.id),
        class: this.className,
        properties: { ...(input.metadata ?? {}), content: String(input.text ?? "") },
        vector: input.embedding,
      }),
    });
  }

  async search(input: { query: number[]; limit?: number; filter?: Record<string, unknown> }) {
    const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(50, Number(input.limit))) : 5;
    const where =
      input.filter && typeof input.filter === "object" && Object.keys(input.filter).length > 0
        ? {
            operator: "And",
            operands: Object.entries(input.filter).map(([path, value]) => ({
              path: [path],
              operator: "Equal",
              ...(typeof value === "string"
                ? { valueString: value }
                : typeof value === "number"
                  ? { valueNumber: value }
                  : typeof value === "boolean"
                    ? { valueBoolean: value }
                    : { valueString: String(value) }),
            })),
          }
        : undefined;

    const query = [
      "{",
      "Get {",
      `${this.className}(`,
      `nearVector: { vector: [${input.query.join(",")}] }`,
      `, limit: ${limit}`,
      where ? `, where: ${JSON.stringify(where)}` : "",
      ") {",
      "content",
      "_additional { id certainty }",
      "}",
      "}",
      "}",
    ]
      .filter(Boolean)
      .join(" ");

    const res = (await httpJson(`${this.url}/v1/graphql`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query }),
    })) as any;
    const rows = res?.data?.Get?.[this.className];
    const arr = Array.isArray(rows) ? rows : [];
    return arr.map((r: any) => ({
      id: String(r?._additional?.id ?? ""),
      score: Number.isFinite(r?._additional?.certainty)
        ? Number(r._additional.certainty)
        : undefined,
      text: typeof r?.content === "string" ? String(r.content) : "",
      metadata: r && typeof r === "object" ? r : undefined,
    }));
  }
}
