import type { LLMProvider } from "../llm/llm-provider.js";
import type { CustomAgentSpec } from "../agents/factory.js";
import { tryParseJson } from "../infra/json.js";

export type DesignedArchitecture = {
  goal: string;
  agents: CustomAgentSpec[];
  rationale: string;
};

const RESERVED_ROLES = new Set([
  "planner",
  "research",
  "executor",
  "analyst",
  "coordinator",
  "finance",
  "reliability",
  "document",
  "notification",
  "automation",
  "curator",
  "simulation",
  "experiment",
]);

function safeRole(role: string) {
  const r = String(role ?? "").trim().toLowerCase();
  if (!r) return "meta_agent";
  if (r.startsWith("meta_")) return r;
  if (RESERVED_ROLES.has(r)) return `meta_${r}`;
  return r;
}

function normalizeId(v: string) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function heuristicDesign(goal: string): DesignedArchitecture {
  const g = String(goal ?? "").trim();
  const lower = g.toLowerCase();
  const agents: CustomAgentSpec[] = [];

  const add = (id: string, role: string, capabilities: string[], systemPrompt: string) => {
    agents.push({
      id: normalizeId(id),
      role: safeRole(String(role ?? "")),
      capabilities,
      systemPrompt,
    });
  };

  const wantsMarket = lower.includes("market") || lower.includes("startup") || lower.includes("semiconductor");
  const wantsFinance = lower.includes("financial") || lower.includes("revenue") || lower.includes("pricing") || lower.includes("cost");
  const wantsTrend = lower.includes("trend") || lower.includes("forecast") || lower.includes("prediction");
  const wantsRisk = lower.includes("risk") || lower.includes("compliance") || lower.includes("legal");
  const wantsEngineering = lower.includes("code") || lower.includes("refactor") || lower.includes("bug") || lower.includes("implement");

  if (wantsMarket) {
    add(
      "market_research_agent",
      "market_research",
      ["browser.search", "browser.fetch", "web.search", "web.fetch"],
      `Você é um agente de pesquisa de mercado. Objetivo: ${g}. Retorne achados com fontes e bullets.`
    );
  }
  if (wantsFinance) {
    add(
      "financial_analysis_agent",
      "financial_analysis",
      ["postgres.query", "csv.parse", "web.search", "web.fetch"],
      `Você é um agente de análise financeira. Objetivo: ${g}. Calcule métricas e cenários; seja explícito em assumptions.`
    );
  }
  if (wantsTrend) {
    add(
      "trend_prediction_agent",
      "trend_prediction",
      ["web.search", "web.fetch"],
      `Você é um agente de tendências. Objetivo: ${g}. Identifique sinais e projete implicações; cite limitações.`
    );
  }
  if (wantsRisk) {
    add(
      "risk_analysis_agent",
      "risk_analysis",
      ["web.search", "web.fetch"],
      `Você é um agente de riscos. Objetivo: ${g}. Liste riscos, severidade, mitigação e red flags.`
    );
  }
  if (wantsEngineering) {
    add(
      "engineering_agent",
      "engineering",
      ["repo.search", "repo.read", "repo.apply_patch", "terminal.run"],
      `Você é um agente de engenharia. Objetivo: ${g}. Proponha mudanças com justificativas e teste/lint/typecheck.`
    );
  }

  if (agents.length === 0) {
    add(
      "general_research_agent",
      "general_research",
      ["web.search", "web.fetch"],
      `Você é um agente de pesquisa geral. Objetivo: ${g}. Produza um resumo com fontes e recomendações.`
    );
  }

  return {
    goal: g,
    agents: agents.slice(0, 6),
    rationale: "Heuristic architecture based on goal signals",
  };
}

export async function designArchitecture(params: { goal: string; llm?: LLMProvider }): Promise<DesignedArchitecture> {
  const goal = String(params.goal ?? "").trim();
  const base = heuristicDesign(goal);
  if (!params.llm || process.env.IA_ASSISTANT_META_AGENT_LLM !== "1") return base;

  const prompt = [
    "Você é um Meta-Agent. Crie uma arquitetura de agentes para o goal.",
    "Retorne APENAS JSON com o shape:",
    '{ "rationale": "...", "agents": [ { "id": "market_research_agent", "role": "research", "capabilities": ["web.search"], "systemPrompt": "..." } ] }',
    "",
    `Goal: ${goal}`,
    "Restrições:",
    "- máximo 6 agentes",
    "- role deve ser curta (ex: research, finance, analyst, reliability, executor)",
    "- capabilities devem ser nomes de tools (strings)",
  ].join("\n");

  try {
    const out = await params.llm.chat({
      messages: [
        { role: "system", content: "You are a meta-agent. Output JSON only." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      maxTokens: 1200,
    });
    const parsed = tryParseJson<Record<string, unknown>>(out);
    const agentsRaw = Array.isArray((parsed as any)?.agents) ? ((parsed as any).agents as any[]) : null;
    if (!agentsRaw) return base;
    const agents = agentsRaw
      .map((a: any) => ({
        id: normalizeId(String(a?.id ?? "")),
        role: safeRole(typeof a?.role === "string" ? String(a.role) : "meta_agent"),
        capabilities: Array.isArray(a?.capabilities) ? a.capabilities.map(String).filter(Boolean) : [],
        systemPrompt: typeof a?.systemPrompt === "string" ? String(a.systemPrompt) : "",
      }))
      .filter((a: CustomAgentSpec) => Boolean(a.id && a.role));
    return {
      goal,
      agents: agents.slice(0, 6),
      rationale: typeof (parsed as any)?.rationale === "string" ? String((parsed as any).rationale) : base.rationale,
    };
  } catch {
    return base;
  }
}
