import type { AgentDeps } from "../agents/agent-deps.js";

export type TopicSubscription = {
  topic: string;
  handler: (payload: any) => Promise<void> | void;
};

export class KnowledgeMesh {
  private subs: Map<string, TopicSubscription[]> = new Map();

  constructor(private readonly deps: AgentDeps) {}

  subscribe(topic: string, handler: TopicSubscription["handler"]) {
    const arr = this.subs.get(topic) ?? [];
    arr.push({ topic, handler });
    this.subs.set(topic, arr);
  }

  async publish(topic: string, payload: any) {
    const arr = this.subs.get(topic) ?? [];
    for (const s of arr) {
      try {
        await s.handler(payload);
      } catch {}
    }
    await this.deps.memory.add("event", "knowledge_mesh_publish", { topic });
  }

  topics() {
    return Array.from(this.subs.keys());
  }
}
