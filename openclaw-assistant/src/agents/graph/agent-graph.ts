import type { AgentContext } from "../types.js";
import type { AgentGraphEdge } from "./edge.js";
import type { AgentGraphNode } from "./node.js";

export type AgentGraphExecuteResult = {
  resultsByNodeId: Record<string, unknown>;
  levels: string[][];
};

export class AgentGraph {
  private readonly nodesById: Map<string, AgentGraphNode>;

  private readonly edges: AgentGraphEdge[];

  constructor(params: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }) {
    this.nodesById = new Map(params.nodes.map((n) => [n.id, n]));
    this.edges = params.edges;
  }

  private computeLevels(): string[][] {
    const depsCount = new Map<string, number>();
    const children = new Map<string, string[]>();
    for (const id of this.nodesById.keys()) depsCount.set(id, 0);
    for (const e of this.edges) {
      if (!this.nodesById.has(e.from)) throw new Error(`Unknown node id: ${e.from}`);
      if (!this.nodesById.has(e.to)) throw new Error(`Unknown node id: ${e.to}`);
      depsCount.set(e.to, (depsCount.get(e.to) ?? 0) + 1);
      children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
    }

    const levels: string[][] = [];
    const roots = [...depsCount.entries()].filter(([, c]) => c === 0).map(([id]) => id);
    if (roots.length === 0 && this.nodesById.size > 0) {
      throw new Error("No roots found (cycle?)");
    }
    if (roots.length) levels.push(roots);

    const remaining = new Map(depsCount);
    const visited = new Set<string>(roots);
    while (true) {
      const last = levels[levels.length - 1] ?? [];
      const nextSet = new Set<string>();
      for (const n of last) {
        for (const c of children.get(n) ?? []) {
          const left = (remaining.get(c) ?? 0) - 1;
          remaining.set(c, left);
          if (left === 0 && !visited.has(c)) {
            visited.add(c);
            nextSet.add(c);
          }
        }
      }
      if (nextSet.size === 0) break;
      levels.push([...nextSet]);
    }

    if (visited.size !== this.nodesById.size) {
      const missing = [...this.nodesById.keys()].filter((id) => !visited.has(id));
      throw new Error(`Graph is not fully connected or has cycles: ${missing.join(", ")}`);
    }

    return levels;
  }

  private inputsFor(nodeId: string, resultsByNodeId: Record<string, unknown>) {
    const deps = this.edges.filter((e) => e.to === nodeId).map((e) => e.from);
    const out: Record<string, unknown> = {};
    for (const d of deps) out[d] = resultsByNodeId[d];
    return out;
  }

  async execute(ctx: AgentContext): Promise<AgentGraphExecuteResult> {
    const levels = this.computeLevels();
    const resultsByNodeId: Record<string, unknown> = {};
    for (const level of levels) {
      const runs = level.map(async (nodeId) => {
        const node = this.nodesById.get(nodeId);
        if (!node) throw new Error(`Unknown node id: ${nodeId}`);
        const inputs = this.inputsFor(nodeId, resultsByNodeId);
        const out = await node.run(ctx, inputs);
        resultsByNodeId[nodeId] = out;
      });
      await Promise.all(runs);
    }
    return { resultsByNodeId, levels };
  }
}
