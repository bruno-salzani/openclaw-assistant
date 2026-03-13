import fs from "node:fs";
import path from "node:path";
import type { SkillMarketplace } from "../../skills/marketplace.js";
import type { MetricsRegistry } from "../../observability/metrics.js";
import type { Skill } from "../../skills/skill-types.js";

function readJsonSafe(p: string) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function stripYamlScalar(v: string) {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontMatterLite(md: string): Record<string, any> | null {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const obj: Record<string, any> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "---") {
      i++;
      break;
    }
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    obj[m[1]] = stripYamlScalar(m[2] ?? "");
  }
  return obj;
}

function readSkillMd(p: string) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

export function loadOpenClawPlugins(
  openclawRoot: string,
  marketplace: SkillMarketplace,
  metrics: MetricsRegistry
) {
  const extensionsDir = path.join(openclawRoot, "extensions");
  if (!fs.existsSync(extensionsDir)) return;
  const plugins: Array<{ root: string; manifest: any; skills: string[] }> = [];
  const dirs = fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());
  for (const d of dirs) {
    const pluginJson = path.join(extensionsDir, d.name, "openclaw.plugin.json");
    if (!fs.existsSync(pluginJson)) continue;
    const manifest = readJsonSafe(pluginJson);
    if (!manifest) continue;
    const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
    plugins.push({ root: path.join(extensionsDir, d.name), manifest, skills });
  }
  let pluginCount = 0;
  let skillCount = 0;
  for (const p of plugins) {
    const pluginId = String(p.manifest.id ?? path.basename(p.root));
    const pluginSkill: Skill = {
      id: `openclaw.plugin.${pluginId}`,
      description: String(p.manifest.description ?? `OpenClaw plugin ${pluginId}`),
      commands: [
        {
          name: "info",
          input: {},
          run: async () => ({
            ok: true,
            id: pluginId,
            name: p.manifest.name ?? null,
            description: p.manifest.description ?? null,
            channels: p.manifest.channels ?? null,
            nodes: p.manifest.nodes ?? null,
            skills: p.manifest.skills ?? null,
            configSchema: p.manifest.configSchema ?? null,
          }),
        },
      ],
    };
    marketplace.register(pluginSkill);
    pluginCount++;

    for (const rel of p.skills) {
      const skillDir = path.join(p.root, rel);
      if (!fs.existsSync(skillDir)) continue;
      const entries = fs
        .readdirSync(skillDir, { withFileTypes: true })
        .filter((e) => e.isDirectory());
      for (const e of entries) {
        const mdPath = path.join(skillDir, e.name, "SKILL.md");
        if (!fs.existsSync(mdPath)) continue;
        const md = readSkillMd(mdPath);
        const fm = parseFrontMatterLite(md) ?? {};
        const titleLine = md.split(/\r?\n/).find((l) => /^#\s+/.test(l)) ?? "";
        const title = titleLine.replace(/^#\s*/, "").trim();
        const name = String(fm.name ?? (title || e.name));
        const id = `openclaw.plugin.${pluginId}.${e.name}`;
        const skill: Skill = {
          id,
          description: String(fm.description ?? `OpenClaw plugin skill ${name}`),
          commands: [
            {
              name: "info",
              input: {},
              run: async () => ({
                ok: true,
                id,
                name,
                description: fm.description ?? null,
                plugin: pluginId,
              }),
            },
          ],
        };
        marketplace.register(skill);
        skillCount++;
      }
    }
  }
  if (pluginCount > 0)
    metrics
      .createCounter("openclaw_plugins_loaded_total", "Total OpenClaw plugins loaded")
      .inc(pluginCount);
  if (skillCount > 0)
    metrics
      .createCounter("openclaw_plugin_skills_loaded_total", "Total OpenClaw plugin skills loaded")
      .inc(skillCount);
}
