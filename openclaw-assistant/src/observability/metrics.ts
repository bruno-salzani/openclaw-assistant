import { Registry, Counter, Histogram } from "prom-client";

export class MetricsRegistry {
  private readonly registry: Registry;

  private readonly metrics: Map<string, any> = new Map();

  constructor() {
    this.registry = new Registry();
    this.registerDefaults();
  }

  private registerDefaults() {
    this.createCounter(
      "gateway_messages_total",
      "Total number of messages processed by the gateway"
    );
    this.createCounter("gateway_start_total", "Total number of gateway starts");
    this.createCounter("gateway_stop_total", "Total number of gateway stops");
    this.createCounter(
      "gateway_workflow_invocations_total",
      "Total number of workflow invocations via gateway"
    );
    this.createHistogram("agent_latency_seconds", "Latency of agent execution in seconds");
    this.createCounter("tool_errors_total", "Total number of tool execution errors");
    this.createCounter("tool_executions_total", "Total number of tool executions");
    this.createCounter("agent_runs_total", "Total number of agent runs");
    this.createCounter("planning_runs_total", "Total number of planning runs");
    this.createCounter("research_runs_total", "Total number of research runs");
    this.createCounter("execution_runs_total", "Total number of execution runs");
    this.createCounter("analysis_runs_total", "Total number of analysis runs");
    this.createCounter("review_runs_total", "Total number of review runs");
    this.createCounter("task_created_total", "Total number of tasks created");
    this.createCounter("task_started_total", "Total number of tasks started");
    this.createCounter("task_completed_total", "Total number of tasks completed");
    this.createCounter("task_failed_total", "Total number of tasks failed");
    this.createCounter("task_retried_total", "Total number of task retries");
    this.createCounter("workflow_runs_total", "Total number of workflow executions");
    this.createCounter("events_ingested_total", "Total number of events ingested");
    this.createCounter("triggers_fired_total", "Total number of triggers fired");
    this.createCounter("triggers_deduped_total", "Total number of triggers deduped (idempotency)");
    this.createCounter("triggers_failed_total", "Total number of triggers that failed to run");
    this.createCounter("triggers_errors_total", "Total number of trigger engine errors");
    this.createCounter("learning_iterations_total", "Total number of self-improvement iterations");
    this.createCounter(
      "knowledge_expansion_total",
      "Total number of external knowledge ingestions"
    );
    this.createCounter("architectures_created_total", "Total post-human architectures created");
    this.createCounter("reasoning_graph_runs_total", "Total reasoning graph runs");
    this.createCounter("workers_scaled_total", "Total number of worker scale-up events");
  }

  createCounter(name: string, help: string) {
    if (!this.metrics.has(name)) {
      const metric = new Counter({ name, help, registers: [this.registry] });
      this.metrics.set(name, metric);
    }
    return this.metrics.get(name) as Counter;
  }

  createHistogram(name: string, help: string, buckets = [0.1, 0.5, 1, 2, 5, 10]) {
    if (!this.metrics.has(name)) {
      const metric = new Histogram({ name, help, buckets, registers: [this.registry] });
      this.metrics.set(name, metric);
    }
    return this.metrics.get(name) as Histogram;
  }

  counter(name: string) {
    return this.metrics.get(name) as Counter;
  }

  histogram(name: string) {
    return this.metrics.get(name) as Histogram;
  }

  async prometheus() {
    return this.registry.metrics();
  }
}
