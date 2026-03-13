import type { AgentDeps } from "../agents/agent-deps.js";
import type { Skill } from "../skills/skill-types.js";
import { SelfTestingSystem } from "./self-testing.js";

export class SkillGenerator {
  constructor(private readonly deps: AgentDeps) {}

  async generateSkill(name: string, description: string): Promise<Skill | null> {
    // In a real implementation, this would:
    // 1. Call LLM to generate TS code for the skill
    // 2. Compile/Validate code
    // 3. Register skill dynamically

    // For this simulation, we mock the creation of a simple "echo" skill
    // or return a predefined template based on description keywords

    if (description.includes("weather")) {
      const newSkill: Skill = {
        id: name,
        description,
        commands: [
          {
            name: "get",
            input: { location: "string" },
            run: async (input: unknown) => {
              return { ok: true, weather: "sunny", location: (input as any).location, temp: 25 };
            },
          },
        ],
      };

      // Register the new skill
      this.deps.skills.register(newSkill);

      // Log generation event
      await this.deps.memory.add("event", `Generated new skill: ${name}`, { description });

      return newSkill;
    }

    return null;
  }

  async generateAutomationScript(
    toolName: string,
    steps: Array<{ tool: string; args: Record<string, any> }>
  ) {
    // Register a new tool that chains existing tools
    this.deps.tools.registerTool(toolName, async (_input: Record<string, any>) => {
      const outputs: any[] = [];
      const workspaceId = "ws:system";
      const perms = this.deps.permissions
        ? this.deps.permissions.getPermissions("automation_agent", workspaceId)
        : [];
      for (const step of steps) {
        const out = await this.deps.tools.execute(step.tool, step.args, {
          userRole: "service",
          permissions: perms,
          workspaceId,
        });
        outputs.push({ tool: step.tool, out });
      }
      return { ok: true, outputs };
    });
    await this.deps.memory.add("event", `Generated automation script: ${toolName}`, {
      steps: JSON.stringify(steps),
    });
    const tester = new SelfTestingSystem(this.deps);
    const ok = await tester.runToolSmokeTest(toolName);
    if (!ok) {
      this.deps.tools.unregisterTool(toolName);
      await this.deps.memory.add("event", "generated_automation_script_rolled_back", { toolName });
    }
  }

  async generateCompositeSkill(
    name: string,
    description: string,
    steps: Array<{ tool: string; args: Record<string, any> }>
  ): Promise<Skill> {
    const newSkill: Skill = {
      id: name,
      description,
      commands: [
        {
          name: "run",
          input: {}, // Dynamic input based on steps? For now, simplistic.
          run: async (_input: unknown) => {
            const results = [];
            const workspaceId = "ws:system";
            const perms = this.deps.permissions
              ? this.deps.permissions.getPermissions("automation_agent", workspaceId)
              : [];
            for (const step of steps) {
              try {
                // Execute step
                const result = await this.deps.tools.execute(step.tool, step.args, {
                  userRole: "service",
                  permissions: perms,
                  workspaceId,
                });
                results.push({ step: step.tool, status: "success", result });
              } catch (error) {
                results.push({ step: step.tool, status: "error", error });
                // Stop on error? Or continue? For now, stop.
                throw error;
              }
            }
            return { ok: true, workflow_results: results };
          },
        },
      ],
    };

    // Register
    this.deps.skills.register(newSkill);
    await this.deps.memory.add("event", `Generated composite skill: ${name}`, {
      description,
      steps: JSON.stringify(steps),
    });

    return newSkill;
  }
}
