import type { PolicyContext, PolicyRisk } from "./policy-service.js";

export type ToolRiskAssessment = {
  riskScore: number;
  risk: PolicyRisk;
  reasons: string[];
  predictedConsequences: string[];
};

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function riskLabel(score: number): PolicyRisk {
  if (score >= 0.8) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function add(reasons: string[], predicted: string[], reason: string, consequence?: string) {
  reasons.push(reason);
  if (consequence) predicted.push(consequence);
}

export class RiskEngine {
  assessTool(toolName: string, input: Record<string, any>, ctx: PolicyContext): ToolRiskAssessment {
    const reasons: string[] = [];
    const predictedConsequences: string[] = [];
    const tool = String(toolName ?? "");
    const inputStr = JSON.stringify(input ?? {});
    const lower = inputStr.toLowerCase();

    let score = 0.15;

    const dangerousPrefixes = ["terminal.", "docker.", "filesystem.write", "filesystem.rm", "email.send", "postgres."];
    if (dangerousPrefixes.some((p) => tool.startsWith(p))) {
      score += 0.35;
      add(reasons, predictedConsequences, "dangerous_tool", "pode causar side effects persistentes");
    }

    if (tool === "terminal.run") {
      const cmd = typeof (input as any)?.command === "string" ? String((input as any).command) : "";
      const cmdLower = cmd.toLowerCase();
      if (/\brm\s+(-r|-f|-rf|-fr)\b/.test(cmdLower)) {
        score += 0.5;
        add(reasons, predictedConsequences, "destructive_delete", "pode apagar arquivos/dados");
      }
      if (/\b(del|erase)\b/.test(cmdLower)) {
        score += 0.25;
        add(reasons, predictedConsequences, "delete_command", "pode apagar arquivos/dados");
      }
      if (cmdLower.includes("shutdown") || cmdLower.includes("reboot")) {
        score += 0.35;
        add(reasons, predictedConsequences, "system_shutdown", "pode interromper o serviço");
      }
      if (cmdLower.includes("curl ") || cmdLower.includes("wget ")) {
        score += 0.2;
        add(reasons, predictedConsequences, "unverified_download", "pode baixar e executar conteúdo não confiável");
      }
      if (cmdLower.includes("npm install") || cmdLower.includes("pnpm add") || cmdLower.includes("yarn add")) {
        score += 0.12;
        add(reasons, predictedConsequences, "dependency_change", "pode introduzir vulnerabilidades/instabilidade");
      }
    }

    if (lower.includes("api_key") || lower.includes("openai") || lower.includes("anthropic") || lower.includes("token")) {
      score += 0.1;
      add(reasons, predictedConsequences, "secrets_in_context", "pode expor segredos via logs/execução");
    }

    if (ctx.userRole !== "admin") {
      score += 0.08;
      add(reasons, predictedConsequences, "non_admin_caller");
    }

    const normalized = clamp01(score);
    return {
      riskScore: normalized,
      risk: riskLabel(normalized),
      reasons,
      predictedConsequences,
    };
  }
}

