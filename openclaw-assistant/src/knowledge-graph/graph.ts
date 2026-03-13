import type { MetricsRegistry } from "../observability/metrics.js";
import type { LLMProvider } from "../llm/llm-provider.js";
import { createHash } from "node:crypto";
import { extractGraphFacts } from "../memory/knowledge-graph/entity-extractor.js";
import { findIndirectInfluence } from "./reasoning.js";

export type Entity = {
  id: string;
  type:
    | "person"
    | "tool"
    | "company"
    | "concept"
    | "project"
    | "task"
    | "document"
    | "event";
  name: string;
  properties: Record<string, unknown>;
};

export type Relationship = {
  source: string;
  target: string;
  type:
    | "uses"
    | "works_at"
    | "related_to"
    | "depends_on"
    | "created"
    | "belongs_to"
    | "works_with"
    | "created_by";
  properties?: Record<string, unknown>;
};

export type KnowledgeGraphStore = {
  upsertGraphNode: (node: Entity, workspaceId?: string) => Promise<void>;
  upsertGraphEdge: (edge: Relationship, workspaceId?: string) => Promise<void>;
  searchGraphNodes: (query: string, limit: number, workspaceId?: string) => Promise<Entity[]>;
  listGraphEdgesFrom: (
    sourceId: string,
    limit: number,
    workspaceId?: string,
    type?: Relationship["type"]
  ) => Promise<Relationship[]>;
  getGraphNodeByTypeName: (
    type: Entity["type"],
    name: string,
    workspaceId?: string
  ) => Promise<Entity | null>;
  getGraphNodesByIds: (ids: string[], workspaceId?: string) => Promise<Entity[]>;
};

function normalizeName(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function stableEntityId(type: Entity["type"], name: string, workspaceId?: string) {
  const ws = String(workspaceId ?? "global");
  const key = `${ws}|${type}|${name.toLowerCase()}`;
  const digest = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return `${type}:${digest}`;
}

export class KnowledgeGraph {
  private readonly nodes = new Map<string, Entity>();

  private readonly edges: Relationship[] = [];

  private readonly metrics: MetricsRegistry;

  private readonly store?: KnowledgeGraphStore;

  constructor(input: MetricsRegistry | { metrics: MetricsRegistry; store?: KnowledgeGraphStore }) {
    if (input && typeof input === "object" && "metrics" in input) {
      this.metrics = (input as any).metrics;
      this.store = (input as any).store;
    } else {
      this.metrics = input as MetricsRegistry;
      this.store = undefined;
    }
  }

  addEntity(entity: Entity) {
    this.nodes.set(entity.id, entity);
    if (this.store) {
      this.store.upsertGraphNode(entity).catch(() => undefined);
    }
  }

  addEdge(edge: Relationship) {
    this.edges.push(edge);
    if (this.store) {
      this.store.upsertGraphEdge(edge).catch(() => undefined);
    }
  }

  async listEdgesFrom(
    entityId: string,
    options?: { limit?: number; workspaceId?: string; type?: Relationship["type"] }
  ): Promise<Relationship[]> {
    const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 20)));
    const type = options?.type;
    if (this.store) {
      return this.store.listGraphEdgesFrom(entityId, limit, options?.workspaceId, type);
    }
    return this.edges
      .filter((e) => e.source === entityId && (!type || e.type === type))
      .slice(-limit)
      .reverse();
  }

  async getNodesByIds(ids: string[], options?: { workspaceId?: string }): Promise<Entity[]> {
    const wanted = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
    if (wanted.length === 0) return [];
    if (this.store) {
      return this.store.getGraphNodesByIds(wanted, options?.workspaceId);
    }
    return wanted.map((id) => this.nodes.get(id)).filter((n): n is Entity => Boolean(n));
  }

  async findRelated(
    entityId: string,
    type?: Relationship["type"],
    options?: { limit?: number; workspaceId?: string }
  ): Promise<Entity[]> {
    const edges = await this.listEdgesFrom(entityId, {
      limit: options?.limit,
      workspaceId: options?.workspaceId,
      type,
    });
    const ids = edges.map((e) => e.target);
    return this.getNodesByIds(ids, { workspaceId: options?.workspaceId });
  }

  async searchEntities(query: string, limit = 5, options?: { workspaceId?: string }): Promise<Entity[]> {
    const lim = Math.max(1, Math.min(100, Number(limit)));
    if (this.store) {
      return this.store.searchGraphNodes(query, lim, options?.workspaceId);
    }
    const q = String(query || "")
      .toLowerCase()
      .trim();
    if (!q) return [];
    const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
    const scored: Array<{ score: number; e: Entity }> = [];
    for (const e of this.nodes.values()) {
      const name = String(e.name ?? "").toLowerCase();
      const props = JSON.stringify(e.properties ?? {}).toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += 5;
        else if (props.includes(t)) score += 1;
      }
      if (score > 0) scored.push({ score, e });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, lim).map((x) => x.e);
  }

  async ingestText(
    text: string,
    options?: { workspaceId?: string; llm?: LLMProvider; source?: string }
  ): Promise<{ entities: Entity[]; relations: Relationship[] }> {
    const enabled = process.env.IA_ASSISTANT_KNOWLEDGE_GRAPH_ENABLE !== "0";
    if (!enabled) return { entities: [], relations: [] };

    const extraction = await extractGraphFacts({ text, llm: options?.llm });
    const ws = options?.workspaceId;

    const entitiesByName = new Map<string, Entity>();
    for (const e of extraction.entities) {
      const name = normalizeName(e.name);
      const type = e.type;
      const id = stableEntityId(type, name, ws);
      const node: Entity = {
        id,
        type,
        name,
        properties: {
          ...(e.properties ?? {}),
          source: options?.source ?? "conversation",
          updatedAt: Date.now(),
        },
      };
      entitiesByName.set(`${type}:${name.toLowerCase()}`, node);
      this.nodes.set(node.id, node);
      if (this.store) await this.store.upsertGraphNode(node, ws);
    }

    const relations: Relationship[] = [];
    for (const r of extraction.relations) {
      const fromName = normalizeName(r.from);
      const toName = normalizeName(r.to);
      const relType = r.type;

      const fromTypeGuess: Entity["type"] =
        relType === "works_at" || relType === "uses" || relType === "created" ? "person" : "concept";
      const toTypeGuess: Entity["type"] =
        relType === "uses"
          ? "tool"
          : relType === "works_at"
            ? "company"
            : relType === "created"
              ? "project"
              : "concept";

      const from =
        entitiesByName.get(`${fromTypeGuess}:${fromName.toLowerCase()}`) ??
        (this.store ? await this.store.getGraphNodeByTypeName(fromTypeGuess, fromName, ws) : null) ??
        ({
          id: stableEntityId(fromTypeGuess, fromName, ws),
          type: fromTypeGuess,
          name: fromName,
          properties: { source: options?.source ?? "conversation", updatedAt: Date.now() },
        } as Entity);

      const to =
        entitiesByName.get(`${toTypeGuess}:${toName.toLowerCase()}`) ??
        (this.store ? await this.store.getGraphNodeByTypeName(toTypeGuess, toName, ws) : null) ??
        ({
          id: stableEntityId(toTypeGuess, toName, ws),
          type: toTypeGuess,
          name: toName,
          properties: { source: options?.source ?? "conversation", updatedAt: Date.now() },
        } as Entity);

      this.nodes.set(from.id, from);
      this.nodes.set(to.id, to);
      if (this.store) {
        await this.store.upsertGraphNode(from, ws);
        await this.store.upsertGraphNode(to, ws);
      }

      const edge: Relationship = {
        source: from.id,
        target: to.id,
        type: relType,
        properties: { source: options?.source ?? "conversation" },
      };
      this.edges.push(edge);
      relations.push(edge);
      if (this.store) await this.store.upsertGraphEdge(edge, ws);
    }

    return { entities: Array.from(entitiesByName.values()), relations };
  }

  async queryTargets(params: {
    fromType: Entity["type"];
    fromName: string;
    relType: Relationship["type"];
    workspaceId?: string;
    limit?: number;
  }): Promise<Entity[]> {
    const ws = params.workspaceId;
    const lim = Math.max(1, Math.min(100, Number(params.limit ?? 20)));
    const fromName = normalizeName(params.fromName);
    if (!fromName) return [];

    const from =
      (this.store ? await this.store.getGraphNodeByTypeName(params.fromType, fromName, ws) : null) ??
      Array.from(this.nodes.values()).find(
        (e) => e.type === params.fromType && e.name.toLowerCase() === fromName.toLowerCase()
      ) ??
      null;
    if (!from) return [];

    const targets = await this.findRelated(from.id, params.relType, { limit: lim, workspaceId: ws });
    return targets.slice(0, lim);
  }

  async reasonIndirectInfluence(params: {
    query: string;
    workspaceId?: string;
    maxDepth?: number;
  }): Promise<Array<{ path: string[]; relations: string[] }>> {
    const ws = params.workspaceId;
    const q = String(params.query ?? "").trim();
    if (!q) return [];
    const hits = await this.searchEntities(q, 3, { workspaceId: ws });
    const start = hits[0];
    if (!start) return [];
    const paths = await findIndirectInfluence({
      graph: this,
      startId: start.id,
      maxDepth: params.maxDepth,
      workspaceId: ws,
    });
    return paths.slice(0, 50).map((p) => ({
      path: p.nodes.map((n) => `${n.type}:${n.name}`),
      relations: p.edges.map((e) => e.type),
    }));
  }
}
