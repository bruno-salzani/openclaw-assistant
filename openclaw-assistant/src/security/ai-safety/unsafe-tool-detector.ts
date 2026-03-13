export type UnsafeToolSignal = {
  risk: "low" | "medium" | "high";
  reasons: string[];
};

function addReason(reasons: string[], r: string) {
  if (!reasons.includes(r)) reasons.push(r);
}

function prefix(tool: string) {
  return String(tool ?? "").split(".")[0] ?? "";
}

export function detectUnsafeTool(toolName: string, input: unknown): UnsafeToolSignal {
  const tool = String(toolName ?? "");
  const svc = prefix(tool);
  const reasons: string[] = [];
  let risk: UnsafeToolSignal["risk"] = "low";

  const high = new Set([
    "terminal",
    "docker",
    "filesystem",
    "apps",
    "iot",
    "postgres",
    "marketplace",
  ]);
  const medium = new Set(["browser", "email", "slack", "github", "jira", "notion"]);

  if (high.has(svc)) risk = "high";
  else if (medium.has(svc)) risk = "medium";

  if (svc === "filesystem" && /delete|remove|rm/i.test(tool)) addReason(reasons, "destructive_fs");
  if (svc === "terminal") addReason(reasons, "arbitrary_command");
  if (svc === "docker") addReason(reasons, "container_exec");
  if (svc === "postgres" && /drop|truncate/i.test(JSON.stringify(input ?? {}))) {
    risk = "high";
    addReason(reasons, "sql_destructive");
  }
  if (svc === "marketplace") addReason(reasons, "code_installation");

  return { risk, reasons };
}

