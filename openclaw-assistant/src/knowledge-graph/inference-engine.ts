import type { KnowledgeGraph } from "./graph.js";

export type InferenceResult = {
  ok: boolean;
  query: string;
  paths: Array<{ path: string[]; relations: string[] }>;
};

export class InferenceEngine {
  constructor(private readonly graph: KnowledgeGraph) {}

  async infer(params: { query: string; workspaceId?: string; maxDepth?: number }): Promise<InferenceResult> {
    const query = String(params.query ?? "").trim();
    if (!query) return { ok: false, query, paths: [] };
    const paths = await this.graph.reasonIndirectInfluence({
      query,
      workspaceId: params.workspaceId,
      maxDepth: params.maxDepth,
    });
    return { ok: true, query, paths };
  }
}

