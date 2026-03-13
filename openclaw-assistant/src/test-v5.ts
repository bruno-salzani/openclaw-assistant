import { CoordinatorAgent } from "./agents/roles/coordinator-agent.js";
import { ToolExecutionEngine } from "./tools/execution-engine.js";
import { MemorySystem } from "./memory/memory-system.js";
import { SkillMarketplace } from "./skills/marketplace.js";
import { KnowledgeGraph } from "./knowledge-graph/graph.js";
import { Tracer } from "./observability/tracing.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { InMemoryTaskQueue } from "./tasks/inmemory-queue.js";
import { defaultFirewall } from "./security/instruction-firewall.js";

async function runV5Test() {
  console.log("Starting v5 Self-Evolution Test...");

  // 1. Setup Deps
  const metrics = new MetricsRegistry();
  const tools = new ToolExecutionEngine(metrics);

  // Mock Memory System
  const memory = {
    init: async () => {},
    add: async (type: string, content: string, _metadata?: any) => {
      console.log(`[Memory Add] ${type}: ${content}`);
    },
    search: async () => [],
    getSessionContext: async () => [],
    logExecutionStart: async () => "exec-1",
    logExecutionEnd: async () => {},
    logTask: async () => {},
    updateTask: async () => {},
    incrementTaskRetry: async () => {},
    logEvent: async (event: any) => console.log(`[Event Logged] ${JSON.stringify(event)}`),
  } as unknown as MemorySystem;

  const skills = new SkillMarketplace(metrics);
  const graph = new KnowledgeGraph(metrics);
  const tracer = new Tracer(metrics);
  const queue = new InMemoryTaskQueue();

  const deps = {
    tools,
    memory,
    skills,
    graph,
    tracer,
    metrics,
    queue,
    firewall: defaultFirewall,
  };

  // Register basic tools
  tools.registerTool("web.search", async (input) => ({ result: `Searched for ${input.query}` }));
  tools.registerTool("files.read", async (_input) => ({ content: "File content" }));

  // 2. Instantiate Coordinator
  const coordinator = new CoordinatorAgent(deps);

  // 3. Test Agent Creation (Unknown Intent)
  console.log("\n--- Testing Dynamic Agent Creation ---");
  const unknownInput =
    "Please optimize my quantum computing algorithms using advanced physics simulation.";
  // This input is likely to be classified as "unknown" or low confidence

  // Mock intent classifier to return "unknown" for this input if needed,
  // but let's rely on the mock implementation in CognitiveCore (which uses simple logic or mock).
  // In `CognitiveCore.ts`, I added logic: if intent.type === "unknown" ...
  // But `IntentClassifier` in `intent.ts` is likely simple.
  // Let's modify `intent.ts` briefly or rely on its current behavior.
  // Actually, let's just run and see. If it classifies as "research", it won't create agent.
  // I'll update `IntentClassifier` mock in `intent.ts` if needed.

  const result1 = await coordinator.handle({
    text: unknownInput,
    sessionId: "test-session-v5",
    userId: "user-1",
    userRole: "admin",
    channel: "cli",
    metadata: { modality: "text" },
  });

  console.log("Result 1:", result1.text);

  // 4. Test Skill Generation (Simulated via Self-Improvement)
  console.log("\n--- Testing Self-Improvement & Skill Generation ---");
  // We need to trigger the probability check in CognitiveCore.perceive
  // It uses Math.random() > 0.95.
  // We can loop a few times to trigger it.

  for (let i = 0; i < 50; i++) {
    await coordinator.handle({
      text: "status check",
      sessionId: "test-session-v5",
      userId: "user-1",
      userRole: "admin",
      channel: "cli",
      metadata: { modality: "text" },
    });
  }

  // Check memory for generated skills
  // In `SkillGenerator.ts`, it logs to memory: "Generated new skill: ..."
  // But `MemorySystem` mock implementation might just log to console or store in array.
  // Let's check `MemorySystem`.

  console.log("Test Complete.");
}

runV5Test().catch(console.error);
