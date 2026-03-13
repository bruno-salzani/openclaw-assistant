import type { EventBus } from "../infra/event-bus.js";
import { ModelRouterOptimizer } from "./model-router-optimizer.js";

export class CostOptimizer {
  private readonly optimizer: ModelRouterOptimizer;

  constructor(deps: { bus: EventBus; baseDir?: string }) {
    this.optimizer = new ModelRouterOptimizer(deps);
  }

  start() {
    this.optimizer.start();
  }

  stop() {
    this.optimizer.stop();
  }

  status() {
    return this.optimizer.getState();
  }
}

