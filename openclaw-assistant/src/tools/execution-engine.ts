import type { MetricsRegistry } from "../observability/metrics.js";
import type { EventBus } from "../infra/event-bus.js";
import { runInSandbox } from "./sandbox.js";
import { guardToolCall } from "../security/tool-guardrails.js";
import type { PolicyService } from "../security/policy-service.js";
import { ToolAuditLogger } from "../audit/tool-audit.js";
import type { ToolRegistry } from "./registry/tool-registry.js";
import type { AgentTracker } from "../observability/agent-tracker.js";
import { detectUnsafeTool } from "../security/ai-safety/unsafe-tool-detector.js";

export type ToolExecutionContext = {
  name: string;
  sandbox?: boolean;
  timeout?: number;
  userRole?: string;
  permissions?: string[];
  traceId?: string;
  cacheTtlMs?: number;
  rate?: { perMin: number };
  approved?: boolean;
  source?: string;
  workspaceId?: string;
};

type ToolHandler = (input: Record<string, any>, ctx?: ToolExecutionContext) => Promise<any>;

export class ToolExecutionEngine {
  private readonly tools = new Map<string, ToolHandler>();

  private readonly metrics: MetricsRegistry;

  private workflowRunner?: (name: string, input: Record<string, any>) => Promise<any>;

  private readonly cache = new Map<string, { v: any; exp: number }>();

  private readonly buckets = new Map<string, { tokens: number; last: number }>();

  private readonly errors = new Map<string, { count: number; opened: boolean; resetAt: number }>();

  private bus?: EventBus;

  private policy?: PolicyService;

  private audit?: ToolAuditLogger;

  private toolRegistry?: ToolRegistry;

  private agentTracker?: AgentTracker;

  constructor(metrics: MetricsRegistry) {
    this.metrics = metrics;
  }

  setBus(bus: EventBus) {
    this.bus = bus;
  }

  setPolicy(policy: PolicyService) {
    this.policy = policy;
  }

  setAuditLogger(audit: ToolAuditLogger) {
    this.audit = audit;
  }

  setToolRegistry(registry: ToolRegistry) {
    this.toolRegistry = registry;
  }

  setAgentTracker(tracker: AgentTracker) {
    this.agentTracker = tracker;
  }

  registerTool(name: string, handler: ToolHandler) {
    this.tools.set(name, handler);
  }

  unregisterTool(name: string) {
    this.tools.delete(name);
  }

  hasTool(name: string) {
    return this.tools.has(name);
  }

  registerWorkflowRunner(runner: (name: string, input: Record<string, any>) => Promise<any>) {
    this.workflowRunner = runner;
  }

  private stableKey(obj: any): string {
    if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return `[${obj.map((x) => this.stableKey(x)).join(",")}]`;
    const keys = Object.keys(obj).sort();
    const normalized: any = {};
    for (const k of keys) normalized[k] = this.stableKey(obj[k]);
    return JSON.stringify(normalized);
  }

  computeArgsHash(name: string, input: Record<string, any>) {
    const stable = this.stableKey(input);
    if (!this.audit) return "";
    return this.audit.hashArgs(name, stable);
  }

  private cacheSet(key: string, value: any, ttlMs: number) {
    if (this.cache.size > 1000) {
      const it = this.cache.keys().next();
      if (!it.done) this.cache.delete(it.value);
    }
    this.cache.set(key, { v: value, exp: Date.now() + ttlMs });
  }

  async execute(
    name: string,
    input: Record<string, any>,
    options?: Omit<ToolExecutionContext, "name">
  ) {
    // Permission System Check
    if (!options?.permissions || options.permissions.length === 0) {
      throw new Error(`Permission denied: no permissions provided for ${name}`);
    }
    if (options.permissions && options.permissions.length > 0) {
      if (name.startsWith("workflow:")) {
        const hasPermission =
          options.permissions.includes("*") || options.permissions.includes("workflow.*");
        if (!hasPermission) {
          throw new Error(`Permission denied: Agent does not have permission to execute ${name}`);
        }
        const workflowName = name.replace("workflow:", "");
        if (!this.workflowRunner) {
          throw new Error("Workflow runner not registered");
        }
        return this.workflowRunner(workflowName, input);
      }

      const handler = this.tools.get(name);
      if (!handler) {
        throw new Error(`Tool ${name} not found`);
      }

      // e.g., name = "calendar.create_event"
      // permission required = "calendar.write" or "calendar.*"
      const parts = name.split(".");
      const service = parts[0] ?? "";
      const action = parts.length > 1 ? (parts[parts.length - 1] ?? "execute") : "execute";
      const requiredPerm = `${service}.*`;
      const specificPerm = `${service}.${action}`;

      const hasPermission =
        options.permissions.includes("*") ||
        options.permissions.includes(requiredPerm) ||
        options.permissions.includes(specificPerm);

      if (!hasPermission) {
        throw new Error(`Permission denied: Agent does not have permission to execute ${name}`);
      }
    }

    const handler = this.tools.get(name);
    if (!handler) {
      throw new Error(`Tool ${name} not found`);
    }

    if (this.agentTracker) this.agentTracker.recordToolCall();

    this.bus?.emit("tool_called", { name, input, options });

    const manifest = this.toolRegistry?.get(name);
    if (manifest && String(process.env.IA_ASSISTANT_TOOL_ENFORCE_MANIFEST_PERMS ?? "0") === "1") {
      const perms = options?.permissions ?? [];
      for (const req of manifest.permissions ?? []) {
        const r = String(req);
        const svc = r.includes(".") ? r.split(".")[0] : r;
        const ok =
          perms.includes("*") || perms.includes(r) || (svc ? perms.includes(`${svc}.*`) : false);
        if (!ok) throw new Error(`Permission denied: missing manifest permission ${r} for ${name}`);
      }
    }

    // Circuit Breaker
    const caller = options?.userRole ?? "user";
    const brKey = `${caller}:${name}`;
    const now = Date.now();
    const errState = this.errors.get(brKey) ?? { count: 0, opened: false, resetAt: 0 };
    if (errState.opened && now < errState.resetAt) {
      throw new Error(`Circuit open for tool ${name}`);
    }
    if (now >= errState.resetAt && errState.opened) {
      this.errors.set(brKey, { count: 0, opened: false, resetAt: 0 });
    }

    // Rate Limiting (token bucket)
    const rate =
      options?.rate?.perMin ??
      (manifest?.rateLimit && Number.isFinite(manifest.rateLimit)
        ? manifest.rateLimit
        : undefined) ??
      60;
    const rateKey = `${caller}:${name}`;
    const b = this.buckets.get(rateKey) ?? { tokens: rate, last: now };
    const elapsed = (now - b.last) / 60000;
    b.tokens = Math.min(rate, b.tokens + elapsed * rate);
    if (b.tokens < 1) {
      throw new Error(`Rate limit exceeded for tool ${name}`);
    }
    b.tokens -= 1;
    b.last = now;
    this.buckets.set(rateKey, b);

    // Caching for idempotent calls
    const ttl = options?.cacheTtlMs ?? 0;
    if (ttl > 0) {
      const key = `${name}:${this.stableKey(input)}`;
      const c = this.cache.get(key);
      if (c && c.exp > now) return c.v;
    }

    // Policy / Security Check
    const userRole =
      options?.userRole === "admin" || options?.userRole === "service" ? options.userRole : "user";
    if (process.env.IA_ASSISTANT_AI_SAFETY_ENABLE === "1") {
      const sig = detectUnsafeTool(name, input);
      if (sig.risk === "high" && userRole !== "admin" && userRole !== "service" && !options?.approved) {
        this.bus?.emit("ai_safety.blocked", {
          kind: "unsafe_tool",
          tool: name,
          traceId: options?.traceId,
          workspaceId: options?.workspaceId,
          reasons: sig.reasons,
          ts: Date.now(),
        });
        throw new Error(`Confirmation required for tool ${name}`);
      }
    }
    if (this.policy) {
      const d = this.policy.evaluateTool(name, input, {
        userRole,
        approved: options?.approved,
        traceId: options?.traceId,
        source: options?.source ?? "tools",
      });
      if (!d.allowed && d.requireConfirmation) {
        throw new Error(`Confirmation required for tool ${name}`);
      }
      if (!d.allowed) {
        throw new Error(`Policy denied tool ${name}${d.reason ? `: ${d.reason}` : ""}`);
      }
    } else {
      guardToolCall(name, input, options?.userRole);
    }

    this.metrics.counter("tool_executions_total").inc();
    const timeout =
      typeof options?.timeout === "number"
        ? options.timeout
        : manifest?.timeoutMs && Number.isFinite(manifest.timeoutMs)
          ? manifest.timeoutMs
          : 30000;
    const startedAt = Date.now();
    const auditId = this.audit ? this.audit.newId() : "";
    const argsHash = this.audit ? this.audit.hashArgs(name, this.stableKey(input)) : "";
    if (this.audit && auditId) {
      this.audit.write({
        id: auditId,
        ts: startedAt,
        stage: "start",
        tool: name,
        userRole: options?.userRole,
        traceId: options?.traceId,
        workspaceId: options?.workspaceId,
        argsHash,
        args: this.audit.redactArgs(input),
      });
    }

    const retryMax =
      typeof (options as any)?.retry?.max === "number"
        ? Math.max(0, Math.min(10, Number((options as any).retry.max)))
        : typeof manifest?.retry?.max === "number"
          ? Math.max(0, Math.min(10, Number(manifest.retry.max)))
          : 0;
    const retryBackoffMs =
      typeof (options as any)?.retry?.backoffMs === "number"
        ? Math.max(0, Math.min(60_000, Number((options as any).retry.backoffMs)))
        : typeof manifest?.retry?.backoffMs === "number"
          ? Math.max(0, Math.min(60_000, Number(manifest.retry.backoffMs)))
          : 250;

    try {
      const execCtx: ToolExecutionContext = { name, ...options };
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retryMax; attempt += 1) {
        if (attempt > 0 && retryBackoffMs > 0) {
          await new Promise((r) => setTimeout(r, retryBackoffMs * attempt));
        }
        try {
          try {
            this.bus?.emit("tool.start", {
              tool: name,
              traceId: options?.traceId,
              workspaceId: options?.workspaceId,
              source: options?.source,
              attempt,
            });
          } catch {}
          if (
            options?.sandbox ||
            ["terminal", "docker", "filesystem"].includes(name.split(".")[0] ?? "")
          ) {
            const result = await runInSandbox(() => handler(input, execCtx), {
              timeoutMs: timeout,
              cpuMs: 1000,
              memoryMb: 128,
            });
            if (!result.ok) throw new Error(result.error);
            const out = result.output;
            if (ttl > 0) {
              const key = `${name}:${this.stableKey(input)}`;
              this.cacheSet(key, out, ttl);
            }
            if (this.audit && auditId)
              this.audit.write({
                id: auditId,
                ts: Date.now(),
                stage: "end",
                tool: name,
                ok: true,
                durationMs: Date.now() - startedAt,
                userRole: options?.userRole,
                traceId: options?.traceId,
                workspaceId: options?.workspaceId,
                argsHash,
              });
            try {
              this.bus?.emit("tool.executed", {
                tool: name,
                ok: true,
                durationMs: Date.now() - startedAt,
                traceId: options?.traceId,
                workspaceId: options?.workspaceId,
                source: options?.source,
                argsKeys: Object.keys(input ?? {}).slice(0, 50),
              });
            } catch {}
            return out;
          }
          const out = await Promise.race([
            handler(input, execCtx),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeout)),
          ]);
          if (ttl > 0) {
            const key = `${name}:${this.stableKey(input)}`;
            this.cacheSet(key, out, ttl);
          }
          if (this.audit && auditId)
            this.audit.write({
              id: auditId,
              ts: Date.now(),
              stage: "end",
              tool: name,
              ok: true,
              durationMs: Date.now() - startedAt,
              userRole: options?.userRole,
              traceId: options?.traceId,
              workspaceId: options?.workspaceId,
              argsHash,
            });
          try {
            this.bus?.emit("tool.executed", {
              tool: name,
              ok: true,
              durationMs: Date.now() - startedAt,
              traceId: options?.traceId,
              workspaceId: options?.workspaceId,
              source: options?.source,
              argsKeys: Object.keys(input ?? {}).slice(0, 50),
            });
          } catch {}
          return out;
        } catch (e) {
          lastErr = e;
          if (attempt >= retryMax) break;
        }
      }
      throw lastErr;
    } catch (err) {
      this.metrics.counter("tool_errors_total").inc();
      try {
        this.bus?.emit("tool.error", { tool: name, error: String(err), lastArgs: input });
        this.bus?.emit("tool_failed", { tool: name, error: String(err), lastArgs: input });
      } catch {}
      try {
        this.bus?.emit("tool.executed", {
          tool: name,
          ok: false,
          durationMs: Date.now() - startedAt,
          traceId: options?.traceId,
          workspaceId: options?.workspaceId,
          source: options?.source,
          argsKeys: Object.keys(input ?? {}).slice(0, 50),
          error: String(err),
          ts: Date.now(),
        });
      } catch {}
      if (this.audit && auditId)
        this.audit.write({
          id: auditId,
          ts: Date.now(),
          stage: "end",
          tool: name,
          ok: false,
          durationMs: Date.now() - startedAt,
          userRole: options?.userRole,
          traceId: options?.traceId,
          workspaceId: options?.workspaceId,
          argsHash,
          error: String(err),
        });
      const eState = this.errors.get(brKey) ?? { count: 0, opened: false, resetAt: 0 };
      eState.count += 1;
      if (eState.count >= 5) {
        eState.opened = true;
        eState.resetAt = Date.now() + 60_000;
      }
      this.errors.set(brKey, eState);
      throw err;
    }
  }

  listTools() {
    return [...this.tools.keys()];
  }
}
