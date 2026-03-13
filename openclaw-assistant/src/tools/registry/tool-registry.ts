export type ToolManifest = {
  name: string;
  description: string;
  permissions: string[];
  rateLimit?: number;
  riskLevel?: "low" | "medium" | "high";
  costUsdPerCall?: number;
  timeoutMs?: number;
  retry?: { max?: number; backoffMs?: number };
  plugin?: { id: string; root: string };
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolManifest>();

  register(manifest: ToolManifest) {
    this.tools.set(manifest.name, manifest);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  list() {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      permissions: t.permissions,
      rateLimit: t.rateLimit,
      riskLevel: t.riskLevel,
      costUsdPerCall: t.costUsdPerCall,
      timeoutMs: t.timeoutMs,
      retry: t.retry,
      plugin: t.plugin,
    }));
  }
}
