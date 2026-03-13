import test from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "../../runtime.js";
import { WebSocket } from "ws";

function httpGet(url: string, headers: Record<string, string> = {}) {
  return fetch(url, { headers }).then((r) => ({ status: r.status, body: r.text() }));
}
function httpPost(url: string, body: any, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }).then((r) => ({ status: r.status, body: r.text() }));
}
function httpPostRaw(url: string, body: string, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  }).then((r) => ({ status: r.status, body: r.text() }));
}
function httpPostStream(url: string, body: any, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({
    status: r.status,
    contentType: r.headers.get("content-type") ?? "",
    body: await r.text(),
  }));
}
function wsExpectClose(url: string, headers?: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {}
      reject(new Error("timeout"));
    }, 250);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.on("close", done);
    ws.on("error", done);
  });
}
function wsExpectOpen(url: string, headers?: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, headers ? { headers } : undefined);
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {}
      reject(new Error("timeout"));
    }, 250);
    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test("Gateway auth: protects admin endpoints and allows agent with token", async () => {
  process.env.OPENCLAW_X_PORT = "18790";
  process.env.OPENCLAW_X_ADMIN_TOKEN = "admintoken";
  process.env.OPENCLAW_X_PUBLIC_TOKEN = "publictoken";

  const rt = await createRuntime();
  await rt.gateway.start();

  const base = "http://localhost:18790";

  // Unauth access to admin endpoint should 401
  {
    const res = await httpGet(`${base}/v1/autonomy/status`);
    assert.equal(res.status, 401);
  }

  // Autonomy with admin token OK
  {
    const res = await httpGet(`${base}/v1/autonomy/status`, { authorization: "Bearer admintoken" });
    assert.equal(res.status, 200);
  }

  // Agent with public token OK
  {
    const res = await httpPost(
      `${base}/v1/agent`,
      { text: "Olá", sessionId: "t", userId: "u", channel: "http", modality: "text" },
      { authorization: "Bearer publictoken" }
    );
    assert.equal(res.status, 200);
  }

  // Agent stream with public token OK
  {
    const res = await httpPostStream(
      `${base}/v1/agent/stream`,
      { text: "Olá", sessionId: "t2", userId: "u", channel: "http", modality: "text" },
      { authorization: "Bearer publictoken" }
    );
    assert.equal(res.status, 200);
    assert.ok(res.contentType.includes("text/event-stream"));
    assert.ok(res.body.includes("event: done"));
  }

  // Invalid JSON should be 400
  {
    const res = await httpPostRaw(`${base}/v1/agent`, "{", { authorization: "Bearer publictoken" });
    assert.equal(res.status, 400);
  }

  // Payload too large should be 413
  {
    const bigText = "A".repeat(1024 * 1024 + 100);
    const res = await httpPost(
      `${base}/v1/agent`,
      { text: bigText },
      { authorization: "Bearer publictoken" }
    );
    assert.equal(res.status, 413);
  }

  // WS without auth should close
  {
    await wsExpectClose("ws://localhost:18790");
  }

  // WS with auth header should open
  {
    await wsExpectOpen("ws://localhost:18790", { authorization: "Bearer publictoken" });
  }

  await rt.gateway.stop();
  rt.stop();
});
