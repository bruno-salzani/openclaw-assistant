import type { ChannelInboundMessage } from "./types.js";

export function discordInboundToMessage(body: any): {
  inbound: ChannelInboundMessage;
  replyWebhookUrl?: string;
} {
  const channelId = String(body?.channelId ?? "unknown");
  const userId = String(body?.userId ?? "unknown");
  const text = String(body?.text ?? "");
  const replyWebhookUrl =
    typeof body?.replyWebhookUrl === "string" ? String(body.replyWebhookUrl) : undefined;
  const inbound: ChannelInboundMessage = {
    channel: `discord:${channelId}`,
    sender: `discord:${userId}`,
    text,
    metadata: {
      channelId,
      userId,
      guildId: body?.guildId ?? null,
      username: body?.username ?? null,
    },
  };
  return { inbound, replyWebhookUrl };
}

export async function discordSendWebhookMessage(params: { webhookUrl: string; content: string }) {
  const content = String(params.content ?? "").slice(0, 1900);
  const res = await fetch(params.webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return res.text().catch(() => "");
}
