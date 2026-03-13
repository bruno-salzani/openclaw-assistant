import type { TriggerSpec, TriggerCondition } from "./trigger-types.js";
import type { EventEnvelope } from "../events/event-types.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import type { WorkflowEngine } from "../workflows/engine.js";
import type { TriggerDedupeStore } from "./dedupe-store.js";

function getByPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function evalCondition(cond: TriggerCondition, evt: EventEnvelope): boolean {
  const v = String(getByPath(evt as any, cond.field) ?? "");
  if (cond.operator === "exists") return getByPath(evt as any, cond.field) !== undefined;
  const x = String(cond.value ?? "");
  if (cond.operator === "equals") return v === x;
  if (cond.operator === "contains") return v.includes(x);
  if (cond.operator === "starts_with") return v.startsWith(x);
  if (cond.operator === "ends_with") return v.endsWith(x);
  return false;
}

export class TriggerEngine {
  private readonly metrics: MetricsRegistry;

  private readonly workflows: WorkflowEngine;

  private readonly dedupe?: TriggerDedupeStore;

  private readonly triggers = new Map<string, TriggerSpec>();

  private started = false;

  private timers: any[] = [];

  constructor(metrics: MetricsRegistry, workflows: WorkflowEngine, dedupe?: TriggerDedupeStore) {
    this.metrics = metrics;
    this.workflows = workflows;
    this.dedupe = dedupe;
  }

  register(trigger: TriggerSpec) {
    this.triggers.set(trigger.trigger_id, trigger);
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const t of this.triggers.values()) {
      if (t.schedule?.everyMs) {
        const every = t.schedule.everyMs;
        const h = setInterval(async () => {
          const evt: EventEnvelope = {
            event_id: `evt_${Date.now()}`,
            type: "cron.tick",
            timestamp: new Date().toISOString(),
            source: "cron",
            payload: { trigger_id: t.trigger_id, now: Date.now() },
          };
          try {
            await this.onEvent(evt);
          } catch {
            this.metrics.counter("triggers_errors_total").inc();
          }
        }, every);
        if (typeof (h as any).unref === "function") (h as any).unref();
        this.timers.push(h);
      }
      if (t.schedule?.cron) {
        // Mock cron parser: Check every minute if matches
        // In real implementation: use node-cron
        const cron = t.schedule.cron;
        const h = setInterval(async () => {
          // Simplified cron check (always fires for demo if cron field exists)
          // Real implementation needs cron expression parsing
          const evt: EventEnvelope = {
            event_id: `evt_cron_${Date.now()}`,
            type: "cron.schedule",
            timestamp: new Date().toISOString(),
            source: "cron",
            payload: { trigger_id: t.trigger_id, cron },
          };
          try {
            await this.onEvent(evt);
          } catch {
            this.metrics.counter("triggers_errors_total").inc();
          }
        }, 60000);
        if (typeof (h as any).unref === "function") (h as any).unref();
        this.timers.push(h);
      }
    }
  }

  stop() {
    for (const t of this.timers) {
      try {
        clearInterval(t);
      } catch {}
    }
    this.timers = [];
    this.started = false;
  }

  async onEvent(evt: EventEnvelope) {
    this.metrics.counter("events_ingested_total").inc();
    for (const t of this.triggers.values()) {
      if (t.event_type && t.event_type !== evt.type) continue;
      const conditions = t.conditions ?? [];
      const ok = conditions.every((c) => evalCondition(c, evt));
      if (!ok) continue;
      const dedupeMs =
        t.dedupe?.windowMs ?? Number(process.env.OPENCLAW_X_TRIGGER_DEDUPE_TTL_MS ?? 600_000);
      const fields = t.dedupe?.keyFields ?? [];
      const dedupeKey =
        fields.length > 0
          ? `${t.trigger_id}:${fields.map((f) => String(getByPath(evt as any, f) ?? "")).join("|")}`
          : `${t.trigger_id}:${evt.event_id}`;
      if (this.dedupe && dedupeMs > 0) {
        const first = await this.dedupe.claim(dedupeKey, dedupeMs);
        if (!first) {
          this.metrics.counter("triggers_deduped_total").inc();
          continue;
        }
      }
      this.metrics.counter("triggers_fired_total").inc();
      try {
        await this.workflows.execute(t.workflow, { event: evt, userRole: "service" });
      } catch {
        this.metrics.counter("triggers_failed_total").inc();
      }
    }
  }
}
