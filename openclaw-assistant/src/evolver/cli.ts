import "dotenv/config";
import { EvolutionLoop } from "./loop.js";

function getArg(name: string) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function main() {
  const repoRoot = getArg("--repo") ?? process.cwd();
  const apply = hasFlag("--apply") || process.env.OPENCLAW_X_EVOLVER_APPLY === "1";
  const commit = hasFlag("--commit") || process.env.OPENCLAW_X_EVOLVER_COMMIT === "1";
  const runTests = !hasFlag("--no-tests");

  const loop = new EvolutionLoop();
  const results = await loop.runOnce({ repoRoot, apply, commit, runTests });
  const summary = results.map((r) => ({
    id: r.task.id,
    type: r.task.type,
    applied: r.applied ?? false,
    committed: r.committed ?? false,
    accept: r.evaluation?.accept ?? false,
    review: r.review?.approved ?? false,
  }));
  process.stdout.write(JSON.stringify({ ok: true, summary }, null, 2) + "\n");
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exitCode = 1;
});
