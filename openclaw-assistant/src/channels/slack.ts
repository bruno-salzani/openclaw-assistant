import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelInboundMessage } from "./types.js";

export function verifySlackSignature(params: {
  signingSecret: string;
  timestamp: string;
  signature: string;
  body: string;
}) {
  const { signingSecret, timestamp, signature, body } = params;
  if (!signingSecret) return false;
  if (!timestamp || !signature) return false;
  if (!signature.startsWith("v0=")) return false;
  const base = `v0:${timestamp}:${body}`;
  const hmac = createHmac("sha256", signingSecret).update(base).digest("hex");
  const expected = `v0=${hmac}`;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function slackCommandToInbound(form: URLSearchParams): {
  inbound: ChannelInboundMessage;
  responseUrl: string;
  teamId: string;
} {
  const teamId = String(form.get("team_id") ?? "unknown");
  const userId = String(form.get("user_id") ?? "unknown");
  const channelId = String(form.get("channel_id") ?? "unknown");
  const command = String(form.get("command") ?? "/openclaw");
  const text = String(form.get("text") ?? "");
  const responseUrl = String(form.get("response_url") ?? "");
  const inbound: ChannelInboundMessage = {
    channel: `slack:${teamId}`,
    sender: userId,
    text,
    metadata: { teamId, channelId, command, responseUrl },
  };
  return { inbound, responseUrl, teamId };
}
