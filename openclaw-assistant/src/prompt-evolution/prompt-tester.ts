import type { LLMProvider } from "../llm/llm-provider.js";
import { tryParseJson } from "../infra/json.js";
import type { PromptVariant } from "./prompt-mutator.js";

export type PromptScore = { variantId: string; score: number; reasons: string[] };

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function heuristicScore(text: string) {
  const t = String(text ?? "");
  const lower = t.toLowerCase();
  let score = 0.3;
  const reasons: string[] = [];

  if (lower.includes("segurança") || lower.includes("safety")) {
    score += 0.2;
    reasons.push("safety");
  }
  if (lower.includes("formato") || lower.includes("seções") || lower.includes("sections")) {
    score += 0.2;
    reasons.push("structure");
  }
  if (lower.includes("fontes") || lower.includes("sources")) {
    score += 0.15;
    reasons.push("sources");
  }
  if (t.length > 2000) {
    score -= 0.15;
    reasons.push("too_long");
  }
  return { score: clamp01(score), reasons };
}

export async function scoreVariants(params: {
  variants: PromptVariant[];
  llm?: LLMProvider;
}): Promise<PromptScore[]> {
  const variants = params.variants.slice(0, 12);
  const base = variants.map((v) => {
    const h = heuristicScore(v.text);
    return { variantId: v.id, score: h.score, reasons: h.reasons };
  });

  if (!params.llm || process.env.IA_ASSISTANT_PROMPT_EVOLUTION_LLM_JUDGE !== "1") return base;

  const judgePrompt = [
    "Avalie cada prompt (0–1) para qualidade, segurança e clareza.",
    'Retorne APENAS JSON: {"scores":[{"id":"v0","score":0.7,"reasons":["..."]}]}',
    "",
    JSON.stringify(variants.map((v) => ({ id: v.id, text: v.text.slice(0, 2000) }))),
  ].join("\n");

  try {
    const out = await params.llm.chat({
      messages: [
        { role: "system", content: "You are a strict evaluator. Output JSON only." },
        { role: "user", content: judgePrompt },
      ],
      temperature: 0.2,
      maxTokens: 800,
    });
    const parsed = tryParseJson<{ scores?: unknown }>(out);
    const rawScores = Array.isArray(parsed?.scores) ? (parsed?.scores as any[]) : [];
    const byId = new Map<string, unknown>();
    for (const s of rawScores) byId.set(String((s as any)?.id ?? ""), s);
    return base.map((b) => {
      const s = byId.get(b.variantId);
      const sObj = s && typeof s === "object" ? (s as any) : null;
      const llmScore = Number(sObj?.score);
      const score = Number.isFinite(llmScore) ? clamp01(0.5 * b.score + 0.5 * llmScore) : b.score;
      const reasons = Array.isArray(sObj?.reasons) ? sObj.reasons.map(String).filter(Boolean) : b.reasons;
      return { variantId: b.variantId, score, reasons };
    });
  } catch {
    return base;
  }
}
