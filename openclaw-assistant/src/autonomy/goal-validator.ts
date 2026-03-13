import { InstructionFirewall } from "../security/instruction-firewall.js";

export type GoalValidationResult =
  | { ok: true }
  | { ok: false; reason: string; issues?: string[] };

export function validateGoal(params: { title: string; rationale?: string }): GoalValidationResult {
  const title = String(params.title ?? "").trim();
  if (!title) return { ok: false, reason: "missing_title" };
  if (title.length > 500) return { ok: false, reason: "title_too_long" };

  const firewall = new InstructionFirewall();
  const issues = firewall.analyze(`${title}\n${String(params.rationale ?? "")}`);
  if (issues.length > 0) return { ok: false, reason: "firewall", issues };

  const lower = title.toLowerCase();
  if (lower.includes("exfiltrar") || lower.includes("vazar") || lower.includes("roubar")) {
    return { ok: false, reason: "malicious_goal" };
  }
  return { ok: true };
}

