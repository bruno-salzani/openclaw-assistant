import { createHash } from "node:crypto";
import type { LLMProvider } from "../llm/llm-provider.js";
import { reflexionReviseAnswer } from "../reasoning/reflexion.js";
import type { CognitiveReflection } from "./types.js";

export class ReflectionEngine {
  constructor(private readonly deps: { llm?: LLMProvider }) {}

  async reflect(params: { prompt: string; answer: string }): Promise<CognitiveReflection> {
    const raw = String(params.answer ?? "");
    const llm = this.deps.llm;
    const enabled = Boolean(llm) && String(process.env.IA_ASSISTANT_COGNITION_REFLECTION_LLM ?? "0") === "1";
    if (!enabled || !llm) {
      return { critique: "", revised: raw, ok: Boolean(raw.trim()) };
    }
    try {
      const out = await reflexionReviseAnswer({ llm, prompt: params.prompt, answer: raw });
      const revised = String(out.revised ?? raw);
      const ok = Boolean(revised.trim());
      const critique = String(out.critique ?? "");
      return { critique, revised, ok };
    } catch {
      return { critique: "", revised: raw, ok: Boolean(raw.trim()) };
    }
  }

  hashOutput(text: string) {
    return createHash("sha256").update(String(text ?? "")).digest("hex");
  }
}

