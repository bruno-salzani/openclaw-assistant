import type { CognitivePlan } from "../types.js";

function slug(id: string) {
  return String(id ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function expandHierarchicalSwarm(plan: CognitivePlan): CognitivePlan {
  const enabled = process.env.IA_ASSISTANT_SWARM_HIERARCHY_ENABLE === "1";
  if (!enabled) return plan;
  const spawn = Array.isArray(plan.spawn) ? plan.spawn : [];
  const expanded: CognitivePlan["spawn"] = [];
  for (const s of spawn) {
    const id = slug(s.id);
    if (s.role === "research") {
      expanded.push(
        { id: `${id}_web`, role: "research", prompt: `${s.prompt}\nFoco: web e fontes recentes.` },
        { id: `${id}_papers`, role: "research", prompt: `${s.prompt}\nFoco: papers/artigos técnicos (se aplicável).` },
        { id: `${id}_data`, role: "research", prompt: `${s.prompt}\nFoco: dados, números e evidências.` }
      );
      continue;
    }
    expanded.push({ ...s, id });
  }
  return { ...plan, spawn: expanded.slice(0, 12) };
}

