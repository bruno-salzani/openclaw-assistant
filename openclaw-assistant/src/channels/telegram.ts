import type { ChannelInboundMessage } from "./types.js";

export function telegramUpdateToInbound(update: any): {
  inbound: ChannelInboundMessage;
  chatId: string;
} | null {
  const message = update?.message ?? update?.edited_message ?? null;
  if (!message) return null;
  const text = typeof message.text === "string" ? message.text : "";
  if (!text.trim()) return null;
  const chatId = String(message.chat?.id ?? "");
  const fromId = String(message.from?.id ?? "");
  if (!chatId || !fromId) return null;
  const inbound: ChannelInboundMessage = {
    channel: `telegram:${chatId}`,
    sender: `telegram:${fromId}`,
    text,
    metadata: {
      chatId,
      fromId,
      messageId: message.message_id ?? null,
      username: message.from?.username ?? null,
    },
  };
  return { inbound, chatId };
}

export async function telegramSendMessage(params: {
  botToken: string;
  chatId: string;
  text: string;
}) {
  const url = `https://api.telegram.org/bot${params.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: params.chatId, text: params.text }),
  });
  return res.json().catch(() => null);
}
