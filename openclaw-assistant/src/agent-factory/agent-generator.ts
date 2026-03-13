import fs from "node:fs";
import path from "node:path";
import type { AgentBlueprint } from "./types.js";
import { bumpVersion } from "./agent-versioning.js";

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

function systemPromptForBlueprint(bp: AgentBlueprint) {
  const caps = uniq(bp.capabilities);
  const tools = uniq(bp.tools);
  const skills = uniq(bp.skills);
  return [
    `You are ${bp.name}, an autonomous agent.`,
    bp.description ? `Description: ${bp.description}` : "",
    caps.length ? `Capabilities: ${caps.join(", ")}` : "",
    tools.length ? `Allowed tools: ${tools.join(", ")}` : "",
    skills.length ? `Allowed skills: ${skills.join(", ")}` : "",
    "Be concise. Prefer deterministic steps. Ask for confirmation on risky operations unless policy allows.",
  ]
    .filter(Boolean)
    .join("\n");
}

export type GeneratedAgentPlugin = {
  name: string;
  version: string;
  rootDir: string;
  entry: string;
};

export function generateAgentPlugin(params: {
  blueprint: AgentBlueprint;
  outDir?: string;
  version?: string;
  role?: string;
}) {
  const name = normalizeName(params.blueprint.name);
  const baseDir = params.outDir ?? path.join(process.cwd(), ".ia-assistant", "agent-factory", "generated");
  const rootDir = path.join(baseDir, "agents", name);
  fs.mkdirSync(rootDir, { recursive: true });

  const version = params.version ? String(params.version) : bumpVersion("0.0.0", "minor");
  const entry = "index.js";

  const permissions = uniq([...params.blueprint.tools, ...params.blueprint.skills]).slice(0, 200);

  const pluginJson = {
    name,
    version,
    type: "agent",
    entry,
    description: params.blueprint.description,
    permissions,
  };
  fs.writeFileSync(path.join(rootDir, "plugin.json"), JSON.stringify(pluginJson, null, 2));

  const systemPrompt = systemPromptForBlueprint(params.blueprint);
  const role = params.role ? String(params.role) : "automation";

  const js = [
    `export default async function register(ctx) {`,
    `  await ctx.registerAgentSpec({`,
    `    id: ${JSON.stringify(name)},`,
    `    role: ${JSON.stringify(role)},`,
    `    capabilities: ${JSON.stringify(permissions)},`,
    `    systemPrompt: ${JSON.stringify(systemPrompt)},`,
    `  });`,
    `}`,
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(rootDir, entry), js);

  return { name, version, rootDir, entry } satisfies GeneratedAgentPlugin;
}

