import test from "node:test";
import assert from "node:assert/strict";

import { LocalVectorDb } from "../../vector/local-adapter.js";
import { VectorStore } from "../../memory/providers/vector-store.js";
import { getVectorDB } from "../../vector/vector-router.js";

test("VectorStore(LocalVectorDb): insert/search works", async () => {
  const db = new LocalVectorDb();
  const store = new VectorStore(db);
  await store.init();
  await store.add("a", [1, 0], { workspaceId: "w1" });
  await store.add("b", [0, 1], { workspaceId: "w1" });
  const res = await store.search([1, 0], 1, { workspaceId: "w1" });
  assert.equal(res.length, 1);
  assert.equal(res[0].content, "a");
});

test("getVectorDB: VECTOR_DB=local returns LocalVectorDb", async () => {
  const prev = process.env.VECTOR_DB;
  process.env.VECTOR_DB = "local";
  try {
    const db = await getVectorDB();
    assert.equal(db instanceof LocalVectorDb, true);
  } finally {
    if (prev === undefined) delete process.env.VECTOR_DB;
    else process.env.VECTOR_DB = prev;
  }
});

test("getVectorDB: qdrant without url falls back to LocalVectorDb", async () => {
  const prevKind = process.env.VECTOR_DB;
  const prevUrl = process.env.VECTOR_DB_URL;
  const prevQdrant = process.env.OPENCLAW_X_QDRANT_URL;
  process.env.VECTOR_DB = "qdrant";
  delete process.env.VECTOR_DB_URL;
  delete process.env.OPENCLAW_X_QDRANT_URL;
  try {
    const db = await getVectorDB();
    assert.equal(db instanceof LocalVectorDb, true);
  } finally {
    if (prevKind === undefined) delete process.env.VECTOR_DB;
    else process.env.VECTOR_DB = prevKind;
    if (prevUrl === undefined) delete process.env.VECTOR_DB_URL;
    else process.env.VECTOR_DB_URL = prevUrl;
    if (prevQdrant === undefined) delete process.env.OPENCLAW_X_QDRANT_URL;
    else process.env.OPENCLAW_X_QDRANT_URL = prevQdrant;
  }
});
