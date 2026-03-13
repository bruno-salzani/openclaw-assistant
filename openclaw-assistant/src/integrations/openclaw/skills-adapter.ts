import fs from "node:fs";
import path from "node:path";
import type { SkillMarketplace } from "../../skills/marketplace.js";
import type { MetricsRegistry } from "../../observability/metrics.js";
import type { Skill } from "../../skills/skill-types.js";

function readFileSafe(p: string) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
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
    const key = m[1];
    const rest = m[2] ?? "";
    obj[key] = stripYamlScalar(rest);
  }

  const metaStart = lines.findIndex((l, idx) => idx > 0 && idx < i && l.trim() === "metadata:");
  if (metaStart !== -1) {
    const metaLines: string[] = [];
    for (let j = metaStart + 1; j < i; j++) {
      const raw = lines[j] ?? "";
      if (/^\S/.test(raw)) break;
      metaLines.push(raw.replace(/^\s+/, ""));
    }
    if (metaLines.length > 0) obj.metadataRaw = metaLines.join("\n").trim();
  }

  return obj;
}

function parseSkillMd(md: string) {
  const lines = md.split(/\r?\n/);
  const titleLine = lines.find((l) => /^#\s+/.test(l)) ?? "";
  const name = titleLine.replace(/^#\s*/, "").trim() || "Unnamed Skill";
  return { name };
}

export function loadOpenClawSkills(
  openclawRoot: string,
  marketplace: SkillMarketplace,
  metrics: MetricsRegistry,
  allowlist?: string[]
) {
  const skillsDir = path.join(openclawRoot, "skills");
  if (!fs.existsSync(skillsDir)) return;
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const allowed = Array.isArray(allowlist) ? new Set(allowlist.map(String)) : null;
  let loaded = 0;
  for (const dir of entries) {
    const skillKey = dir.name;
    if (allowed && !allowed.has(skillKey)) continue;
    const mdPath = path.join(skillsDir, skillKey, "SKILL.md");
    if (!fs.existsSync(mdPath)) continue;
    const md = readFileSafe(mdPath);
    const fm = parseFrontMatterLite(md) ?? {};
    const meta = parseSkillMd(md);
    const id = `openclaw.${skillKey}`;
    const skill: Skill = {
      id,
      description: String(fm.description ?? "OpenClaw skill"),
      commands: [
        {
          name: "info",
          input: {},
          run: async () => ({
            ok: true,
            id,
            name: String(fm.name ?? meta.name),
            description: String(fm.description ?? "OpenClaw skill"),
            metadataRaw: fm.metadataRaw ?? null,
          }),
        },
      ],
    };
    marketplace.register(skill);
    loaded += 1;
  }
  metrics
    .createCounter("openclaw_skills_loaded_total", "Total OpenClaw skills loaded")
    .inc(loaded);
}
