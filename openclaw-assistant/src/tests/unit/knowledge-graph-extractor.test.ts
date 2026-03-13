import test from "node:test";
import assert from "node:assert/strict";
import { extractGraphFacts } from "../../memory/knowledge-graph/entity-extractor.js";
import { buildRelations } from "../../memory/knowledge-graph/relation-builder.js";

test("KnowledgeGraph extractor: finds entities and relations", async () => {
  const out = await extractGraphFacts({ text: "Bruno uses Cypress for testing" });
  assert.ok(out.entities.some((e) => e.name === "Bruno" && e.type === "person"));
  assert.ok(out.entities.some((e) => e.name === "Cypress" && e.type === "tool"));
  assert.ok(out.relations.some((r) => r.from === "Bruno" && r.to === "Cypress" && r.type === "uses"));
});

test("KnowledgeGraph relation builder: returns relations from text", async () => {
  const rels = await buildRelations({ text: "Bruno uses Cypress for testing" });
  assert.ok(rels.some((r) => r.from === "Bruno" && r.to === "Cypress" && r.type === "uses"));
});

