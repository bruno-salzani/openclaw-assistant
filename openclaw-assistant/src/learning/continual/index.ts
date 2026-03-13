import type { AgentDeps } from "../../agents/agent-deps.js";
import { InteractionCollector } from "./collector.js";
import { Evaluator } from "./evaluator.js";
import { ModelRegistry } from "./model-registry.js";

export class ContinualLearningLoop {
  private readonly collector: InteractionCollector;

  private readonly evaluator: Evaluator;

  private readonly registry: ModelRegistry;

  constructor(private readonly deps: AgentDeps) {
    this.collector = new InteractionCollector(deps);
    this.evaluator = new Evaluator(deps);
    this.registry = new ModelRegistry(deps);
  }

  async recordInteraction(agent: string, input: string, output: string, ok: boolean) {
    await this.collector.record({ ts: Date.now(), agent, input, output, ok });
    this.deps.bus?.emit("learning_event", { type: "interaction", agent, ok });
  }

  async iteration(samples: Array<{ input: string; output: string }>) {
    const metrics = await this.evaluator.evaluate(samples);
    const id = `model-${Date.now()}`;
    const m: Record<string, number> = {};
    for (const metric of metrics) m[metric.name] = metric.value;
    await this.registry.register({ id, createdAt: Date.now(), tags: ["auto"], metrics: m });
    this.deps.bus?.emit("learning_event", { type: "iteration", modelId: id, metrics: m });
    return { id, metrics: m };
  }
}
