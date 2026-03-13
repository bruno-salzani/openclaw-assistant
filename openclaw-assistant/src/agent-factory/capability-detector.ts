import type { LLMProvider } from "../llm/llm-provider.js";
import type { AgentRegistry } from "./agent-registry.js";
import type { CapabilityGap } from "./types.js";

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

export function extractCapabilitiesHeuristic(task: string) {
  const t = String(task ?? "").toLowerCase();
  const caps: string[] = [];

  const add = (c: string) => caps.push(c);

  if (/\bpdf\b/.test(t)) add("pdf-parsing");
  if (/\bcontract\b|\blegal\b|\bnda\b/.test(t)) add("legal-nlp");
  if (/\bclause\b|\bclauses\b/.test(t)) add("clause-extraction");
  if (/\bemail\b|\bgmail\b/.test(t)) add("email");
  if (/\bcalendar\b|\bmeeting\b/.test(t)) add("calendar");
  if (/\bslack\b/.test(t)) add("slack");
  if (/\btelegram\b/.test(t)) add("telegram");
  if (/\bdiscord\b/.test(t)) add("discord");
  if (/\bsearch\b|\bgoogle\b|\bweb\b|\bresearch\b/.test(t)) add("web-search");
  if (/\bgithub\b|\bpr\b|\bcommit\b/.test(t)) add("github");
  if (/\bpostgres\b|\bsql\b|\bquery\b/.test(t)) add("database-sql");
  if (/\bchart\b|\bmetrics\b|\bobservability\b/.test(t)) add("observability");
  if (/\brefactor\b|\bbug\b|\btypescript\b|\bcode\b/.test(t)) add("coding");

  return uniq(caps);
}

async function extractCapabilitiesWithLlm(task: string, llm: LLMProvider): Promise<string[] | null> {
  const content = String(task ?? "").trim();
  if (!content) return [];
  const system = [
    "Extraia capacidades necessárias para resolver a tarefa.",
    "Responda APENAS um JSON válido, sem markdown.",
    'Formato: { "capabilities": string[] }',
    "Use identificadores curtos em kebab-case.",
    "Exemplos: pdf-parsing, legal-nlp, clause-extraction, web-search, github, database-sql, coding",
    "Retorne no máximo 12 itens.",
  ].join("\n");
  try {
    const out = await llm.chat({
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      temperature: 0.1,
      maxTokens: 200,
    });
    const parsed = JSON.parse(out) as any;
    const arr = Array.isArray(parsed?.capabilities) ? parsed.capabilities : [];
    return uniq(arr.map(String)).slice(0, 12);
  } catch {
    return null;
  }
}

export async function extractCapabilities(params: { task: string; llm?: LLMProvider }) {
  const enabled = process.env.IA_ASSISTANT_AGENT_FACTORY_ENABLE !== "0";
  if (!enabled) return [];
  const useLlm = Boolean(params.llm) && process.env.IA_ASSISTANT_AGENT_FACTORY_LLM_EXTRACT === "1";
  const llmCaps = useLlm ? await extractCapabilitiesWithLlm(params.task, params.llm!) : null;
  return llmCaps ?? extractCapabilitiesHeuristic(params.task);
}

export async function detectCapabilityGap(params: {
  task: string;
  registry: AgentRegistry;
  llm?: LLMProvider;
}): Promise<CapabilityGap | null> {
  const requiredCapabilities = await extractCapabilities({ task: params.task, llm: params.llm });
  if (requiredCapabilities.length === 0) return null;
  const candidates = params.registry.findAgents(requiredCapabilities);
  if (candidates.length > 0) return null;
  return { task: params.task, requiredCapabilities, candidates: [] };
}
