import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { MetricsRegistry } from "../../observability/metrics.js";
import type { ToolExecutionEngine } from "../../tools/execution-engine.js";
import type { ToolRegistry as ManifestRegistry } from "../../tools/registry/tool-registry.js";
import type { OpenClawTool } from "./tool.js";
import { ToolRegistry } from "./registry.js";

type ToolModule = { default?: any; tool?: any };

function readJsonSafe(p: string) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function normTool(obj: any, manifest: any): OpenClawTool | null {
  const tool = obj && typeof obj === "object" ? obj : null;
  if (!tool) return null;
  const name =
    typeof tool.name === "string"
      ? tool.name
      : typeof manifest?.name === "string"
        ? manifest.name
        : "";
  if (!name) return null;
  const description =
    typeof tool.description === "string"
      ? tool.description
      : typeof manifest?.description === "string"
        ? manifest.description
        : "";
  const permissions = Array.isArray(tool.permissions)
    ? tool.permissions.map(String)
    : Array.isArray(manifest?.permissions)
      ? manifest.permissions.map(String)
      : [];
  const execute = tool.execute;
  if (typeof execute !== "function") return null;
  const schema = tool.schema && typeof tool.schema === "object" ? tool.schema : undefined;
  return {
    name: String(name),
    description: String(description || `OpenClaw tool ${name}`),
    permissions,
    schema,
    execute: execute.bind(tool),
  };
}

export async function loadOpenClawTools(params: {
  extensionsDir: string;
  metrics: MetricsRegistry;
  engine?: ToolExecutionEngine;
  manifestRegistry?: ManifestRegistry;
  registry?: ToolRegistry;
  bustImportCache?: boolean;
  allowlist?: string[];
}) {
  const registry = params.registry ?? new ToolRegistry();
  if (!fs.existsSync(params.extensionsDir)) return { registry, loaded: 0 };

  const dirs = fs
    .readdirSync(params.extensionsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const allow = Array.isArray(params.allowlist)
    ? new Set(params.allowlist.map((x) => String(x).trim()).filter(Boolean))
    : null;

  let loaded = 0;
  for (const d of dirs) {
    if (allow && !allow.has(d.name)) continue;
    const root = path.join(params.extensionsDir, d.name);
    const manifestPath = path.join(root, "openclaw.plugin.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = readJsonSafe(manifestPath);
    if (!manifest || typeof manifest !== "object") continue;
    if (String((manifest as any).type ?? "") !== "tool") continue;
    const entry =
      typeof (manifest as any).entry === "string" ? String((manifest as any).entry) : "index.js";
    const entryPath = path.join(root, entry);
    if (!fs.existsSync(entryPath)) continue;

    const url = pathToFileURL(entryPath).href;
    const mod = (await import(
      params.bustImportCache ? `${url}?v=${Date.now()}` : url
    )) as ToolModule;
    const tool = normTool(mod.tool ?? mod.default, manifest);
    if (!tool) continue;

    registry.register(tool);
    loaded += 1;

    if (params.engine) {
      params.engine.registerTool(tool.name, async (input: any) => tool.execute(input));
    }
    if (params.manifestRegistry) {
      const pluginId =
        typeof (manifest as any).name === "string" ? String((manifest as any).name) : d.name;
      const riskLevel =
        (manifest as any).riskLevel === "low"
          ? "low"
          : (manifest as any).riskLevel === "medium"
            ? "medium"
            : (manifest as any).riskLevel === "high"
              ? "high"
              : undefined;
      const retry =
        (manifest as any).retry && typeof (manifest as any).retry === "object"
          ? {
              max:
                typeof (manifest as any).retry.max === "number"
                  ? Number((manifest as any).retry.max)
                  : undefined,
              backoffMs:
                typeof (manifest as any).retry.backoffMs === "number"
                  ? Number((manifest as any).retry.backoffMs)
                  : undefined,
            }
          : undefined;
      params.manifestRegistry.register({
        name: tool.name,
        description: tool.description,
        permissions: tool.permissions,
        rateLimit:
          typeof (manifest as any).rateLimit === "number"
            ? Number((manifest as any).rateLimit)
            : undefined,
        riskLevel,
        costUsdPerCall:
          typeof (manifest as any).costUsdPerCall === "number"
            ? Number((manifest as any).costUsdPerCall)
            : undefined,
        timeoutMs:
          typeof (manifest as any).timeoutMs === "number"
            ? Number((manifest as any).timeoutMs)
            : undefined,
        retry,
        plugin: { id: pluginId, root },
      });
    }
  }

  if (loaded > 0) {
    params.metrics
      .createCounter("openclaw_tools_loaded_total", "Total OpenClaw tools loaded")
      .inc(loaded);
  }

  return { registry, loaded };
}
