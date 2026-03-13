import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { createHmac } from "node:crypto";

import { createRuntime } from "../../runtime.js";

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") {
        s.close();
        reject(new Error("no address"));
        return;
      }
      const port = a.port;
      s.close(() => resolve(port));
    });
  });
}

function signSlack(body: string, signingSecret: string, timestamp: string) {
  const base = `v0:${timestamp}:${body}`;
  const hmac = createHmac("sha256", signingSecret).update(base).digest("hex");
  return `v0=${hmac}`;
}

async function waitFor(cond: () => boolean, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("Channels: Slack events, Telegram webhook, Discord inbound", async () => {
  const port = await getFreePort();
  process.env.OPENCLAW_X_PORT = String(port);
  process.env.OPENCLAW_X_ADMIN_TOKEN = "admintoken";
  process.env.OPENCLAW_X_PUBLIC_TOKEN = "publictoken";
  process.env.OPENCLAW_X_DM_POLICY = "open";

  process.env.OPENCLAW_X_SLACK_SIGNING_SECRET = "slacksecret";
  process.env.OPENCLAW_X_SLACK_BOT_TOKEN = "slackbottoken";
  process.env.OPENCLAW_X_TELEGRAM_WEBHOOK_SECRET = "tgsecret";
  process.env.OPENCLAW_X_TELEGRAM_BOT_TOKEN = "tgbottoken";
  process.env.OPENCLAW_X_DISCORD_INBOUND_SECRET = "discordsecret";
  process.env.OPENCLAW_X_DISCORD_WEBHOOK_URL = "https://discord.example/webhook";

  const originalFetch = globalThis.fetch;
  const outbound: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url ?? "");
    if (u.startsWith("https://slack.com/api/chat.postMessage")) {
      outbound.push({ url: u, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.startsWith("https://api.telegram.org/bottgbottoken/sendMessage")) {
      outbound.push({ url: u, body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.startsWith("https://discord.example/webhook")) {
      outbound.push({ url: u, body: String(init?.body ?? "") });
      return new Response("ok", { status: 200 });
    }
    return originalFetch(url, init);
  }) as any;

  const rt = await createRuntime();
  await rt.gateway.start();
  const base = `http://127.0.0.1:${port}`;

  try {
    {
      const body = JSON.stringify({ type: "url_verification", challenge: "c" });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signSlack(body, "slacksecret", timestamp);
      const res = await fetch(`${base}/v1/channels/slack/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signature,
        },
        body,
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.challenge, "c");
    }

    {
      const update = {
        update_id: 1,
        message: {
          message_id: 2,
          from: { id: 10, username: "u" },
          chat: { id: 20, type: "private" },
          text: "Olá",
        },
      };
      const res = await fetch(`${base}/v1/channels/telegram/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "tgsecret",
        },
        body: JSON.stringify(update),
      });
      assert.equal(res.status, 200);
      await waitFor(() => outbound.some((o) => o.url.includes("api.telegram.org")), 1500);
      assert.ok(outbound.some((o) => o.url.includes("api.telegram.org")));
    }

    {
      const res = await fetch(`${base}/v1/channels/discord/inbound`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openclaw-discord-secret": "discordsecret",
        },
        body: JSON.stringify({ channelId: "c1", userId: "u1", text: "ping" }),
      });
      assert.equal(res.status, 200);
      await waitFor(() => outbound.some((o) => o.url.includes("discord.example/webhook")), 1500);
      assert.ok(outbound.some((o) => o.url.includes("discord.example/webhook")));
    }
  } finally {
    await rt.gateway.stop();
    rt.stop();
    globalThis.fetch = originalFetch;
  }
});
