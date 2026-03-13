import type { ToolRegistry } from "../tools/registry/tool-registry.js";
import type { SkillMarketplace } from "../skills/marketplace.js";
import type { AgentBlueprint } from "./types.js";

export type AgentValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

export function validateAgentBlueprint(params: {
  blueprint: AgentBlueprint;
  toolRegistry?: ToolRegistry;
  skills?: SkillMarketplace;
}): AgentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bp = params.blueprint;

  if (!bp.name || !String(bp.name).trim()) errors.push("missing blueprint.name");
  if (!bp.description || !String(bp.description).trim()) warnings.push("missing blueprint.description");
  if (!Array.isArray(bp.capabilities) || bp.capabilities.length === 0)
    warnings.push("missing blueprint.capabilities");

  const tools = uniq(Array.isArray(bp.tools) ? bp.tools : []);
  const skills = uniq(Array.isArray(bp.skills) ? bp.skills : []);

  const toolRegistry = params.toolRegistry;
  if (toolRegistry) {
    const known = new Set(toolRegistry.list().map((t) => String(t.name)));
    for (const t of tools) {
      if (!known.has(t)) warnings.push(`unknown tool: ${t}`);
    }
  } else if (tools.length > 0) {
    warnings.push("toolRegistry not provided; cannot validate blueprint.tools");
  }

  const marketplace = params.skills;
  if (marketplace) {
    const known = new Set(marketplace.list().map((s) => String(s.id)));
    for (const s of skills) {
      const prefix = String(s).split(".")[0] ?? s;
      if (!known.has(prefix)) warnings.push(`unknown skill: ${s}`);
    }
  } else if (skills.length > 0) {
    warnings.push("skills marketplace not provided; cannot validate blueprint.skills");
  }

  if (bp.memory !== "vector" && bp.memory !== "episodic") errors.push("invalid blueprint.memory");

  return { ok: errors.length === 0, errors, warnings };
}

