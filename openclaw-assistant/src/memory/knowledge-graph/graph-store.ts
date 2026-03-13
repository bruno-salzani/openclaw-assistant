import type { Entity, Relationship, KnowledgeGraphStore } from "../../knowledge-graph/graph.js";

export type GraphStore = KnowledgeGraphStore;

export class GraphStoreFacade {
  constructor(private readonly store: GraphStore, private readonly workspaceId?: string) {}

  upsertEntity(entity: Entity) {
    return this.store.upsertGraphNode(entity, this.workspaceId);
  }

  upsertRelation(edge: Relationship) {
    return this.store.upsertGraphEdge(edge, this.workspaceId);
  }

  searchEntities(query: string, limit: number) {
    return this.store.searchGraphNodes(query, limit, this.workspaceId);
  }

  listRelationsFrom(sourceId: string, limit: number, type?: Relationship["type"]) {
    return this.store.listGraphEdgesFrom(sourceId, limit, this.workspaceId, type);
  }

  getEntityByTypeName(type: Entity["type"], name: string) {
    return this.store.getGraphNodeByTypeName(type, name, this.workspaceId);
  }

  getEntitiesByIds(ids: string[]) {
    return this.store.getGraphNodesByIds(ids, this.workspaceId);
  }
}

