import { spawnSync } from "node:child_process";
import path from "node:path";
import type { MetricsRegistry } from "../../observability/metrics.js";
import type { MemorySystem } from "../../memory/memory-system.js";

function cli(cmd: string, args: string[], cwd?: string) {
  const res = spawnSync(cmd, args, { encoding: "utf-8", shell: true, cwd });
  return { code: res.status ?? 1, out: res.stdout ?? "", err: res.stderr ?? "" };
}

function openclawAvailable() {
  const probe = cli("openclaw", ["--help"]);
  return probe.code === 0 || /Usage: openclaw/i.test(probe.out);
}

export async function syncCronJobsIfEnabled(
  openclawRepo: string,
  metrics: MetricsRegistry,
  memory?: MemorySystem
) {
  if (String(process.env.OPENCLAW_X_SYNC_CRON) !== "1") return;
  if (!openclawAvailable()) return;
  const jobs = [
    { name: "healthcheck:security-audit", cmd: "openclaw security audit", when: "0 3 * * *" },
    { name: "healthcheck:update-status", cmd: "openclaw update status", when: "30 3 * * *" },
  ];
  const list = cli("openclaw", ["cron", "list"]);
  for (const j of jobs) {
    const exists = list.code === 0 && list.out.includes(j.name);
    if (!exists) {
      const add = cli(
        "openclaw",
        ["cron", "add", "--name", j.name, "--when", JSON.stringify(j.when), "--", j.cmd],
        path.dirname(openclawRepo)
      );
      if (add.code === 0) {
        metrics
          .createCounter("openclaw_cron_jobs_added_total", "Total OpenClaw cron jobs added")
          .inc();
        if (memory) {
          await memory.add("event", "OpenClaw cron job added", {
            job: j.name,
            cmd: j.cmd,
            when: j.when,
          });
        }
      }
    }
  }
}
