import { randomUUID } from "node:crypto";
import type { MetricsRegistry } from "./metrics.js";

export type Span = {
  id: string;
  parentId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  end: () => void;
};

type SpanRecord = {
  id: string;
  parentId?: string;
  name: string;
  startTime: number;
  endTime: number;
  attributes: Record<string, unknown>;
};

export class Tracer {
  private readonly metrics: MetricsRegistry;

  private exporter?: { export: (span: SpanRecord) => void };

  constructor(metrics: MetricsRegistry) {
    this.metrics = metrics;
  }

  setExporter(exp: { export: (span: SpanRecord) => void }) {
    this.exporter = exp;
  }

  startSpan(name: string, attributes: Record<string, unknown> = {}, parentId?: string): Span {
    const id = randomUUID();
    const startTime = Date.now();

    return {
      id,
      parentId,
      name,
      startTime,
      attributes,
      end: () => {
        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;
        this.metrics.histogram("agent_latency_seconds").observe(duration);
        if (this.exporter) {
          this.exporter.export({ id, parentId, name, startTime, endTime, attributes });
        }
      },
    };
  }
}
