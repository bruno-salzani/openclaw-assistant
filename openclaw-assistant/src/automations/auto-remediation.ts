import type { AgentDeps } from "../agents/agent-deps.js";
import { SkillGenerator } from "../evolution/skill-generator.js";
import { SelfTestingSystem } from "../evolution/self-testing.js";

export class AutoRemediator {
  private counts = new Map<string, { count: number; last: number }>();

  private readonly gen: SkillGenerator;

  private readonly tester: SelfTestingSystem;

  constructor(private readonly deps: AgentDeps) {
    this.gen = new SkillGenerator(deps);
    this.tester = new SelfTestingSystem(deps);
  }

  start() {
    this.deps.bus?.on("tool.error", async (p: any) => {
      const k = String(p.tool);
      if (
        k.startsWith("terminal.") ||
        k.startsWith("docker.") ||
        k.startsWith("filesystem.write") ||
        k.startsWith("email.send") ||
        k.startsWith("postgres.")
      ) {
        return;
      }
      if (this.counts.size > 1000) this.counts.clear();
      const now = Date.now();
      const prev = this.counts.get(k);
      const nextCount = !prev || now - prev.last > 10 * 60_000 ? 1 : prev.count + 1;
      this.counts.set(k, { count: nextCount, last: now });
      if (nextCount >= 5) {
        const toolName = `auto.${k}.retry`;
        await this.gen.generateAutomationScript(toolName, [{ tool: k, args: p.lastArgs ?? {} }]);
        await this.tester.runToolSmokeTest(toolName);
        this.counts.delete(k);
        await this.deps.memory.add("event", "auto_remediation_script_created", {
          tool: k,
          auto: toolName,
        });
      }
    });
  }
}
