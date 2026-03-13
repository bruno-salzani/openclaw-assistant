import { randomUUID } from "node:crypto";
import type { AgentOrchestrator } from "../agents/orchestrator.js";
import type { AbTestResult } from "./ab-testing.js";

export type ExperimentPrompt = { id: string; text: string };

export type ExperimentRunOptions = {
  sessionId?: string;
  userId?: string;
  channel?: string;
  workspaceId?: string;
  variantA: { id: string; system?: string };
  variantB: { id: string; system?: string };
};

export type ExperimentOutput = {
  promptId: string;
  traceId: string;
  output: string;
};

export class ExperimentRunner {
  constructor(private readonly deps: { orchestrator: AgentOrchestrator }) {}

  async abTest(prompts: ExperimentPrompt[], opts: ExperimentRunOptions): Promise<AbTestResult<ExperimentOutput>> {
    const sessionId = opts.sessionId ?? `exp:${randomUUID()}`;
    const userId = opts.userId ?? "user:experiment";
    const channel = opts.channel ?? "experiment";
    const workspaceId = opts.workspaceId;

    const a: ExperimentOutput[] = [];
    const b: ExperimentOutput[] = [];

    for (let i = 0; i < prompts.length; i += 1) {
      const p = prompts[i]!;
      const isA = i % 2 === 0;
      const variant = isA ? opts.variantA : opts.variantB;
      const traceId = `exp:${variant.id}:${randomUUID()}`;
      const res = await this.deps.orchestrator.run({
        sessionId,
        userId,
        channel,
        text: p.text,
        userRole: "admin",
        metadata: {
          traceId,
          workspaceId,
          experiment: { variantId: variant.id, system: variant.system },
          contextText: variant.system ? `[Experiment System]\n${variant.system}` : undefined,
        },
      });
      const row: ExperimentOutput = { promptId: p.id, traceId, output: String(res.text ?? "") };
      (isA ? a : b).push(row);
    }

    return { ok: true, a: { id: opts.variantA.id, results: a }, b: { id: opts.variantB.id, results: b } };
  }
}

