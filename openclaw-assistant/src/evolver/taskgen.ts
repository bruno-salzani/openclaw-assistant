import { randomUUID } from "node:crypto";
import path from "node:path";
import { EvolverTask, RepoAnalysis } from "./types.js";

export class TaskGenerator {
  generate(analysis: RepoAnalysis): EvolverTask[] {
    const tasks: EvolverTask[] = [];
    const now = Date.now();

    for (const f of analysis.largestFiles.slice(0, 5)) {
      if (f.loc < 250) continue;
      tasks.push({
        id: randomUUID(),
        type: "refactor_candidate",
        title: `Refatorar arquivo grande (${path.relative(analysis.rootDir, f.path)})`,
        filePath: f.path,
        evidence: [`${path.relative(analysis.rootDir, f.path)}:loc=${f.loc}`],
        priority: f.loc > 600 ? "high" : "medium",
        createdAt: now,
      });
    }

    tasks.push({
      id: randomUUID(),
      type: "add_test_candidate",
      title: "Adicionar/rodar smoke tests de evolução (self-tests)",
      priority: "medium",
      createdAt: now,
    });

    tasks.push({
      id: randomUUID(),
      type: "reduce_risk_candidate",
      title: "Reforçar guardrails para automações auto-geradas (rollback + allowlists)",
      priority: "high",
      createdAt: now,
    });

    return tasks.slice(0, Number(process.env.OPENCLAW_X_EVOLVER_MAX_TASKS ?? 10));
  }
}
