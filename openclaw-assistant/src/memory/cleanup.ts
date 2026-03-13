import type { AgentDeps } from "../agents/agent-deps.js";

export class MemoryCleanup {
  constructor(private readonly deps: AgentDeps) {}

  async run() {
    await this.deps.memory.add("event", "memory_cleanup_run", { ts: Date.now() });
  }
}
