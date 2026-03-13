import type { Tracer, Span } from "./tracing.js";

export function startAiSpan(
  tracer: Tracer,
  name: string,
  attrs: Record<string, unknown>
): { span: Span; end: (extra?: Record<string, unknown>) => void } {
  const span = tracer.startSpan(name, { ...attrs, "ai.span": true });
  return {
    span,
    end: (extra) => {
      if (extra && typeof extra === "object") {
        span.attributes = { ...span.attributes, ...extra };
      }
      span.end();
    },
  };
}
