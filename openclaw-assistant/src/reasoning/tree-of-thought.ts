import type { LLMProvider } from "../llm/llm-provider.js";
import { tryParseJson } from "../infra/json.js";

function normalizeStep(step: any, idx: number) {
  const id = typeof step?.id === "string" && step.id ? step.id : `s${idx + 1}`;
  const type =
    step?.type === "research" || step?.type === "execute" || step?.type === "analyze"
      ? step.type
      : "research";
  const dependsOn = Array.isArray(step?.dependsOn) ? step.dependsOn.map(String) : [];
  const payload = step?.payload && typeof step.payload === "object" ? step.payload : {};
  const priority =
    step?.priority === "low" || step?.priority === "medium" || step?.priority === "high"
      ? step.priority
      : "medium";
  return { id, type, dependsOn, payload, priority };
}

function normalizePlan(plan: any) {
  const steps = Array.isArray(plan?.steps)
    ? plan.steps
    : Array.isArray(plan?.tasks)
      ? plan.tasks
      : [];
  return { steps: steps.map(normalizeStep) };
}

export type TreeOfThoughtTrace = {
  depth: number;
  branches: number;
  levels: Array<{
    candidates: Array<{ plan: any; score: number }>;
  }>;
};

async function generateCandidates(params: {
  llm: LLMProvider;
  objective: string;
  contextText?: string;
  branches: number;
  seedPlan?: any;
}) {
  const prompt = [
    "Gere alternativas de plano em JSON.",
    "Retorne APENAS JSON com o shape:",
    `{ "plans": [ { "steps": [ { "id": "r1", "type": "research|analyze|execute", "dependsOn": [], "payload": {}, "priority": "low|medium|high" } ] } ] }`,
    "",
    `Objective: ${params.objective}`,
    params.contextText ? `Context:\n${params.contextText}` : "",
    params.seedPlan ? `SeedPlan:\n${JSON.stringify(params.seedPlan)}` : "",
    `Constraints: generate ${params.branches} plans.`,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await params.llm.chat({
    messages: [
      { role: "system", content: "You are a planning engine. Output JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    maxTokens: 1800,
  });

  const parsed = tryParseJson<{ plans?: any[] }>(out);
  const plans = Array.isArray(parsed?.plans) ? parsed!.plans : tryParseJson<any[]>(out);
  if (!Array.isArray(plans) || plans.length === 0) return [];
  return plans.slice(0, params.branches).map(normalizePlan);
}

async function scoreCandidates(params: {
  llm: LLMProvider;
  objective: string;
  contextText?: string;
  plans: any[];
}) {
  const prompt = [
    "Dado objective/context, avalie cada plano com um score de 0 a 10.",
    "Critérios: clareza, dependências corretas, minimalismo, segurança, completude.",
    'Retorne APENAS JSON no formato: {"scores":[n1,n2,...]}',
    "",
    `Objective: ${params.objective}`,
    params.contextText ? `Context:\n${params.contextText}` : "",
    "Plans:",
    JSON.stringify(params.plans),
  ]
    .filter(Boolean)
    .join("\n");

  const out = await params.llm.chat({
    messages: [
      { role: "system", content: "You are a strict evaluator. Output JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    maxTokens: 600,
  });

  const parsed = tryParseJson<{ scores?: number[] }>(out);
  const scores = Array.isArray(parsed?.scores) ? parsed!.scores : tryParseJson<number[]>(out);
  if (!Array.isArray(scores)) return params.plans.map(() => 5);
  return params.plans.map((_, i) => (Number.isFinite(scores[i]) ? Number(scores[i]) : 5));
}

export async function planWithTreeOfThought(params: {
  llm: LLMProvider;
  objective: string;
  contextText?: string;
  branches?: number;
  depth?: number;
}) {
  const branches = Math.max(2, Math.min(8, Math.floor(params.branches ?? 3)));
  const depth = Math.max(1, Math.min(5, Math.floor(params.depth ?? 2)));
  const trace: TreeOfThoughtTrace = { depth, branches, levels: [] };

  let frontier: any[] = await generateCandidates({
    llm: params.llm,
    objective: params.objective,
    contextText: params.contextText,
    branches,
  });
  if (frontier.length === 0) {
    const fallback = normalizePlan({
      steps: [
        {
          id: "r1",
          type: "research",
          dependsOn: [],
          payload: { query: params.objective },
          priority: "medium",
        },
      ],
    });
    return { plan: fallback, trace };
  }

  for (let d = 0; d < depth; d++) {
    const scores = await scoreCandidates({
      llm: params.llm,
      objective: params.objective,
      contextText: params.contextText,
      plans: frontier,
    });
    const ranked = frontier
      .map((p, i) => ({ plan: p, score: scores[i] ?? 5 }))
      .sort((a, b) => b.score - a.score);
    trace.levels.push({ candidates: ranked.slice(0, branches) });
    const best = ranked[0]?.plan ?? frontier[0];
    if (d === depth - 1) return { plan: best, trace };
    const next = await generateCandidates({
      llm: params.llm,
      objective: params.objective,
      contextText: params.contextText,
      branches,
      seedPlan: best,
    });
    frontier = next.length > 0 ? next : [best];
  }

  return { plan: frontier[0], trace };
}
