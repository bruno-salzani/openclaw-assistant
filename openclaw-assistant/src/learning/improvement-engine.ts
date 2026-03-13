import fs from "node:fs";
import path from "node:path";
import type { EventBus } from "../infra/event-bus.js";
import type { MemorySystem } from "../memory/memory-system.js";
import { ExperienceCollector } from "./experience-collector.js";
import { analyzeExperiences } from "./failure-analyzer.js";
import { buildDataset } from "./dataset/dataset-builder.js";

export class ImprovementEngine {
  private readonly collector: ExperienceCollector;

  private readonly datasetDir: string;

  constructor(
    private readonly deps: {
      bus: EventBus;
      memory: MemorySystem;
      baseDir?: string;
    }
  ) {
    const baseDir = deps.baseDir ?? process.cwd();
    this.collector = new ExperienceCollector({ bus: deps.bus, baseDir });
    this.datasetDir = path.join(baseDir, ".ia-assistant", "learning", "datasets");
  }

  start() {
    this.collector.start();
  }

  stats(limit = 10_000) {
    const events = this.collector.readAll(limit);
    const analyzed = analyzeExperiences(events);
    return {
      ok: true,
      events: events.length,
      counters: analyzed.counters,
      examples: analyzed.examples.length,
    };
  }

  recordUserCorrection(input: {
    sessionId?: string;
    userId?: string;
    traceId?: string;
    prompt: string;
    answer: string;
    correction: string;
  }) {
    const e = this.collector.recordUserCorrection(input);
    if (e) {
      void this.deps.memory.add("event", "user_correction", e as any).catch(() => undefined);
    }
    return { ok: Boolean(e), event: e };
  }

  exportTrainingDataset(params?: { limit?: number }) {
    const limit = typeof params?.limit === "number" ? Math.max(1, Math.min(50_000, params.limit)) : 10_000;
    const events = this.collector.readAll(limit);
    fs.mkdirSync(this.datasetDir, { recursive: true });
    const built = buildDataset({ baseDir: this.deps.baseDir ?? process.cwd(), events });
    void this.deps.memory
      .add("event", "training_dataset_exported", { filePath: built.filePath, examples: built.examples } as any)
      .catch(() => undefined);
    return { ok: true, filePath: built.filePath, examples: built.examples, counters: built.counters };
  }
}
