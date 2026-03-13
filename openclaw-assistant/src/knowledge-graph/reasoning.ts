import type { KnowledgeGraph, Relationship, Entity } from "./graph.js";

export type InfluencePath = {
  nodes: Entity[];
  edges: Relationship[];
};

export async function findIndirectInfluence(params: {
  graph: KnowledgeGraph;
  startId: string;
  maxDepth?: number;
  workspaceId?: string;
  edgeLimitPerNode?: number;
}): Promise<InfluencePath[]> {
  const maxDepth = Math.max(1, Math.min(6, Number(params.maxDepth ?? 3)));
  const edgeLimitPerNode = Math.max(1, Math.min(200, Number(params.edgeLimitPerNode ?? 40)));
  const startId = String(params.startId ?? "").trim();
  if (!startId) return [];

  const visited = new Set<string>([startId]);
  const queue: Array<{ nodeId: string; depth: number; path: Array<{ nodeId: string; edge?: Relationship }> }> = [
    { nodeId: startId, depth: 0, path: [{ nodeId: startId }] },
  ];
  const paths: InfluencePath[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.depth >= maxDepth) continue;
    const edges = await params.graph.listEdgesFrom(cur.nodeId, {
      workspaceId: params.workspaceId,
      limit: edgeLimitPerNode,
    });
    for (const e of edges) {
      const nextId = String(e.target ?? "");
      if (!nextId) continue;
      const nextPath = [...cur.path, { nodeId: nextId, edge: e }];
      if (!visited.has(nextId)) visited.add(nextId);
      if (nextPath.length >= 2) {
        const nodeIds = nextPath.map((x) => x.nodeId);
        const nodes = await params.graph.getNodesByIds(nodeIds, { workspaceId: params.workspaceId });
        const nodesById = new Map(nodes.map((n) => [n.id, n]));
        const orderedNodes = nodeIds.map((id) => nodesById.get(id)).filter(Boolean) as Entity[];
        const orderedEdges = nextPath.map((x) => x.edge).filter(Boolean) as Relationship[];
        paths.push({ nodes: orderedNodes, edges: orderedEdges });
      }
      if (cur.depth + 1 < maxDepth) {
        queue.push({ nodeId: nextId, depth: cur.depth + 1, path: nextPath });
      }
    }
  }

  return paths.slice(0, 200);
}

