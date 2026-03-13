import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { AgentRegistry } from "./agent-registry.js";
import { detectCapabilityGap, extractCapabilitiesHeuristic } from "./capability-detector.js";
import { designAgentBlueprint } from "./agent-designer.js";
import { generateAgentPlugin } from "./agent-generator.js";
import { validateAgentBlueprint } from "./agent-validator.js";

function argValue(args: string[], key: string) {
  const idx = args.findIndex((a) => a === key);
  if (idx < 0) return null;
  const v = args[idx + 1];
  return typeof v === "string" ? v : null;
}

function hasFlag(args: string[], key: string) {
  return args.includes(key);
}

function usage() {
  const txt = [
    "Usage:",
    "  tsx src/agent-factory/cli.ts detect --task \"...\"",
    "  tsx src/agent-factory/cli.ts blueprint --name \"...\" --caps \"a,b,c\"",
    "  tsx src/agent-factory/cli.ts generate --task \"...\" --name \"...\" [--outDir \"...\"]",
    "",
    "Notes:",
    "- registry file: .ia-assistant/agents-registry.json",
    "- generated plugin: <outDir>/agents/<name>/plugin.json + index.js",
  ].join("\n");
  process.stdout.write(`${txt}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "";
  if (!cmd || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    usage();
    process.exitCode = 0;
    return;
  }

  const baseDir = process.cwd();
  const registry = new AgentRegistry(baseDir);

  if (cmd === "detect") {
    const task = argValue(args, "--task") ?? args.slice(1).join(" ");
    const capabilities = extractCapabilitiesHeuristic(task);
    const gap = await detectCapabilityGap({ task, registry });
    process.stdout.write(
      `${JSON.stringify({ task, capabilities, gap: gap ? { requiredCapabilities: gap.requiredCapabilities } : null }, null, 2)}\n`
    );
    return;
  }

  if (cmd === "blueprint") {
    const name = argValue(args, "--name") ?? "generated-agent";
    const capsCsv = argValue(args, "--caps") ?? "";
    const caps = capsCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const bp = designAgentBlueprint({ name, requiredCapabilities: caps });
    const validation = validateAgentBlueprint({ blueprint: bp });
    process.stdout.write(`${JSON.stringify({ blueprint: bp, validation }, null, 2)}\n`);
    return;
  }

  if (cmd === "generate") {
    const task = argValue(args, "--task") ?? "";
    const name = argValue(args, "--name") ?? "generated-agent";
    const outDir =
      argValue(args, "--outDir") ?? path.join(process.cwd(), ".ia-assistant", "agent-factory", "generated");

    if (!task.trim()) {
      process.stderr.write("missing --task\n");
      usage();
      process.exitCode = 2;
      return;
    }

    const caps = extractCapabilitiesHeuristic(task);
    const bp = designAgentBlueprint({ name, requiredCapabilities: caps });
    const validation = validateAgentBlueprint({ blueprint: bp });
    if (!validation.ok) {
      process.stderr.write(`${JSON.stringify(validation, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }

    const plugin = generateAgentPlugin({ blueprint: bp, outDir });
    registry.upsert({
      name: bp.name,
      version: plugin.version,
      description: bp.description,
      capabilities: bp.capabilities,
      tools: bp.tools,
      skills: bp.skills,
    } as any);

    fs.mkdirSync(outDir, { recursive: true });
    process.stdout.write(`${JSON.stringify({ ok: true, blueprint: bp, plugin }, null, 2)}\n`);
    return;
  }

  process.stderr.write(`unknown command: ${cmd}\n`);
  usage();
  process.exitCode = 2;
}

main().catch((e) => {
  process.stderr.write(`${String(e?.stack ?? e)}\n`);
  process.exitCode = 1;
});
