import type { AgentDeps } from "../agents/agent-deps.js";
import type { LearnedSkillSpec } from "./skill-registry.js";
import fs from "node:fs";
import path from "node:path";

export type ToolExecCtx = {
  sandbox?: boolean;
  timeout?: number;
  userRole?: string;
  permissions?: string[];
  traceId?: string;
  cacheTtlMs?: number;
  rate?: { perMin: number };
  approved?: boolean;
  source?: string;
  workspaceId?: string;
};

function getPath(obj: any, pathStr: string): any {
  const parts = pathStr.split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (p.endsWith("]")) {
      const m = p.match(/^(.+)\[(\d+)\]$/);
      if (m) {
        cur = cur[m[1]];
        cur = Array.isArray(cur) ? cur[Number(m[2])] : undefined;
        continue;
      }
    }
    cur = cur[p];
  }
  return cur;
}

function templateValue(v: any, ctx: any): any {
  if (typeof v === "string") {
    const m = v.match(/^\{\{(.+)\}\}$/);
    if (m) return getPath(ctx, m[1].trim());
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => templateValue(x, ctx));
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, vv] of Object.entries(v)) out[k] = templateValue(vv, ctx);
    return out;
  }
  return v;
}

export function buildLearnedSkillTool(params: {
  deps: AgentDeps;
  spec: Pick<LearnedSkillSpec, "id" | "description" | "steps">;
}) {
  const toolName = `skill.${params.spec.id}`;
  const steps = params.spec.steps.slice(0, 20);

  const handler = async (input: Record<string, any>, execCtx?: ToolExecCtx) => {
    const results: any[] = [];
    const ctx = { input, prev: { results } };
    const perms = execCtx?.permissions ?? [];
    const userRole = execCtx?.userRole ?? "service";
    const workspaceId = execCtx?.workspaceId;
    const traceId = execCtx?.traceId;
    const approved = execCtx?.approved;

    for (const step of steps) {
      let args = templateValue(step.argsTemplate ?? {}, ctx);
      if (args && typeof args === "object" && "$" in (args as any)) args = (args as any).$;
      const out = await params.deps.tools.execute(step.tool, (args ?? {}) as any, {
        userRole,
        permissions: perms,
        workspaceId,
        traceId,
        approved,
        source: `skill_learning:${params.spec.id}`,
      });
      results.push({ tool: step.tool, args, out });
    }
    return { ok: true, tool: toolName, outputs: results };
  };

  return { toolName, description: params.spec.description, handler };
}

export function registerLearnedSkill(params: {
  deps: AgentDeps;
  spec: Pick<LearnedSkillSpec, "id" | "description" | "steps">;
}) {
  const built = buildLearnedSkillTool(params);
  params.deps.tools.registerTool(built.toolName, built.handler as any);
  if (params.deps.permissions) {
    params.deps.permissions.grant("automation_agent", ["skill.*"]);
    params.deps.permissions.grant("autonomy_controller", ["skill.*"]);
  }
  return built.toolName;
}

export function writeLearnedSkillTs(params: {
  baseDir: string;
  spec: Pick<LearnedSkillSpec, "id" | "description" | "steps">;
}) {
  const dir = path.join(params.baseDir, "skills");
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${params.spec.id}.ts`);
  const content = [
    `export const learnedSkill = ${JSON.stringify(
      {
        id: params.spec.id,
        description: params.spec.description,
        steps: params.spec.steps,
      },
      null,
      2
    )} as const;`,
    ``,
  ].join("\n");
  fs.writeFileSync(filePath, content);
  return filePath;
}
