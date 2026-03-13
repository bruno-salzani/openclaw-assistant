import type { ToolRegistry } from "../tools/registry/tool-registry.js";
import type { LearnedSkillSpec } from "./skill-registry.js";

export type SkillValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function normalizeId(id: string) {
  return String(id ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isRiskyTool(tool: string) {
  const svc = String(tool.split(".")[0] ?? "");
  return ["terminal", "docker", "filesystem", "email", "postgres"].includes(svc);
}

export function validateLearnedSkill(params: {
  spec: Pick<LearnedSkillSpec, "id" | "description" | "steps">;
  toolRegistry?: ToolRegistry;
}) {
  const errors: string[] = [];
  const warnings: string[] = [];

  const id = normalizeId(params.spec.id);
  if (!id) errors.push("missing id");
  if (id.includes(".")) errors.push("id must not contain '.'");
  if (id.length > 64) warnings.push("id too long");
  const desc = String(params.spec.description ?? "").trim();
  if (!desc) warnings.push("missing description");

  const steps = Array.isArray(params.spec.steps) ? params.spec.steps : [];
  if (steps.length === 0) errors.push("missing steps");
  if (steps.length > 12) warnings.push("too many steps");

  const allowRisky = process.env.IA_ASSISTANT_SKILL_LEARNING_ALLOW_RISKY_TOOLS === "1";
  const known = params.toolRegistry ? new Set(params.toolRegistry.list().map((t) => t.name)) : null;
  for (const s of steps) {
    const tool = String((s as any)?.tool ?? "").trim();
    if (!tool) {
      errors.push("step missing tool");
      continue;
    }
    if (known && !known.has(tool)) warnings.push(`unknown tool: ${tool}`);
    if (isRiskyTool(tool) && !allowRisky) errors.push(`risky tool not allowed: ${tool}`);
    const tpl = (s as any)?.argsTemplate;
    if (tpl && typeof tpl !== "object") errors.push(`argsTemplate must be object for ${tool}`);
  }

  return { ok: errors.length === 0, errors, warnings } satisfies SkillValidationResult;
}

