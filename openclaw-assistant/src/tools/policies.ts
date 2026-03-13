export type ToolPolicy = {
  allow: string[];
  deny: string[];
};

export const defaultPolicy: ToolPolicy = {
  allow: [
    "github",
    "jira",
    "notion",
    "browser",
    "terminal",
    "docker",
    "postgres",
    "filesystem",
    "email",
    "slack",
  ],
  deny: ["rm", "shutdown"],
};

export function checkPolicy(policy: ToolPolicy, toolName: string): void {
  if (policy.deny.includes(toolName)) {
    throw new Error(`Tool blocked by policy: ${toolName}`);
  }
  if (policy.allow.length > 0 && !policy.allow.includes(toolName)) {
    throw new Error(`Tool not allowed: ${toolName}`);
  }
}
