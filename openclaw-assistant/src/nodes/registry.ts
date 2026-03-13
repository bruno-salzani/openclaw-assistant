export type NodeInfo = {
  id: string;
  address: string;
  capabilities: string[];
  lastSeen: number;
};

export class NodeRegistry {
  private nodes = new Map<string, NodeInfo>();

  register(node: NodeInfo) {
    this.nodes.set(node.id, node);
  }

  heartbeat(id: string) {
    const n = this.nodes.get(id);
    if (n) this.nodes.set(id, { ...n, lastSeen: Date.now() });
  }

  list() {
    return Array.from(this.nodes.values());
  }

  byCapability(cap: string) {
    return this.list().filter((n) => n.capabilities.includes(cap));
  }
}
