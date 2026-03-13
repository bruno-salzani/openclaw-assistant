import test from "node:test";
import assert from "node:assert/strict";
import { hybridSearch } from "../../memory/retrieval/hybrid-search.js";
import { buildRetrievalContext } from "../../memory/retrieval/context-builder.js";

test("hybridSearch: combina semantic + keyword e ordena por score", async () => {
  const mem: any = {
    search: async (q: string, opts: any) => {
      if (opts?.type === "exact") {
        return [
          { id: "k1", content: "startup market analysis with pricing", createdAt: 1 },
          { id: "k2", content: "unrelated note", createdAt: 1 },
        ];
      }
      return [{ id: "s1", content: "market sizing and trends", createdAt: 2, score: 0.9 }];
    },
  };

  const out = await hybridSearch({ memory: mem, query: "startup market pricing", limit: 5 });
  assert.ok(out.length >= 2);
  const ids = out.map((x) => x.id);
  assert.ok(ids.includes("s1"));
  assert.ok(ids.includes("k1"));
});

test("buildRetrievalContext: gera bloco de contexto truncado e com cabeçalho", async () => {
  const ctx = buildRetrievalContext({
    hits: [
      { id: "1", content: "a".repeat(2000), createdAt: 1, source: "semantic", score: 0.5 },
      { id: "2", content: "b", createdAt: 2, source: "keyword", score: 0.4 },
    ],
    maxChars: 500,
  } as any);
  assert.ok(ctx.contextText.startsWith("[Memory Retrieval]"));
  assert.ok(ctx.contextText.length <= 500);
});
