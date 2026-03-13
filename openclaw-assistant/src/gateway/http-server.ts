import http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { CoreGateway } from "./core-gateway.js";
import type { GatewayMessage, InputModality } from "./types.js";
import { z } from "zod";
import { slackCommandToInbound, verifySlackSignature } from "../channels/slack.js";
import { telegramUpdateToInbound, telegramSendMessage } from "../channels/telegram.js";
import { discordInboundToMessage, discordSendWebhookMessage } from "../channels/discord.js";

export type GatewayHttpServer = {
  close: () => Promise<void>;
};

type JsonBody = Record<string, unknown>;

function readJson(req: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<JsonBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        done = true;
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      try {
        if (done) return;
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? (JSON.parse(raw) as JsonBody) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function readRaw(req: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk) => {
      if (done) return;
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        done = true;
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      if (done) return;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function writeHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

function sseWrite(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseWriteText(res: http.ServerResponse, event: string, text: string) {
  res.write(`event: ${event}\n`);
  const lines = String(text ?? "").split(/\r?\n/);
  for (const l of lines) res.write(`data: ${l}\n`);
  res.write("\n");
}

function getBearerToken(req: http.IncomingMessage) {
  const h = req.headers.authorization;
  if (!h) return null;
  const raw = Array.isArray(h) ? h[0] : h;
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function isLoopbackAddress(addr?: string | null) {
  if (!addr) return false;
  const normalized = String(addr).replace(/^::ffff:/, "");
  return normalized === "127.0.0.1" || normalized === "::1";
}

function authorize(req: http.IncomingMessage, url: URL, opts?: { allowQueryToken?: boolean }) {
  const hasTokens = Boolean(
    process.env.OPENCLAW_X_ADMIN_TOKEN || process.env.OPENCLAW_X_PUBLIC_TOKEN
  );
  if (!hasTokens) {
    if (isLoopbackAddress(req.socket.remoteAddress))
      return { ok: true as const, role: "admin" as const };
    return { ok: false as const };
  }
  const token =
    getBearerToken(req) || (opts?.allowQueryToken ? url.searchParams.get("token") : null);
  const admin = process.env.OPENCLAW_X_ADMIN_TOKEN;
  const pub = process.env.OPENCLAW_X_PUBLIC_TOKEN;
  if (admin && token === admin) return { ok: true as const, role: "admin" as const };
  if (pub && token === pub) return { ok: true as const, role: "user" as const };
  return { ok: false as const };
}

function toSafeMetadata(extras: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const entries = Object.entries(extras);
  for (const [k, v] of entries.slice(0, 32)) {
    if (k === "userRole") continue;
    if (typeof v === "string") out[k] = v.slice(0, 4000);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

const agentRequestSchema = z
  .object({
    text: z.string().max(50_000).optional(),
    sessionId: z.string().max(256).optional(),
    userId: z.string().max(256).optional(),
    channel: z.string().max(128).optional(),
    modality: z.enum(["text", "voice", "image", "action"]).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const openAiChatCompletionsSchema = z.object({
  model: z.string().max(256).optional(),
  stream: z.boolean().optional(),
  user: z.string().max(256).optional(),
  messages: z
    .array(
      z.object({
        role: z.string().max(64).optional(),
        content: z.unknown().optional(),
      })
    )
    .default([]),
});

const openResponsesSchema = z.object({
  model: z.string().max(256).optional(),
  stream: z.boolean().optional(),
  user: z.string().max(256).optional(),
  input: z.unknown(),
});

const eventEnvelopeSchema = z.object({
  event_id: z.string().min(1).max(256),
  type: z.string().min(1).max(256),
  timestamp: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  payload: z.record(z.unknown()),
});

const channelIngestSchema = z.object({
  channel: z.string().min(1).max(64),
  sender: z.string().min(1).max(256),
  text: z.string().max(50_000),
  metadata: z.record(z.unknown()).optional(),
});

const pairingApproveSchema = z.object({
  code: z.string().min(1).max(64),
});

const auditReplaySchema = z.object({
  tool: z.string().min(1).max(256),
  args: z.record(z.unknown()),
  expectedHash: z.string().min(1).max(128),
  approved: z.boolean().optional(),
});

const toolRecommendSchema = z.object({
  query: z.string().max(4000).optional(),
  candidates: z.array(z.string().max(256)).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const learningDatasetExportSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100_000).optional(),
});

const clusterReapSchema = z.object({
  staleMs: z.coerce.number().int().min(1).max(365 * 24 * 60 * 60 * 1000).optional(),
});

const genericObjectSchema = z.record(z.unknown());

function slackBadRequest(res: http.ServerResponse) {
  res.writeHead(400, { "content-type": "text/plain" });
  res.end("bad request");
}

async function slackPostMessage(params: { botToken: string; channelId: string; text: string }) {
  if (!params.botToken) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel: params.channelId, text: params.text }),
  }).catch(() => undefined);
}

function buildGatewayMessage(
  parsed: z.infer<typeof agentRequestSchema>,
  opts: {
    role: "admin" | "user";
    channel: string;
    allowPayloadChannel: boolean;
    defaultSessionPrefix: string;
    defaultUserId: string;
  }
): GatewayMessage {
  const { text, sessionId, userId, channel, modality, metadata, ...extra } = parsed;
  const finalChannel = opts.allowPayloadChannel ? (channel ?? opts.channel) : opts.channel;
  return {
    sessionId: sessionId ?? `${opts.defaultSessionPrefix}-${Date.now()}`,
    userId: userId ?? opts.defaultUserId,
    channel: finalChannel,
    userRole: opts.role,
    modality: (modality ?? "text") as InputModality,
    text: text ?? "",
    metadata: { ...toSafeMetadata(extra), ...(metadata ?? {}) },
  };
}

type Bucket = { tokens: number; last: number };
const rateBuckets = new Map<string, Bucket>();

function rateLimit(req: http.IncomingMessage, key: string, perMin: number) {
  const now = Date.now();
  const ip = req.socket.remoteAddress ?? "unknown";
  const k = `${ip}:${key}`;
  const b = rateBuckets.get(k) ?? { tokens: perMin, last: now };
  const elapsed = (now - b.last) / 60000;
  b.tokens = Math.min(perMin, b.tokens + elapsed * perMin);
  if (b.tokens < 1) {
    rateBuckets.set(k, { ...b, last: now });
    return false;
  }
  b.tokens -= 1;
  b.last = now;
  rateBuckets.set(k, b);
  return true;
}

function writeRequestError(res: http.ServerResponse, err: unknown) {
  if (err && typeof err === "object" && (err as any).name === "ZodError") {
    writeJson(res, 400, { error: "Invalid request" });
    return;
  }
  const msg = String((err as any)?.message ?? err);
  if (msg === "Payload too large") {
    writeJson(res, 413, { error: "Payload too large" });
    return;
  }
  if (msg.includes("JSON")) {
    writeJson(res, 400, { error: "Invalid JSON" });
    return;
  }
  writeJson(res, 500, { error: "Internal error" });
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const t = (part as any).type;
        if (t === "text" && typeof (part as any).text === "string") return (part as any).text;
        if (t === "input_text" && typeof (part as any).text === "string") return (part as any).text;
        if (typeof (part as any).input_text === "string") return (part as any).input_text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function resolveOpenAiUserMessage(messages: Array<{ role?: string; content?: unknown }>): {
  prompt: string;
  history?: string;
} {
  const entries = messages
    .map((m) => ({
      role: typeof m.role === "string" ? m.role.toLowerCase() : "",
      text: extractTextContent(m.content),
    }))
    .filter((m) => Boolean(m.text));
  const lastUser = [...entries].reverse().find((m) => m.role === "user");
  const prompt = lastUser?.text ?? "";
  const historyEntries = entries.slice(0, Math.max(0, entries.length - 1));
  const history =
    historyEntries.length > 0
      ? historyEntries
          .map(
            (e) =>
              `${e.role === "assistant" ? "Assistant" : e.role === "user" ? "User" : "Other"}: ${e.text}`
          )
          .join("\n")
      : undefined;
  return { prompt, history };
}

function resolveOpenResponsesMessage(input: unknown): string {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  const lines: string[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const type = String((item as any).type ?? "");
    if (type !== "message") continue;
    const role = String((item as any).role ?? "");
    const content = (item as any).content;
    if (typeof content !== "string") continue;
    if (role === "user") lines.push(`User: ${content}`);
    else if (role === "assistant") lines.push(`Assistant: ${content}`);
  }
  const joined = lines.join("\n");
  if (joined) return joined;
  const last = input[input.length - 1] as any;
  const fallback = last && typeof last === "object" ? last.content : "";
  return typeof fallback === "string" ? fallback : "";
}

function dashboardHtml(port: number) {
  return `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ia-assistant dashboard</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 16px; }
    .row { display: flex; gap: 16px; flex-wrap: wrap; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; min-width: 320px; flex: 1; }
    pre { background: #0b1020; color: #e6e6e6; padding: 10px; border-radius: 8px; overflow: auto; }
    input, button { padding: 8px; }
    button { cursor: pointer; }
    .muted { color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <h1>ia-assistant dashboard</h1>
  <div class="muted">Porta: ${port} · Atualiza a cada 2s</div>
  <div class="row">
    <div class="card">
      <h2>Autonomia</h2>
      <pre id="autonomy">carregando...</pre>
    </div>
    <div class="card">
      <h2>Fila</h2>
      <pre id="queue">carregando...</pre>
    </div>
  </div>
  <div class="row">
    <div class="card">
      <h2>Snapshot</h2>
      <pre id="snapshot">carregando...</pre>
    </div>
    <div class="card">
      <h2>Smoke</h2>
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <input id="smokeText" style="flex:1" value="Analisar competição de mercado de IA em 2026" />
        <button id="send">Enviar</button>
      </div>
      <pre id="smokeOut">---</pre>
    </div>
  </div>
  <script>
    const fmt = (x) => JSON.stringify(x, null, 2);
    const qs = new URLSearchParams(location.search);
    const tokenFromQuery = qs.get('token');
    if (tokenFromQuery) localStorage.setItem('openclaw_x_token', tokenFromQuery);
    const token = localStorage.getItem('openclaw_x_token') || '';
    const headers = token ? { 'authorization': 'Bearer ' + token } : {};
    async function refresh() {
      try {
        const a = await fetch('/v1/autonomy/status', { headers }).then(r => r.json());
        document.getElementById('autonomy').textContent = fmt(a);
        const s = await fetch('/v1/tasks/stats', { headers }).then(r => r.json());
        document.getElementById('queue').textContent = fmt(s);
        const snap = await fetch('/v1/tasks/snapshot?limit=20', { headers }).then(r => r.json());
        document.getElementById('snapshot').textContent = fmt(snap);
      } catch (e) {}
    }
    async function smoke() {
      const text = document.getElementById('smokeText').value;
      const body = { text, sessionId: 'dash', userId: 'dash', channel: 'http', modality: 'text' };
      const out = await fetch('/v1/agent', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      document.getElementById('smokeOut').textContent = fmt(out);
      await refresh();
    }
    document.getElementById('send').addEventListener('click', () => smoke().catch(() => {}));
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
}

export function startGatewayHttpServer(params: {
  gateway: CoreGateway;
  port: number;
  metrics: { prometheus: () => Promise<string> };
}): GatewayHttpServer {
  const { gateway, port, metrics } = params;
  const rateTtlMs = Number(process.env.OPENCLAW_X_RATE_BUCKET_TTL_MS ?? 10 * 60 * 1000);
  const rateSweepMs = Number(process.env.OPENCLAW_X_RATE_SWEEP_MS ?? 60 * 1000);
  const rateSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateBuckets) {
      if (now - v.last > rateTtlMs) rateBuckets.delete(k);
    }
  }, rateSweepMs);
  if (typeof (rateSweepTimer as any).unref === "function") (rateSweepTimer as any).unref();

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://localhost:${port}`);
    const allowQueryToken =
      process.env.OPENCLAW_X_ALLOW_QUERY_TOKEN === "1" ||
      u.pathname === "/" ||
      u.pathname === "/dashboard";
    const auth = authorize(req, u, { allowQueryToken });

    if (!rateLimit(req, u.pathname, u.pathname.startsWith("/v1/agent") ? 60 : 120)) {
      writeJson(res, 429, { error: "Rate limit exceeded" });
      return;
    }

    // Metrics endpoint
    if (req.url === "/metrics" && req.method === "GET") {
      if (!auth.ok) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(await metrics.prometheus());
      return;
    }

    // Agent endpoint
    if (req.url === "/v1/agent" && req.method === "POST") {
      if (!auth.ok) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = agentRequestSchema.parse(await readJson(req));
        const message = buildGatewayMessage(parsed, {
          role: auth.role,
          channel: "http",
          allowPayloadChannel: true,
          defaultSessionPrefix: "sess",
          defaultUserId: "user-default",
        });

        const response = await gateway.handleMessage(message);
        writeJson(res, 200, response);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/agent/stream" && req.method === "POST") {
      if (!auth.ok) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = agentRequestSchema.parse(await readJson(req));
        const message = buildGatewayMessage(parsed, {
          role: auth.role,
          channel: "http",
          allowPayloadChannel: true,
          defaultSessionPrefix: "sess",
          defaultUserId: "user-default",
        });

        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.flushHeaders?.();

        let closed = false;
        req.on("close", () => {
          closed = true;
        });

        const unsubscribers: Array<() => void> = [];
        try {
          unsubscribers.push(
            (gateway as any).on?.("pipeline.progress", (p: any) => {
              if (closed) return;
              sseWrite(res, "progress", p);
            }) ?? (() => undefined)
          );
          unsubscribers.push(
            (gateway as any).on?.("tool.error", (p: any) => {
              if (closed) return;
              sseWrite(res, "tool_error", p);
            }) ?? (() => undefined)
          );
          unsubscribers.push(
            (gateway as any).on?.("ai.observability", (p: any) => {
              if (closed) return;
              sseWrite(res, "ai_obs", p);
            }) ?? (() => undefined)
          );
        } catch {}

        sseWrite(res, "open", { sessionId: message.sessionId, userId: message.userId });

        const ping = setInterval(() => {
          if (closed) return;
          res.write(":\n\n");
        }, 15_000);
        if (typeof (ping as any).unref === "function") (ping as any).unref();

        let responseText = "";
        try {
          const response = await gateway.handleMessage(message);
          responseText = String(response.text ?? "");
          if (!closed)
            sseWrite(res, "meta", { sessionId: response.sessionId, meta: response.meta ?? {} });
        } catch (err) {
          if (!closed) sseWrite(res, "error", { error: String((err as any)?.message ?? err) });
          clearInterval(ping);
          for (const unsub of unsubscribers) {
            try {
              unsub();
            } catch {}
          }
          res.end();
          return;
        }

        if (!closed) {
          const chunkSize = 48;
          for (let i = 0; i < responseText.length; i += chunkSize) {
            if (closed) break;
            const chunk = responseText.slice(i, i + chunkSize);
            sseWriteText(res, "token", chunk);
          }
          sseWrite(res, "done", { ok: true });
        }
        clearInterval(ping);
        for (const unsub of unsubscribers) {
          try {
            unsub();
          } catch {}
        }
        res.end();
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      if (!auth.ok) {
        writeJson(res, 401, { error: { message: "Unauthorized", type: "invalid_request_error" } });
        return;
      }
      try {
        const parsed = openAiChatCompletionsSchema.parse(await readJson(req, 20 * 1024 * 1024));
        if (parsed.stream) {
          writeJson(res, 400, {
            error: { message: "Streaming not supported", type: "invalid_request_error" },
          });
          return;
        }
        const { prompt, history } = resolveOpenAiUserMessage(parsed.messages);
        if (!prompt) {
          writeJson(res, 400, {
            error: {
              message: "Missing user message in `messages`.",
              type: "invalid_request_error",
            },
          });
          return;
        }
        const runId = `chatcmpl_${randomUUID()}`;
        const userId = parsed.user ? `openai-user:${parsed.user}` : "openai-user";
        const sessionId = parsed.user ? `openai-user:${parsed.user}` : `openai-${Date.now()}`;
        const response = await gateway.handleMessage({
          sessionId,
          userId,
          channel: "openai",
          userRole: auth.role,
          modality: "text",
          text: prompt,
          metadata: history ? { history } : {},
        });
        writeJson(res, 200, {
          id: runId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: parsed.model ?? "openclaw",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: response.text ?? "" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } catch (err) {
        writeJson(res, 500, { error: { message: "internal error", type: "api_error" } });
      }
      return;
    }

    if (req.url === "/v1/responses" && req.method === "POST") {
      if (!auth.ok) {
        writeJson(res, 401, { error: { message: "Unauthorized", type: "invalid_request_error" } });
        return;
      }
      try {
        const parsed = openResponsesSchema.parse(await readJson(req, 20 * 1024 * 1024));
        if (parsed.stream) {
          writeJson(res, 400, {
            error: { message: "Streaming not supported", type: "invalid_request_error" },
          });
          return;
        }
        const message = resolveOpenResponsesMessage(parsed.input);
        if (!message) {
          writeJson(res, 400, {
            error: { message: "Missing input.", type: "invalid_request_error" },
          });
          return;
        }
        const responseId = `resp_${randomUUID()}`;
        const outputMessageId = `msg_${randomUUID()}`;
        const userId = parsed.user ? `openresponses-user:${parsed.user}` : "openresponses-user";
        const sessionId = parsed.user
          ? `openresponses-user:${parsed.user}`
          : `openresponses-${Date.now()}`;
        const reply = await gateway.handleMessage({
          sessionId,
          userId,
          channel: "openresponses",
          userRole: auth.role,
          modality: "text",
          text: message,
          metadata: {},
        });
        writeJson(res, 200, {
          id: responseId,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          status: "completed",
          model: parsed.model ?? "openclaw",
          output: [
            {
              type: "message",
              id: outputMessageId,
              role: "assistant",
              content: [{ type: "output_text", text: reply.text ?? "" }],
              status: "completed",
            },
          ],
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          error: null,
        });
      } catch (err) {
        writeJson(res, 500, { error: { message: "internal error", type: "api_error" } });
      }
      return;
    }

    if (req.url === "/v1/tasks/stats" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const stats = await gateway.getTaskStats();
        writeJson(res, 200, stats);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url?.startsWith("/v1/tasks/snapshot") && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const limitRaw = u.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        const snapshot = await gateway.getTaskSnapshot(limit);
        writeJson(res, 200, snapshot);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/autonomy/status" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const status = await gateway.getAutonomyStatus();
        writeJson(res, 200, status);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/tools/marketplace" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        writeJson(res, 200, gateway.listToolMarketplace());
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/tools/marketplace/reload" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const out = await gateway.reloadToolMarketplace();
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url?.startsWith("/v1/tools/intelligence") && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const limitRaw = u.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        const out = await gateway.listToolIntelligence({ limit });
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/tools/intelligence/recommend" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = toolRecommendSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          writeJson(res, 400, { error: "Bad Request" });
          return;
        }
        const out = await gateway.recommendTools(parsed.data);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/self-improvement/run-once" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = genericObjectSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          writeJson(res, 400, { error: "Bad Request" });
          return;
        }
        const out = await gateway.selfImprovementRunOnce(parsed.data);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/self-improvement/run-loop" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = genericObjectSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          writeJson(res, 400, { error: "Bad Request" });
          return;
        }
        const out = await gateway.selfImprovementRunLoop(parsed.data);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/episodic/latest" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const limitRaw = u.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        const out = await gateway.episodicLatest(limit);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/episodic/search" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const query = String(u.searchParams.get("query") ?? "");
        const limitRaw = u.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        const typeRaw = u.searchParams.get("type");
        const type = typeRaw === "exact" ? "exact" : "semantic";
        const out = await gateway.episodicSearch({ query, limit, type });
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/episodic/record" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = genericObjectSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          writeJson(res, 400, { error: "Bad Request" });
          return;
        }
        const out = await gateway.episodicRecord(parsed.data);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/learning/stats" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const limitRaw = u.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        const out = await gateway.learningStats(limit);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/learning/dataset/export" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = learningDatasetExportSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          writeJson(res, 400, { error: "Bad Request" });
          return;
        }
        const out = await gateway.exportLearningDataset(parsed.data.limit);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/cluster/nodes" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const role = u.searchParams.get("role") ?? undefined;
        const includeStale = u.searchParams.get("includeStale") === "1";
        const staleMsRaw = u.searchParams.get("staleMs");
        const staleMs = staleMsRaw ? Number(staleMsRaw) : undefined;
        const out = await gateway.listClusterNodes({ role, includeStale, staleMs });
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/cluster/nodes/reap" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const parsed = clusterReapSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          writeJson(res, 400, { error: "Bad Request" });
          return;
        }
        const out = await gateway.reapClusterNodes(parsed.data.staleMs);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/optimization/status" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const out = await gateway.optimizationStatus();
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/optimization/model-router/evaluate" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const out = await gateway.optimizationEvaluateModelRouter();
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/feedback/correction" && req.method === "POST") {
      if (!auth.ok) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await readJson(req)) as any;
        const sessionId = typeof body?.sessionId === "string" ? String(body.sessionId) : undefined;
        const userId = typeof body?.userId === "string" ? String(body.userId) : undefined;
        const traceId = typeof body?.traceId === "string" ? String(body.traceId) : undefined;
        const prompt = String(body?.prompt ?? "");
        const answer = String(body?.answer ?? "");
        const correction = String(body?.correction ?? "");
        const out = await (gateway as any).recordUserCorrection({
          sessionId,
          userId,
          traceId,
          prompt,
          answer,
          correction,
        });
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/skill-learning" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const out = await (gateway as any).skillLearningList();
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/skill-learning/approve" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await readJson(req)) as any;
        const id = String(body?.id ?? "");
        const out = await (gateway as any).skillLearningApprove(id);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/skill-learning/reject" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await readJson(req)) as any;
        const id = String(body?.id ?? "");
        const out = await (gateway as any).skillLearningReject(id);
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/skill-learning/create" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = (await readJson(req)) as any;
        const id = String(body?.id ?? "");
        const description = typeof body?.description === "string" ? String(body.description) : undefined;
        const steps = Array.isArray(body?.steps) ? body.steps : [];
        const out = await (gateway as any).skillLearningCreate({ id, description, steps });
        writeJson(res, 200, out);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url?.startsWith("/v1/observability/agents") && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        if (req.url === "/v1/observability/agents/stats") {
          writeJson(res, 200, (gateway as any).getAiObservabilityStats());
          return;
        }
        const limitRaw = u.searchParams.get("limit");
        const agent = u.searchParams.get("agent") ?? undefined;
        const sessionId = u.searchParams.get("sessionId") ?? undefined;
        const traceId = u.searchParams.get("traceId") ?? undefined;
        const limit = limitRaw ? Number(limitRaw) : undefined;
        writeJson(
          res,
          200,
          (gateway as any).listAiObservability({ limit, agent, sessionId, traceId })
        );
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    // Events ingestion
    if (req.url === "/v1/events" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = eventEnvelopeSchema.parse(await readJson(req));
        const result = await gateway.ingestEvent(body);
        writeJson(res, 200, result);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/channels/ingest" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = channelIngestSchema.parse(await readJson(req));
        const result = await (gateway as any).ingestChannelMessage(body);
        writeJson(res, 200, result);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/pairing/pending" && req.method === "GET") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const pending = await (gateway as any).listPendingPairings();
        writeJson(res, 200, { ok: true, pending });
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/pairing/approve" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = pairingApproveSchema.parse(await readJson(req));
        const result = await (gateway as any).approvePairing(body.code);
        writeJson(res, 200, result);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/audit/replay" && req.method === "POST") {
      if (!auth.ok || auth.role !== "admin") {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        const body = auditReplaySchema.parse(await readJson(req));
        const result = await (gateway as any).replayToolCall({
          tool: body.tool,
          args: body.args,
          expectedHash: body.expectedHash,
          approved: body.approved,
        });
        writeJson(res, 200, result);
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/channels/slack/command" && req.method === "POST") {
      const signingSecret = process.env.OPENCLAW_X_SLACK_SIGNING_SECRET ?? "";
      if (!signingSecret) {
        writeJson(res, 503, { error: "Slack integration not configured" });
        return;
      }
      try {
        const timestamp = String(req.headers["x-slack-request-timestamp"] ?? "");
        const signature = String(req.headers["x-slack-signature"] ?? "");
        const tsNum = Number(timestamp);
        if (!tsNum || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) {
          writeJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const raw = await readRaw(req, 512 * 1024);
        const ok = verifySlackSignature({ signingSecret, timestamp, signature, body: raw });
        if (!ok) {
          writeJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const form = new URLSearchParams(raw);
        const { inbound, responseUrl } = slackCommandToInbound(form);
        const access = (gateway as any).checkChannelAccess({
          channel: inbound.channel,
          sender: inbound.sender,
        });
        if (!access.allowed) {
          const code = String(access.pairing?.code ?? "");
          const exposeCode = String(process.env.IA_ASSISTANT_DM_PAIRING_SEND_CODE ?? "0") === "1";
          writeJson(res, 200, {
            response_type: "ephemeral",
            text: exposeCode && code ? `Pairing requerido. Código: ${code}` : "Acesso bloqueado.",
          });
          return;
        }

        writeJson(res, 200, { response_type: "ephemeral", text: "Processando..." });
        if (responseUrl) {
          void (async () => {
            try {
              const result = await (gateway as any).ingestChannelMessage(inbound);
              const text =
                result?.ok && result.response?.text
                  ? String(result.response.text)
                  : "Erro ao processar.";
              await fetch(responseUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ response_type: "ephemeral", text }),
              });
            } catch {}
          })();
        } else {
          void (gateway as any).ingestChannelMessage(inbound).catch(() => undefined);
        }
      } catch (err) {
        if (String((err as any)?.message ?? err) === "Payload too large") {
          slackBadRequest(res);
          return;
        }
        slackBadRequest(res);
      }
      return;
    }

    if (req.url === "/v1/channels/slack/events" && req.method === "POST") {
      const signingSecret = process.env.OPENCLAW_X_SLACK_SIGNING_SECRET ?? "";
      if (!signingSecret) {
        writeJson(res, 503, { error: "Slack integration not configured" });
        return;
      }
      try {
        const timestamp = String(req.headers["x-slack-request-timestamp"] ?? "");
        const signature = String(req.headers["x-slack-signature"] ?? "");
        const tsNum = Number(timestamp);
        if (!tsNum || Math.abs(Date.now() / 1000 - tsNum) > 5 * 60) {
          writeJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const raw = await readRaw(req, 512 * 1024);
        const ok = verifySlackSignature({ signingSecret, timestamp, signature, body: raw });
        if (!ok) {
          writeJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const body = JSON.parse(raw);
        if (body?.type === "url_verification") {
          writeJson(res, 200, { challenge: String(body?.challenge ?? "") });
          return;
        }
        if (body?.type !== "event_callback") {
          writeJson(res, 200, { ok: true });
          return;
        }

        const teamId = String(body?.team_id ?? "unknown");
        const event = body?.event ?? {};
        const channelId = String(event?.channel ?? "unknown");
        const sender = String(event?.user ?? "unknown");
        const text = String(event?.text ?? "").trim();
        writeJson(res, 200, { ok: true });
        if (!text) return;

        const inbound = {
          channel: `slack:${teamId}`,
          sender,
          text,
          metadata: { teamId, channelId, eventType: event?.type ?? null },
        };
        void (async () => {
          try {
            const access = (gateway as any).checkChannelAccess({
              channel: inbound.channel,
              sender: inbound.sender,
            });
            if (!access.allowed) return;
            const result = await (gateway as any).ingestChannelMessage(inbound);
            const outText =
              result?.ok && result.response?.text
                ? String(result.response.text)
                : "Erro ao processar.";
            const botToken = String(process.env.OPENCLAW_X_SLACK_BOT_TOKEN ?? "");
            if (botToken && channelId && channelId !== "unknown") {
              await slackPostMessage({ botToken, channelId, text: outText });
            }
          } catch {}
        })();
      } catch {
        slackBadRequest(res);
      }
      return;
    }

    if (req.url === "/v1/channels/telegram/webhook" && req.method === "POST") {
      const secret = String(process.env.OPENCLAW_X_TELEGRAM_WEBHOOK_SECRET ?? "");
      if (secret) {
        const header = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
        if (!header || header !== secret) {
          writeJson(res, 401, { error: "Unauthorized" });
          return;
        }
      }
      try {
        const body = await readJson(req, 512 * 1024);
        const parsed = telegramUpdateToInbound(body);
        writeJson(res, 200, { ok: true });
        if (!parsed) return;
        void (async () => {
          try {
            const result = await (gateway as any).ingestChannelMessage(parsed.inbound);
            if (!result?.ok) {
              const exposeCode = String(process.env.IA_ASSISTANT_DM_PAIRING_SEND_CODE ?? "0") === "1";
              const code = String(result?.pairing?.code ?? "");
              if (exposeCode && code) {
                const botToken = String(process.env.OPENCLAW_X_TELEGRAM_BOT_TOKEN ?? "");
                if (botToken)
                  await telegramSendMessage({
                    botToken,
                    chatId: parsed.chatId,
                    text: `Pairing requerido. Código: ${code}`,
                  });
              }
              return;
            }
            const outText = result.response?.text ? String(result.response.text) : "Erro ao processar.";
            const botToken = String(process.env.OPENCLAW_X_TELEGRAM_BOT_TOKEN ?? "");
            if (botToken)
              await telegramSendMessage({ botToken, chatId: parsed.chatId, text: outText });
          } catch {}
        })();
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    if (req.url === "/v1/channels/discord/inbound" && req.method === "POST") {
      const secret = String(process.env.OPENCLAW_X_DISCORD_INBOUND_SECRET ?? "");
      if (secret) {
        const header = String(req.headers["x-openclaw-discord-secret"] ?? "");
        if (!header || header !== secret) {
          writeJson(res, 401, { error: "Unauthorized" });
          return;
        }
      }
      try {
        const body = await readJson(req, 512 * 1024);
        const { inbound, replyWebhookUrl } = discordInboundToMessage(body);
        writeJson(res, 200, { ok: true });
        if (!inbound.text || !String(inbound.text).trim()) return;
        void (async () => {
          try {
            const result = await (gateway as any).ingestChannelMessage(inbound);
            if (!result?.ok) {
              const exposeCode = String(process.env.IA_ASSISTANT_DM_PAIRING_SEND_CODE ?? "0") === "1";
              const code = String(result?.pairing?.code ?? "");
              if (exposeCode && code) {
                const webhookUrl =
                  replyWebhookUrl || String(process.env.OPENCLAW_X_DISCORD_WEBHOOK_URL ?? "");
                if (webhookUrl)
                  await discordSendWebhookMessage({
                    webhookUrl,
                    content: `Pairing requerido. Código: ${code}`,
                  });
              }
              return;
            }
            const outText = result.response?.text ? String(result.response.text) : "Erro ao processar.";
            const webhookUrl =
              replyWebhookUrl || String(process.env.OPENCLAW_X_DISCORD_WEBHOOK_URL ?? "");
            if (webhookUrl) await discordSendWebhookMessage({ webhookUrl, content: outText });
          } catch {}
        })();
      } catch (err) {
        writeRequestError(res, err);
      }
      return;
    }

    // Health check
    if (req.url === "/health") {
      writeJson(res, 200, { status: "ok" });
      return;
    }

    if ((req.url === "/" || req.url === "/dashboard") && req.method === "GET") {
      if (!auth.ok) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }
      writeHtml(res, 200, dashboardHtml(port));
      return;
    }

    writeJson(res, 404, { error: "Not found" });
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    const u = new URL(req.url ?? "/", `http://localhost:${port}`);
    const allowQueryToken = process.env.OPENCLAW_X_ALLOW_QUERY_TOKEN === "1";
    const auth = authorize(req, u, { allowQueryToken });
    if (!auth.ok) {
      ws.close();
      return;
    }
    ws.on("message", async (data) => {
      try {
        const payload = agentRequestSchema.parse(JSON.parse(data.toString()));
        const message = buildGatewayMessage(payload, {
          role: auth.role,
          channel: "websocket",
          allowPayloadChannel: false,
          defaultSessionPrefix: "ws",
          defaultUserId: "ws-user",
        });
        const response = await gateway.handleMessage(message);
        ws.send(JSON.stringify(response));
      } catch (err) {
        ws.send(JSON.stringify({ error: String(err) }));
      }
    });
  });

  server.listen(port);

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close();
        server.close((err) => (err ? reject(err) : resolve()));
        clearInterval(rateSweepTimer);
      }),
  };
}
