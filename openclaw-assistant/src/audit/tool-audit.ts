import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export type ToolAuditEntry = {
  id: string;
  ts: number;
  stage: "start" | "end";
  tool: string;
  ok?: boolean;
  durationMs?: number;
  userRole?: string;
  traceId?: string;
  workspaceId?: string;
  argsHash?: string;
  args?: unknown;
  error?: string;
};

function shouldRedactKey(key: string) {
  return /(token|secret|password|api[_-]?key|private[_-]?key)/i.test(key);
}

function redactValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (v === null) return null;
  if (typeof v === "string") return v.length > 2000 ? v.slice(0, 2000) : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redactValue(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, vv] of Object.entries(v as any)) {
      if (shouldRedactKey(k)) out[k] = "[REDACTED]";
      else out[k] = redactValue(vv, depth + 1);
    }
    return out;
  }
  return String(v);
}

export class ToolAuditLogger {
  private readonly filePath: string;

  constructor(params: { cwd: string }) {
    const dir = path.join(params.cwd, ".ia-assistant", "audit");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    this.filePath = path.join(dir, "tool-calls.jsonl");
  }

  newId() {
    return randomUUID();
  }

  hashArgs(tool: string, stableKey: string) {
    return createHash("sha256").update(`${tool}:${stableKey}`).digest("hex");
  }

  write(entry: ToolAuditEntry) {
    if (process.env.OPENCLAW_X_AUDIT_LOG !== "1") return;
    const line = JSON.stringify(entry) + "\n";
    try {
      fs.appendFileSync(this.filePath, line, "utf8");
    } catch {}
  }

  redactArgs(args: Record<string, any>) {
    return redactValue(args);
  }
}
