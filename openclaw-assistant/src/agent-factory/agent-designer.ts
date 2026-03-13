import type { ToolRegistry } from "../tools/registry/tool-registry.js";
import type { SkillMarketplace } from "../skills/marketplace.js";
import type { AgentBlueprint } from "./types.js";

function normalizeName(name: string) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

function pickToolsByHint(allTools: { name: string }[], hints: string[]) {
  const out: string[] = [];
  const hs = hints.map((h) => h.toLowerCase());
  for (const t of allTools) {
    const name = String(t.name ?? "");
    const n = name.toLowerCase();
    if (hs.some((h) => n.includes(h))) out.push(name);
  }
  return uniq(out).slice(0, 20);
}

function pickSkillsByHint(allSkills: { id: string }[], hints: string[]) {
  const out: string[] = [];
  const hs = hints.map((h) => h.toLowerCase());
  for (const s of allSkills) {
    const id = String(s.id ?? "");
    const n = id.toLowerCase();
    if (hs.some((h) => n.includes(h))) out.push(id);
  }
  return uniq(out).slice(0, 20);
}

export function designAgentBlueprint(params: {
  name: string;
  description?: string;
  requiredCapabilities: string[];
  toolRegistry?: ToolRegistry;
  skills?: SkillMarketplace;
}): AgentBlueprint {
  const name = normalizeName(params.name);
  const capabilities = uniq(params.requiredCapabilities);
  const allTools = params.toolRegistry?.list?.() ?? [];
  const allSkills = params.skills?.list?.() ?? [];

  const hints = capabilities.flatMap((c) => {
    if (c === "web-search") return ["search", "browser", "web"];
    if (c === "pdf-parsing") return ["pdf", "document", "files"];
    if (c === "database-sql") return ["postgres", "sql"];
    if (c === "github") return ["github"];
    if (c === "email") return ["email", "gmail"];
    if (c === "calendar") return ["calendar"];
    if (c === "slack") return ["slack"];
    if (c === "telegram") return ["telegram"];
    if (c === "discord") return ["discord"];
    return [c];
  });

  const tools = pickToolsByHint(allTools as any, hints);
  const skills = pickSkillsByHint(allSkills as any, hints);

  const memory: AgentBlueprint["memory"] =
    capabilities.includes("web-search") || capabilities.includes("legal-nlp") ? "vector" : "episodic";

  return {
    name,
    description: params.description ?? `Auto-generated agent for ${capabilities.join(", ")}`,
    capabilities,
    tools,
    skills,
    memory,
  };
}

