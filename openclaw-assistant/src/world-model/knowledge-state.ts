import type { MemorySystem } from "../memory/memory-system.js";

export type WorldEvent =
  | {
      type: "interaction";
      ts: number;
      sessionId: string;
      userId: string;
      objective: string;
      outcomeOk: boolean;
    }
  | {
      type: "external";
      ts: number;
      source: string;
      payload: Record<string, unknown>;
    };

export type KnowledgeSnapshot = {
  ts: number;
  counters: Record<string, number>;
  recentObjectives: string[];
};

export class KnowledgeState {
  private counters: Record<string, number> = {};

  private recentObjectives: string[] = [];

  private lastTs = Date.now();

  constructor(private readonly deps: { memory: MemorySystem }) {}

  snapshot(): KnowledgeSnapshot {
    return {
      ts: this.lastTs,
      counters: { ...this.counters },
      recentObjectives: this.recentObjectives.slice(0, 20),
    };
  }

  async ingest(evt: WorldEvent) {
    this.lastTs = Date.now();
    if (evt.type === "interaction") {
      this.bump("interaction_total");
      if (evt.outcomeOk) this.bump("interaction_ok_total");
      else this.bump("interaction_fail_total");
      const obj = String(evt.objective ?? "").trim();
      if (obj) {
        this.recentObjectives.unshift(obj.slice(0, 240));
        if (this.recentObjectives.length > 20) this.recentObjectives.pop();
      }
    } else {
      this.bump("external_total");
      this.bump(`external_${String(evt.source ?? "unknown").replace(/[^\w.-]/g, "").slice(0, 32)}_total`);
    }
    await this.persist();
  }

  private bump(key: string) {
    const k = String(key ?? "").trim();
    if (!k) return;
    this.counters[k] = Number(this.counters[k] ?? 0) + 1;
  }

  private async persist() {
    await this.deps.memory.add("meta", JSON.stringify(this.snapshot()), {
      type: "world_model_state",
      ts: Date.now(),
    });
  }
}

