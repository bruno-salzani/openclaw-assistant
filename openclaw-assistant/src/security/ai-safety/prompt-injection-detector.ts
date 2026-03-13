export type PromptInjectionSignal = {
  risk: number;
  reasons: string[];
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function addReason(reasons: string[], r: string) {
  if (!reasons.includes(r)) reasons.push(r);
}

export function detectPromptInjection(text: string): PromptInjectionSignal {
  const t = String(text ?? "");
  const lower = t.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  const patterns: Array<{ re: RegExp; w: number; reason: string }> = [
    { re: /\bignore (all|previous|prior) instructions\b/i, w: 0.35, reason: "ignore_instructions" },
    { re: /\b(system prompt|developer message|hidden instructions)\b/i, w: 0.3, reason: "system_prompt_exfiltration" },
    { re: /\b(api[- ]?key|secret|token|password)\b/i, w: 0.25, reason: "secrets_exfiltration" },
    { re: /\bdo not tell\b|\bdon't tell\b/i, w: 0.15, reason: "concealment" },
    { re: /\brole:\s*system\b/i, w: 0.2, reason: "role_injection" },
    { re: /\bBEGIN (SYSTEM|INSTRUCTIONS)\b|\bEND (SYSTEM|INSTRUCTIONS)\b/i, w: 0.2, reason: "delimiter_injection" },
    { re: /\boverride\b|\bjailbreak\b|\bprompt injection\b/i, w: 0.2, reason: "explicit_attack" },
  ];

  for (const p of patterns) {
    if (p.re.test(t)) {
      score += p.w;
      addReason(reasons, p.reason);
    }
  }

  if (lower.includes("sk-") || lower.includes("openai_api_key")) {
    score += 0.35;
    addReason(reasons, "looks_like_api_key");
  }

  if (t.length > 20_000) {
    score += 0.1;
    addReason(reasons, "very_long_input");
  }

  return { risk: clamp01(score), reasons };
}

