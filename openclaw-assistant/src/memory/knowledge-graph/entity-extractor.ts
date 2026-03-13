import type { LLMProvider } from "../../llm/llm-provider.js";
import type { Entity, Relationship } from "../../knowledge-graph/graph.js";

export type ExtractedEntity = { name: string; type: Entity["type"]; properties?: Record<string, unknown> };

export type ExtractedRelation = { from: string; to: string; type: Relationship["type"] };

export type GraphFacts = {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
};

function normalizeName(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function normalizeEntityType(v: unknown): Entity["type"] {
  const t = String(v ?? "").toLowerCase();
  if (
    t === "person" ||
    t === "tool" ||
    t === "company" ||
    t === "concept" ||
    t === "project" ||
    t === "task" ||
    t === "document" ||
    t === "event"
  )
    return t;
  if (t === "testing tool") return "tool";
  return "concept";
}

function normalizeRelationshipType(v: unknown): Relationship["type"] {
  const t = String(v ?? "").toLowerCase();
  if (
    t === "uses" ||
    t === "works_at" ||
    t === "related_to" ||
    t === "depends_on" ||
    t === "created" ||
    t === "belongs_to" ||
    t === "works_with" ||
    t === "created_by"
  )
    return t;
  if (t === "use" || t === "uses_") return "uses";
  if (t === "works at") return "works_at";
  if (t === "depends on") return "depends_on";
  if (t === "related to") return "related_to";
  return "related_to";
}

function clampFacts(x: GraphFacts): GraphFacts {
  const entities = Array.isArray(x.entities) ? x.entities.slice(0, 24) : [];
  const relations = Array.isArray(x.relations) ? x.relations.slice(0, 48) : [];
  return { entities, relations };
}

function extractHeuristic(text: string): GraphFacts {
  const t = String(text ?? "").trim();
  if (!t) return { entities: [], relations: [] };

  const entities: ExtractedEntity[] = [];
  const relations: ExtractedRelation[] = [];
  const seen = new Set<string>();

  function addEntity(name: string, type: Entity["type"]) {
    const n = normalizeName(name);
    if (!n) return;
    const k = `${type}:${n.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    entities.push({ name: n, type });
  }

  function addRel(from: string, to: string, type: Relationship["type"]) {
    const f = normalizeName(from);
    const toN = normalizeName(to);
    if (!f || !toN) return;
    relations.push({ from: f, to: toN, type });
  }

  const patterns: Array<{
    re: RegExp;
    type: Relationship["type"];
    fromType: Entity["type"];
    toType: Entity["type"];
  }> = [
    {
      re: /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+uses\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\b/g,
      type: "uses",
      fromType: "person",
      toType: "tool",
    },
    {
      re: /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+works\s+at\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\b/g,
      type: "works_at",
      fromType: "person",
      toType: "company",
    },
    {
      re: /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+created\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\b/g,
      type: "created",
      fromType: "person",
      toType: "project",
    },
    {
      re: /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+depends\s+on\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\b/g,
      type: "depends_on",
      fromType: "project",
      toType: "tool",
    },
    {
      re: /\b([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\s+is\s+related\s+to\s+([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})\b/g,
      type: "related_to",
      fromType: "concept",
      toType: "concept",
    },
  ];

  for (const p of patterns) {
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(t))) {
      const from = m[1];
      const to = m[2];
      addEntity(from, p.fromType);
      addEntity(to, p.toType);
      addRel(from, to, p.type);
    }
  }

  return clampFacts({ entities, relations });
}

async function extractWithLlm(text: string, llm: LLMProvider): Promise<GraphFacts | null> {
  const content = String(text ?? "").trim();
  if (!content) return null;
  const system = [
    "Extraia entidades e relações do texto.",
    "Retorne APENAS um JSON válido, sem markdown, sem texto extra.",
    "Formato:",
    "{",
    '  "entities": Array<{ "name": string, "type": "Person"|"Tool"|"Company"|"Concept"|"Project"|"Task"|"Document"|"Event", "properties"?: Record<string, any> }>,',
    '  "relations": Array<{ "from": string, "to": string, "type": "USES"|"WORKS_AT"|"RELATED_TO"|"DEPENDS_ON"|"CREATED" }>',
    "}",
    "Regras:",
    "- Use nomes como aparecem no texto (sem inventar).",
    "- Se não houver relação explícita, retorne arrays vazios.",
    "- Máximo: 24 entities, 48 relations.",
  ].join("\n");
  try {
    const out = await llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      temperature: 0.1,
      maxTokens: 500,
    });
    const parsed = JSON.parse(out) as any;
    const entitiesIn = Array.isArray(parsed?.entities) ? parsed.entities : [];
    const relationsIn = Array.isArray(parsed?.relations) ? parsed.relations : [];

    const entities = entitiesIn
      .map((e: any) => ({
        name: normalizeName(e?.name),
        type: normalizeEntityType(e?.type),
        properties: e?.properties && typeof e.properties === "object" ? e.properties : undefined,
      }))
      .filter((e: any) => Boolean(e.name));
    const relations = relationsIn
      .map((r: any) => ({
        from: normalizeName(r?.from),
        to: normalizeName(r?.to),
        type: normalizeRelationshipType(r?.type),
      }))
      .filter((r: any) => Boolean(r.from && r.to));

    return clampFacts({ entities, relations });
  } catch {
    return null;
  }
}

export async function extractGraphFacts(params: { text: string; llm?: LLMProvider }): Promise<GraphFacts> {
  const enabled = process.env.IA_ASSISTANT_KNOWLEDGE_GRAPH_ENABLE !== "0";
  if (!enabled) return { entities: [], relations: [] };
  const useLlm = Boolean(params.llm) && process.env.IA_ASSISTANT_KNOWLEDGE_GRAPH_LLM_EXTRACT === "1";
  const llmFacts = useLlm ? await extractWithLlm(params.text, params.llm!) : null;
  return llmFacts ?? extractHeuristic(params.text);
}

