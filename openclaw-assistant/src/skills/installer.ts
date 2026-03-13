import type { MetricsRegistry } from "../observability/metrics.js";
import type { SkillMarketplace } from "./marketplace.js";
import type { Skill } from "./skill-types.js";
import type { SkillManifest } from "./registry.js";

export function installSkillManifests(params: {
  marketplace: SkillMarketplace;
  metrics: MetricsRegistry;
  manifests: SkillManifest[];
}) {
  const manifests = Array.isArray(params.manifests) ? params.manifests : [];
  let installed = 0;
  for (const m of manifests) {
    const id = `skill.${m.id}`;
    const skill: Skill = {
      id,
      description: m.name,
      commands: [
        {
          name: "info",
          input: {},
          run: async () => ({ ok: true, id, name: m.name, tools: m.tools, steps: m.steps }),
        },
        {
          name: "run",
          input: {},
          run: async (input: any) => ({
            ok: true,
            id,
            name: m.name,
            tools: m.tools,
            steps: m.steps,
            input,
          }),
        },
      ],
    };
    params.marketplace.register(skill);
    installed += 1;
  }
  params.metrics.createCounter("skill_registry_installed_total", "Skills installed from local registry").inc(installed);
  return { ok: true, installed };
}

