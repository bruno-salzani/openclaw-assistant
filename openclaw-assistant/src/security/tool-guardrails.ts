import { InstructionFirewall } from "./instruction-firewall.js";

const restrictedTools = ["terminal.rm", "docker.rm", "filesystem.rm"];
const adminOnlyTools = ["terminal.run", "docker.run_container", "postgres.query"];

export function guardToolCall(
  toolName: string,
  input: Record<string, any>,
  userRole: string = "user"
): void {
  // 1. Blacklist
  if (restrictedTools.includes(toolName)) {
    throw new Error(`Execution of restricted tool ${toolName} is forbidden.`);
  }

  // 2. Role-based access control (RBAC)
  if (adminOnlyTools.includes(toolName) && userRole !== "admin") {
    throw new Error(`Access denied for tool ${toolName}. Admin role required.`);
  }

  // 3. Dangerous Pattern Detection in Inputs
  const firewall = new InstructionFirewall();
  const inputStr = JSON.stringify(input);
  const issues = firewall.analyze(inputStr);
  if (issues.length > 0) {
    throw new Error(`Security Guardrail Triggered: ${issues.join(", ")}`);
  }
}
