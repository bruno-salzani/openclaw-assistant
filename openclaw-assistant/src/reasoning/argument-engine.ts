import type { LLMProvider } from "../llm/llm-provider.js";

export type Proposal = {
  id: string;
  text: string;
};

export type Critique = {
  proposalId: string;
  text: string;
};

async function llmJson<T>(llm: LLMProvider, system: string, user: string): Promise<T | null> {
  try {
    const out = await llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      maxTokens: 600,
    });
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

export async function proposeWithPlanner(params: { task: string; llm?: LLMProvider; variants?: number }) {
  const n = Math.max(1, Math.min(5, Number(params.variants ?? 2)));
  if (!params.llm || process.env.IA_ASSISTANT_REASONING_DEBATE_LLM !== "1") {
    return Array.from({ length: n }).map((_, i) => ({
      id: `p${i + 1}`,
      text: `Plano ${i + 1}: resolva a tarefa em passos claros, use tools com parcimônia, valide com testes quando aplicável.`,
    }));
  }

  const system = [
    "Você é um planner. Gere propostas alternativas para resolver a tarefa.",
    "Responda APENAS JSON válido.",
    'Formato: { "proposals": Array<{ "id": string, "text": string }> }',
    `Gere exatamente ${n} proposals.`,
    "Seja objetivo, com passos, riscos e validação.",
  ].join("\n");
  const parsed = await llmJson<any>(params.llm, system, params.task);
  const proposalsIn = Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  const proposals: Proposal[] = proposalsIn
    .map((p: any, idx: number) => ({
      id: typeof p?.id === "string" ? String(p.id) : `p${idx + 1}`,
      text: typeof p?.text === "string" ? String(p.text) : "",
    }))
    .filter((p: Proposal) => Boolean(p.text));
  if (proposals.length === 0) {
    return Array.from({ length: n }).map((_, i) => ({
      id: `p${i + 1}`,
      text: `Plano ${i + 1}: resolva a tarefa em passos claros, use tools com parcimônia, valide com testes quando aplicável.`,
    }));
  }
  return proposals.slice(0, n);
}

export async function critiqueWithCritic(params: { task: string; proposals: Proposal[]; llm?: LLMProvider }) {
  if (!params.llm || process.env.IA_ASSISTANT_REASONING_DEBATE_LLM !== "1") {
    return params.proposals.map((p) => ({
      proposalId: p.id,
      text: `Crítica: verifique riscos, segurança, validação (lint/typecheck/tests), e impacto no comportamento.`,
    }));
  }

  const system = [
    "Você é um crítico técnico. Avalie propostas para a tarefa.",
    "Responda APENAS JSON válido.",
    'Formato: { "critiques": Array<{ "proposalId": string, "text": string }> }',
    "Critique: segurança, correção, custo, cobertura de testes, risco de regressão.",
  ].join("\n");
  const user = JSON.stringify({ task: params.task, proposals: params.proposals });
  const parsed = await llmJson<any>(params.llm, system, user);
  const critiquesIn = Array.isArray(parsed?.critiques) ? parsed.critiques : [];
  const critiques: Critique[] = critiquesIn
    .map((c: any) => ({
      proposalId: typeof c?.proposalId === "string" ? String(c.proposalId) : "",
      text: typeof c?.text === "string" ? String(c.text) : "",
    }))
    .filter((c: Critique) => Boolean(c.proposalId && c.text));
  if (critiques.length === 0) {
    return params.proposals.map((p) => ({
      proposalId: p.id,
      text: `Crítica: verifique riscos, segurança, validação (lint/typecheck/tests), e impacto no comportamento.`,
    }));
  }
  return critiques;
}

