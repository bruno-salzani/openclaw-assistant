import type { CognitiveInput, CognitivePerception } from "./types.js";

function hasCode(text: string) {
  const t = String(text ?? "");
  if (t.includes("```")) return true;
  if (/\b(ts|tsx|js|jsx|typescript|javascript)\b/i.test(t)) return true;
  if (/\berror:|stack trace|exception\b/i.test(t)) return true;
  return false;
}

function domainHints(text: string) {
  const lower = String(text ?? "").toLowerCase();
  const hints: string[] = [];
  const pairs: Array<[string, string]> = [
    ["finance", "finance"],
    ["invoice", "finance"],
    ["budget", "finance"],
    ["market", "market"],
    ["startup", "market"],
    ["competition", "market"],
    ["trend", "trend"],
    ["growth", "trend"],
    ["security", "security"],
    ["vulnerability", "security"],
    ["postgres", "engineering"],
    ["typescript", "engineering"],
    ["eslint", "engineering"],
    ["api", "engineering"],
  ];
  for (const [k, v] of pairs) {
    if (lower.includes(k) && !hints.includes(v)) hints.push(v);
  }
  return hints.slice(0, 6);
}

function complexityFrom(text: string, hints: string[], code: boolean) {
  const len = String(text ?? "").length;
  const score = (code ? 2 : 0) + (hints.length >= 3 ? 2 : hints.length >= 2 ? 1 : 0) + (len > 1500 ? 2 : len > 500 ? 1 : 0);
  if (score >= 4) return "high" as const;
  if (score >= 2) return "medium" as const;
  return "low" as const;
}

function objectiveFrom(text: string) {
  const t = String(text ?? "").trim();
  if (!t) return "Ajudar o usuário";
  const oneLine = t.replace(/\s+/g, " ").slice(0, 240);
  return oneLine;
}

export class PerceptionEngine {
  perceive(input: CognitiveInput): CognitivePerception {
    const modality = String((input.ctx.metadata as any)?.modality ?? "text");
    const text = String(input.text ?? "");
    const code = hasCode(text);
    const hints = domainHints(text);
  const wantsAnalysis =
    /\banaly(ze|sis)\b|\banalyse\b|\bstrategy\b|\bevaluate\b|\bcompare\b|avaliar|comparar|trade-?off|estrat(é|e)gia/i.test(
      text
    );
    const wantsExecution = /\bimplementar|corrigir|fix|patch|refatorar|rodar|executar\b/i.test(text);
    const objective = objectiveFrom(text);
    const complexity = complexityFrom(text, hints, code);
    return {
      modality,
      objective,
      complexity,
      domainHints: hints,
      signals: { hasCode: code, wantsAnalysis, wantsExecution },
    };
  }
}
