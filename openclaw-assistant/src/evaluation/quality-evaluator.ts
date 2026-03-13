import type { LLMProvider } from "../llm/llm-provider.js";
import { tryParseJson } from "../infra/json.js";

export type EvaluationResult = {
  ok: boolean;
  qualityScore: number;
  hallucinationScore: number;
  ragRelevanceScore: number;
  reasons: string[];
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function heuristicEval(params: { prompt: string; answer: string; contextText?: string }): EvaluationResult {
  const prompt = String(params.prompt ?? "");
  const answer = String(params.answer ?? "");
  const ctx = String(params.contextText ?? "");
  const reasons: string[] = [];

  let quality = 0.55;
  if (answer.trim().length >= 80) quality += 0.1;
  if (answer.trim().length >= 300) quality += 0.1;
  if (answer.trim().length > 3000) {
    quality -= 0.1;
    reasons.push("too_long");
  }

  const lower = answer.toLowerCase();
  if (lower.includes("não sei") || lower.includes("nao sei")) {
    quality -= 0.1;
    reasons.push("low_confidence");
  }
  if (lower.includes("fonte") || lower.includes("sources") || lower.includes("referên") || lower.includes("referenc")) {
    quality += 0.05;
    reasons.push("mentions_sources");
  }
  if (prompt && answer && answer.toLowerCase().includes(prompt.toLowerCase().slice(0, 20))) {
    quality += 0.03;
    reasons.push("on_topic");
  }

  let ragRel = 0.5;
  if (ctx.trim() && answer.trim()) {
    const overlap = ctx
      .split(/\s+/)
      .slice(0, 200)
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 5);
    const ans = new Set(answer.split(/\s+/).map((w) => w.toLowerCase()));
    const hits = overlap.filter((w) => ans.has(w)).length;
    ragRel = clamp01(0.25 + Math.min(0.75, hits / 30));
  } else if (!ctx.trim()) {
    ragRel = 0.4;
  }

  let halluc = 0.15;
  if (!ctx.trim()) halluc += 0.1;
  if (lower.includes("com certeza") || lower.includes("garantido")) halluc += 0.05;
  if (lower.includes("talvez") || lower.includes("pode ser") || lower.includes("possível")) halluc -= 0.03;
  halluc = clamp01(halluc);

  return {
    ok: true,
    qualityScore: clamp01(quality),
    hallucinationScore: halluc,
    ragRelevanceScore: clamp01(ragRel),
    reasons,
  };
}

export async function evaluateAnswer(params: {
  llm?: LLMProvider;
  prompt: string;
  answer: string;
  contextText?: string;
}): Promise<EvaluationResult> {
  const base = heuristicEval(params);
  const enabled = Boolean(params.llm) && process.env.IA_ASSISTANT_EVALUATION_LLM === "1";
  if (!enabled || !params.llm) return base;

  const system = [
    "Você é um avaliador estrito de respostas de IA.",
    "Retorne APENAS JSON válido, sem markdown.",
    'Formato: {"qualityScore":0-1,"hallucinationScore":0-1,"ragRelevanceScore":0-1,"reasons":["..."]}',
  ].join("\n");
  const user = JSON.stringify({
    prompt: String(params.prompt ?? "").slice(0, 4000),
    context: String(params.contextText ?? "").slice(0, 6000),
    answer: String(params.answer ?? "").slice(0, 6000),
  });
  try {
    const out = await params.llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      maxTokens: 500,
    });
    const parsed = tryParseJson<Record<string, unknown>>(out) ?? {};
    const q = clamp01(Number(parsed.qualityScore));
    const h = clamp01(Number(parsed.hallucinationScore));
    const r = clamp01(Number(parsed.ragRelevanceScore));
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String).filter(Boolean).slice(0, 20) : base.reasons;
    return {
      ok: true,
      qualityScore: Number.isFinite(q) ? q : base.qualityScore,
      hallucinationScore: Number.isFinite(h) ? h : base.hallucinationScore,
      ragRelevanceScore: Number.isFinite(r) ? r : base.ragRelevanceScore,
      reasons,
    };
  } catch {
    return base;
  }
}
