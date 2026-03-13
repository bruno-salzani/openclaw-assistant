import fs from "node:fs";
import path from "node:path";
import { RepoAnalysis } from "./types.js";

function shouldIgnoreDir(name: string) {
  return (
    name === "node_modules" ||
    name === "dist" ||
    name === ".git" ||
    name === ".evolver" ||
    name === "coverage"
  );
}

function countLoc(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw) return 0;
  return raw.split(/\r?\n/).length;
}

function walk(root: string, out: string[]) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (shouldIgnoreDir(e.name)) continue;
      walk(p, out);
      continue;
    }
    if (!e.isFile()) continue;
    out.push(p);
  }
}

export class RepoPlanner {
  analyzeRepo(rootDir: string): RepoAnalysis {
    const files: string[] = [];
    walk(rootDir, files);
    const ts = files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    const tsFiles = ts.map((p) => {
      const st = fs.statSync(p);
      return { path: p, size: st.size, loc: countLoc(p) };
    });
    const totalFiles = files.length;
    const totalLoc = tsFiles.reduce((a, b) => a + b.loc, 0);
    const largestFiles = [...tsFiles].sort((a, b) => b.loc - a.loc).slice(0, 10);

    const findings: RepoAnalysis["findings"] = [];
    for (const f of largestFiles.slice(0, 5)) {
      if (f.loc > 300) {
        findings.push({
          title: `Arquivo muito grande: ${path.relative(rootDir, f.path)}`,
          evidence: [`${path.relative(rootDir, f.path)}:loc=${f.loc}`],
          severity: f.loc > 600 ? "high" : "medium",
        });
      }
    }

    return { rootDir, tsFiles, totalFiles, totalLoc, largestFiles, findings };
  }
}
