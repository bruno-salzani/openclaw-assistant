import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { AgentOrchestrator } from "../../agents/orchestrator.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { SkillMarketplace } from "../../skills/marketplace.js";
import { MarketplaceManager } from "../../marketplace/manager.js";

test("MarketplaceManager loads agent plugin.json entry and registers agent", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-mkt-"));
  const repo = path.join(tmp, "openclaw-hub");
  fs.mkdirSync(path.join(repo, "agents", "web-research-agent"), { recursive: true });

  fs.writeFileSync(
    path.join(repo, "agents", "web-research-agent", "plugin.json"),
    JSON.stringify(
      {
        name: "web-research-agent",
        version: "1.0.0",
        type: "agent",
        entry: "index.js",
        permissions: ["browser.*"],
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(repo, "agents", "web-research-agent", "index.js"),
    [
      "export default async function register(ctx) {",
      "  await ctx.registerAgentSpec({",
      '    id: "web_research_agent",',
      '    role: "web_research",',
      '    capabilities: ["browser.*"],',
      '    systemPrompt: "You are a web research agent.",',
      "  });",
      "}",
      "",
    ].join("\n")
  );

  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const tools = new ToolExecutionEngine(metrics);
  const skills = new SkillMarketplace(metrics);
  const orchestrator = new AgentOrchestrator({
    agents: [],
    tools,
    memory: {} as any,
    skills,
    graph: {} as any,
    tracer,
    metrics,
  });

  const agentDeps: any = {
    tools,
    memory: { add: async () => {} },
    skills,
    graph: {} as any,
    tracer,
    metrics,
    firewall: {} as any,
    queue: {} as any,
    permissions: { grant: () => undefined, getPermissions: () => ["*"] },
  };

  const manager = new MarketplaceManager({
    repoPath: repo,
    baseDir: tmp,
    agentDeps,
    orchestrator,
    workerPool: { registerAgent: () => undefined } as any,
    skills,
    tools,
    metrics,
  });

  manager.install("agent", "web-research-agent");
  const res = await manager.applyInstalled();
  assert.equal(res.ok, true);
  assert.ok(orchestrator.getAgent("web_research" as any));
});

