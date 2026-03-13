import type { LearnedSkillStep } from "./skill-registry.js";

export type ToolExecutedEvent = {
  tool: string;
  ok: boolean;
  durationMs: number;
  traceId?: string;
  workspaceId?: string;
  source?: string;
  argsKeys?: string[];
};

export type SkillSuggestion = {
  id: string;
  description: string;
  steps: LearnedSkillStep[];
  signal: { type: "pair" | "tool"; key: string; count: number };
  meta?: Record<string, unknown>;
};

function normalizeId(id: string) {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

export class SkillExtractor {
  private lastToolByTrace = new Map<string, string>();

  private counts = new Map<string, number>();

  constructor(
    private readonly config: {
      threshold: number;
      maxKeys: number;
    }
  ) {}

  observe(evt: ToolExecutedEvent): SkillSuggestion | null {
    if (!evt.ok) return null;
    const tool = String(evt.tool ?? "");
    if (!tool) return null;

    const threshold = Math.max(3, Number(this.config.threshold));
    const argsKeys = uniq(Array.isArray(evt.argsKeys) ? evt.argsKeys : []).slice(0, this.config.maxKeys);

    const toolKey = `tool:${tool}`;
    const toolCount = (this.counts.get(toolKey) ?? 0) + 1;
    this.counts.set(toolKey, toolCount);
    if (toolCount === threshold) {
      const id = normalizeId(`macro-${tool}`);
      return {
        id,
        description: `Learned macro for repeated tool: ${tool}`,
        steps: [{ tool, argsTemplate: Object.fromEntries(argsKeys.map((k) => [k, `{{input.${k}}}`])) }],
        signal: { type: "tool", key: toolKey, count: toolCount },
        meta: { tool, argsKeys },
      };
    }

    const traceId = typeof evt.traceId === "string" ? evt.traceId : "";
    if (traceId) {
      const prev = this.lastToolByTrace.get(traceId);
      this.lastToolByTrace.set(traceId, tool);
      if (prev && prev !== tool) {
        const pairKey = `pair:${prev}->${tool}`;
        const pairCount = (this.counts.get(pairKey) ?? 0) + 1;
        this.counts.set(pairKey, pairCount);
        if (pairCount === threshold) {
          const id = normalizeId(`macro-${prev}-${tool}`);
          return {
            id,
            description: `Learned macro for repeated sequence: ${prev} -> ${tool}`,
            steps: [
              { tool: prev, argsTemplate: { $: "{{input.steps[0].args}}" } },
              { tool, argsTemplate: { $: "{{input.steps[1].args}}" } },
            ],
            signal: { type: "pair", key: pairKey, count: pairCount },
            meta: { prev, tool },
          };
        }
      }
    }

    if (this.counts.size > 5000) this.counts.clear();
    if (this.lastToolByTrace.size > 5000) this.lastToolByTrace.clear();
    return null;
  }
}
