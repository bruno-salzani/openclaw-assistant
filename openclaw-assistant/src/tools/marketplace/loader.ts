import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { MetricsRegistry } from "../../observability/metrics.js";
import type { ToolExecutionEngine } from "../execution-engine.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import { toolManifestSchema } from "./tool-manifest.js";

type ToolModule = {
  handler?: (input: Record<string, any>) => Promise<any>;
  createTool?: (ctx: { fetch: typeof fetch }) => (input: Record<string, any>) => Promise<any>;
  default?: any;
};

function readJsonSafe(p: string) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function isAllowlisted(name: string, allowlist?: string[]) {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.includes(name);
}

export async function loadToolMarketplace(params: {
  tools: ToolExecutionEngine;
  registry: ToolRegistry;
  metrics: MetricsRegistry;
  pluginsDir?: string;
  allowlist?: string[];
  forceReload?: boolean;
  bustImportCache?: boolean;
}) {
  const pluginsDir =
    params.pluginsDir ??
    (process.env.IA_ASSISTANT_TOOL_PLUGIN_ROOT
      ? String(process.env.IA_ASSISTANT_TOOL_PLUGIN_ROOT)
      : path.resolve(process.cwd(), "src", "tools", "plugins"));
  if (!fs.existsSync(pluginsDir)) return { loaded: 0, skipped: 0 };

  const enabled = String(process.env.IA_ASSISTANT_TOOL_MARKETPLACE ?? "1") === "1";
  if (!enabled) return { loaded: 0, skipped: 0 };

  const allowlist =
    params.allowlist ??
    String(process.env.IA_ASSISTANT_TOOL_PLUGIN_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  let loaded = 0;
  let skipped = 0;
  const allowOverride = String(process.env.IA_ASSISTANT_TOOL_PLUGIN_ALLOW_OVERRIDE ?? "0") === "1";
  const forceReload = Boolean(params.forceReload);
  const bustCache = Boolean(params.bustImportCache);
  for (const d of dirs) {
    const root = path.join(pluginsDir, d.name);
    const manifestPath = path.join(root, "tool.json");
    if (!fs.existsSync(manifestPath)) continue;

    const raw = readJsonSafe(manifestPath);
    const parsed = toolManifestSchema.safeParse(raw);
    if (!parsed.success) continue;
    const manifest = parsed.data;
    if (!isAllowlisted(manifest.name, allowlist)) continue;
    if (params.tools.hasTool(manifest.name)) {
      const existing = params.registry.get(manifest.name);
      const canOverride = Boolean(existing?.plugin) || allowOverride;
      if (!forceReload || !canOverride) {
        skipped += 1;
        continue;
      }
    }

    const entry = manifest.entry ? String(manifest.entry) : "index.js";
    const entryPath = path.join(root, entry);
    if (!fs.existsSync(entryPath)) continue;

    const url = pathToFileURL(entryPath).href;
    const mod = (await import(bustCache ? `${url}?v=${Date.now()}` : url)) as ToolModule;
    const handler =
      typeof mod.createTool === "function"
        ? mod.createTool({ fetch })
        : typeof mod.handler === "function"
          ? mod.handler
          : typeof mod.default === "function"
            ? (mod.default as any)
            : null;
    if (!handler) continue;

    params.registry.register({
      name: manifest.name,
      description: manifest.description,
      permissions: manifest.permissions ?? [],
      rateLimit: manifest.rateLimit,
      riskLevel: manifest.riskLevel,
      costUsdPerCall: manifest.costUsdPerCall,
      timeoutMs: manifest.timeoutMs,
      retry: manifest.retry,
      plugin: { id: d.name, root },
    });
    params.tools.registerTool(manifest.name, async (input) => handler(input));
    loaded += 1;
  }

  if (loaded > 0) {
    params.metrics
      .createCounter("tool_plugins_loaded_total", "Total tool plugins loaded")
      .inc(loaded);
  }
  return { loaded, skipped };
}
