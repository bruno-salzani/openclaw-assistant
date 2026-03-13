import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { EvolverPatch, EvolverTask } from "./types.js";
import type { LLMProvider } from "../llm/llm-provider.js";

function absToRel(rootDir: string, p: string) {
  return path.relative(rootDir, p).replaceAll("\\", "/");
}

function rewriteNoIndexDiff(diff: string, relPath: string) {
  const lines = diff.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      out.push(`diff --git a/${relPath} b/${relPath}`);
      continue;
    }
    if (line.startsWith("--- a/")) {
      out.push(`--- a/${relPath}`);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      out.push(`+++ b/${relPath}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n").trimEnd() + "\n";
}

export class PatchCoder {
  constructor(private readonly llm?: LLMProvider) {}

  private stripCodeFences(s: string) {
    const raw = String(s ?? "");
    const trimmed = raw.trim();
    if (!trimmed.startsWith("```")) return raw;
    const lines = trimmed.split(/\r?\n/);
    const out: string[] = [];
    let inFence = false;
    for (const line of lines) {
      if (line.startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) out.push(line);
    }
    return out.join("\n");
  }

  private async improveWithLlm(params: {
    task: EvolverTask;
    relPath: string;
    raw: string;
  }): Promise<string | null> {
    if (!this.llm) return null;
    if (process.env.OPENCLAW_X_EVOLVER_LLM !== "1") return null;

    const raw = params.raw;
    if (!raw.trim()) return null;
    if (raw.length > 18_000) return null;

    const system = [
      "Você é um agente que melhora código TypeScript de forma conservadora.",
      "Retorne APENAS o conteúdo atualizado do arquivo, sem markdown.",
      "Regras:",
      "- Não adicione comentários.",
      "- Não adicione TODO/FIXME.",
      "- Mudanças pequenas, focadas em confiabilidade/performance/clareza.",
      "- Preserve APIs públicas e comportamento, a menos que haja bug evidente.",
      "- Não adicione novas dependências.",
    ].join("\n");

    const user = [
      `Arquivo: ${params.relPath}`,
      `Tarefa: ${params.task.title}`,
      params.task.evidence && params.task.evidence.length > 0
        ? `Evidências:\n${params.task.evidence.join("\n")}`
        : "",
      "",
      "Conteúdo atual:",
      raw,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const out = await this.llm.chat({
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        maxTokens: 1800,
      });
      const candidate = this.stripCodeFences(out).replace(/\r\n/g, "\n");
      const baseline = raw.replace(/\r\n/g, "\n");
      if (!candidate.trim()) return null;
      if (candidate.trim() === baseline.trim()) return null;
      if (candidate.includes("TODO") || candidate.includes("FIXME")) return null;
      return candidate.replace(/\n/g, "\n");
    } catch {
      return null;
    }
  }

  async createPatch(task: EvolverTask, analysisRootDir: string): Promise<EvolverPatch | null> {
    if (!task.filePath) return null;
    if (!fs.existsSync(task.filePath)) return null;

    const rel = absToRel(analysisRootDir, task.filePath);
    const raw = fs.readFileSync(task.filePath, "utf8");
    if (!raw) return null;

    if (process.env.OPENCLAW_X_EVOLVER_ALLOW_GIT_DIFF !== "1") return null;

    const llmUpdated = await this.improveWithLlm({ task, relPath: rel, raw });
    const updated = llmUpdated ?? raw.replace(/\t/g, "  ");
    if (updated === raw) return null;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ia-assistant-evolver-"));
    const tmpA = path.join(tmpDir, "a.ts");
    const tmpB = path.join(tmpDir, "b.ts");
    fs.writeFileSync(tmpA, raw, "utf8");
    fs.writeFileSync(tmpB, updated, "utf8");
    const diffOut = spawnSync("git", ["diff", "--no-index", "--", tmpA, tmpB], {
      encoding: "utf8",
    });
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
    const rawDiff = String(diffOut.stdout || "");
    const diff = rewriteNoIndexDiff(rawDiff, rel);
    if (!diff.includes("diff --git")) return null;
    if (diff.length > 200_000) return null;

    return {
      taskId: task.id,
      title: task.title || `Evolver patch: ${rel}`,
      diff,
      filesTouched: [rel],
    };
  }
}
