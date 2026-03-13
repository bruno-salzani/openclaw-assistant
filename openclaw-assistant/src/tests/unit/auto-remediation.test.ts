import test from "node:test";
import assert from "node:assert/strict";
import { AutoRemediator } from "../../automations/auto-remediation.js";
import { EventBus } from "../../infra/event-bus.js";
import { MetricsRegistry } from "../../observability/metrics.js";
import { Tracer } from "../../observability/tracing.js";
import { ToolExecutionEngine } from "../../tools/execution-engine.js";
import { SkillMarketplace } from "../../skills/marketplace.js";
import { KnowledgeGraph } from "../../knowledge-graph/graph.js";
import { InMemoryTaskQueue } from "../../tasks/inmemory-queue.js";
import { PermissionManager } from "../../agents/security/permission-manager.js";
import { defaultFirewall } from "../../security/instruction-firewall.js";

test("AutoRemediator: gera tool auto.* executável com permissões auto.*", async () => {
  const bus = new EventBus();
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const tools = new ToolExecutionEngine(metrics);
  tools.setBus(bus);
  const skills = new SkillMarketplace(metrics);
  const graph = new KnowledgeGraph(metrics);
  const queue = new InMemoryTaskQueue();
  const memory: any = { add: async () => {} };

  const deps: any = {
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    firewall: defaultFirewall,
    queue,
    bus,
  };
  const permissions = new PermissionManager(deps);
  deps.permissions = permissions;

  tools.registerTool("browser.search", async () => ({ ok: true, source: "mock" }));

  const remediator = new AutoRemediator(deps);
  remediator.start();

  for (let i = 0; i < 5; i++) {
    bus.emit("tool.error", { tool: "browser.search", error: "fail", lastArgs: { query: "x" } });
  }
  await new Promise((r) => setTimeout(r, 0));

  const autoTool = "auto.browser.search.retry";
  assert.equal(tools.listTools().includes(autoTool), true);

  const perms = permissions.getPermissions("automation_agent");
  const out = await tools.execute(autoTool, {}, { userRole: "service", permissions: perms });
  assert.equal(out.ok, true);
});

test("AutoRemediator: rollback quando self-test falha", async () => {
  const bus = new EventBus();
  const metrics = new MetricsRegistry();
  const tracer = new Tracer(metrics);
  const tools = new ToolExecutionEngine(metrics);
  tools.setBus(bus);
  const skills = new SkillMarketplace(metrics);
  const graph = new KnowledgeGraph(metrics);
  const queue = new InMemoryTaskQueue();
  const memory: any = { add: async () => {} };

  const deps: any = {
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    firewall: defaultFirewall,
    queue,
    bus,
  };
  const permissions = new PermissionManager(deps);
  deps.permissions = permissions;

  tools.registerTool("browser.search", async () => {
    throw new Error("boom");
  });

  const remediator = new AutoRemediator(deps);
  remediator.start();

  for (let i = 0; i < 5; i++) {
    bus.emit("tool.error", { tool: "browser.search", error: "fail", lastArgs: { query: "x" } });
  }
  await new Promise((r) => setTimeout(r, 0));

  const autoTool = "auto.browser.search.retry";
  assert.equal(tools.hasTool(autoTool), false);
});
