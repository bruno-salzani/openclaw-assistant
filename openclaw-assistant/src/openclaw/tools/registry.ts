import type { OpenClawTool } from "./tool.js";

export class ToolRegistry {
  private readonly tools = new Map<string, OpenClawTool>();

  register(tool: OpenClawTool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  list() {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      permissions: t.permissions,
      schema: t.schema ?? null,
    }));
  }
}
