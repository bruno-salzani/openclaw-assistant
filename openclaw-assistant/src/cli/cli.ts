import "dotenv/config";
import { getRuntime } from "../runtime-singleton.js";
import { sanitizeInput } from "../security/input-sanitizer.js";
import fs from "node:fs";
import path from "node:path";
import { Redis } from "ioredis";
import pkg from "pg";

function args() {
  return process.argv.slice(2);
}

async function checkRedis(url: string) {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
  });
  const startedAt = Date.now();
  try {
    await client.connect();
    const pong = await client.ping();
    return { ok: pong === "PONG", latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: String(err), latencyMs: Date.now() - startedAt };
  } finally {
    try {
      client.disconnect();
    } catch {}
  }
}

async function checkPostgres(url: string) {
  const { Pool } = pkg;
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });
  const startedAt = Date.now();
  try {
    await pool.query("SELECT 1 as ok");
    let uuidOk = true;
    try {
      await pool.query("SELECT gen_random_uuid() as id");
    } catch {
      uuidOk = false;
    }
    return { ok: true, uuidOk, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, error: String(err), latencyMs: Date.now() - startedAt };
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

async function checkQdrant(url: string) {
  const startedAt = Date.now();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 2000);
  try {
    const base = url.replace(/\/+$/, "");
    const res = await fetch(`${base}/collections`, { signal: ac.signal });
    const txt = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      bodySnippet: txt.slice(0, 200),
    };
  } catch (err) {
    return { ok: false, error: String(err), latencyMs: Date.now() - startedAt };
  } finally {
    try {
      clearTimeout(t);
    } catch {}
  }
}

async function main() {
  const [group, action, ...rest] = args();
  const input = rest.join(" ");
  const flags = new Set(rest.filter((x) => x.startsWith("--")));
  if (group === "onboard") {
    const cwd = process.cwd();
    const envExample = path.join(cwd, ".env.example");
    const envFile = path.join(cwd, ".env");
    const out: any = { ok: true, wroteEnv: false, checks: [] as any[] };
    out.checks.push({ name: ".env.example", ok: fs.existsSync(envExample) });
    out.checks.push({ name: ".env", ok: fs.existsSync(envFile) });
    if (!fs.existsSync(envFile) && flags.has("--write") && fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envFile);
      out.wroteEnv = true;
    }
    const dir = path.join(cwd, ".ia-assistant");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    out.checks.push({ name: ".ia-assistant", ok: fs.existsSync(dir) });
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }
  if (group === "doctor") {
    const cwd = process.cwd();
    const openclawRepo = process.env.OPENCLAW_REPO_PATH ?? path.resolve(cwd, "..", "openclaw");
    const report: any = {
      ok: true,
      openclawRepo,
      env: {
        port: process.env.OPENCLAW_X_PORT ?? "18789",
        dmPolicy: process.env.OPENCLAW_X_DM_POLICY ?? "pairing",
        audit: process.env.OPENCLAW_X_AUDIT_LOG ?? "0",
      },
      checks: [] as any[],
      integrations: {} as any,
      risk: [] as any[],
    };
    const adminToken = Boolean(process.env.OPENCLAW_X_ADMIN_TOKEN);
    const publicToken = Boolean(process.env.OPENCLAW_X_PUBLIC_TOKEN);
    report.checks.push({ name: "OPENCLAW_X_ADMIN_TOKEN", ok: adminToken });
    report.checks.push({ name: "OPENCLAW_X_PUBLIC_TOKEN", ok: publicToken });
    report.checks.push({ name: "OPENCLAW_REPO_PATH exists", ok: fs.existsSync(openclawRepo) });

    const dmPolicy = process.env.OPENCLAW_X_DM_POLICY ?? "pairing";
    if (dmPolicy === "open") report.risk.push({ level: "high", issue: "dm_policy_open" });
    if ((process.env.OPENCLAW_X_ALLOW_QUERY_TOKEN ?? "0") === "1")
      report.risk.push({ level: "medium", issue: "query_token_enabled" });
    if ((process.env.OPENCLAW_X_ALLOW_SERVICE_TEST_RUNNER ?? "0") === "1")
      report.risk.push({ level: "medium", issue: "service_test_runner_enabled" });
    if ((process.env.OPENCLAW_X_AUDIT_LOG ?? "0") !== "1")
      report.risk.push({ level: "low", issue: "audit_log_disabled" });

    const redisUrl =
      process.env.OPENCLAW_X_REDIS_URL ?? process.env.OPENCLAW_X_TASKS_REDIS_URL ?? "";
    const pgUrl = process.env.OPENCLAW_X_POSTGRES_URL ?? "";
    const qdrantUrl = process.env.OPENCLAW_X_QDRANT_URL ?? "";

    if (process.env.OPENCLAW_X_TASKS_REDIS_URL && !process.env.OPENCLAW_X_REDIS_URL) {
      report.risk.push({ level: "low", issue: "memory_redis_url_missing_but_tasks_redis_url_set" });
    }

    report.integrations.redis = redisUrl
      ? await checkRedis(redisUrl)
      : { ok: false, skipped: true };
    report.integrations.postgres = pgUrl
      ? await checkPostgres(pgUrl)
      : { ok: false, skipped: true };
    report.integrations.qdrant = qdrantUrl
      ? await checkQdrant(qdrantUrl)
      : { ok: false, skipped: true };

    report.ok =
      report.checks.every((c: any) => c.ok !== false) &&
      (report.integrations.redis.ok !== false || report.integrations.redis.skipped) &&
      (report.integrations.postgres.ok !== false || report.integrations.postgres.skipped) &&
      (report.integrations.qdrant.ok !== false || report.integrations.qdrant.skipped) &&
      !report.risk.some((r: any) => r.level === "high");

    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }

  const { gateway, memory, skills } = await getRuntime();
  if (group === "agent" && action === "create") {
    process.stdout.write("agent created\n");
    return;
  }
  if (group === "memory" && action === "search") {
    const query = sanitizeInput(input);
    const results = await memory.search(query, { limit: 10 });
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }
  if (group === "workflow" && action === "create") {
    process.stdout.write("workflow created\n");
    return;
  }
  if (group === "skill" && action === "install") {
    const id = input.trim();
    const known = skills.get(id);
    process.stdout.write(known ? "skill ready\n" : "skill not found\n");
    return;
  }
  if (group === "debug" && action === "session") {
    const response = await gateway.handleMessage({
      sessionId: "session:debug",
      userId: "user:debug",
      channel: "cli",
      modality: "text",
      text: sanitizeInput(input),
    });
    process.stdout.write(`${response.text}\n`);
    return;
  }
  if (group === "pairing" && action === "pending") {
    const out = await (gateway as any).listPendingPairings();
    process.stdout.write(JSON.stringify({ ok: true, pending: out }, null, 2) + "\n");
    return;
  }
  if (group === "pairing" && action === "approve") {
    const code = input.trim();
    const out = await (gateway as any).approvePairing(code);
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }
  process.stdout.write("usage: agent|memory|workflow|skill|debug\n");
}

await main();
