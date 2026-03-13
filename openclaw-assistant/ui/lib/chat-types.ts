export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type ChatRequest = {
  text: string;
  sessionId?: string;
};

export type ChatResponse = { ok: true; text: string; raw?: unknown } | { ok: false; error: string };

export function isChatRequest(x: unknown): x is ChatRequest {
  if (!x || typeof x !== "object") return false;
  const v = x as Record<string, unknown>;
  if (typeof v.text !== "string") return false;
  if (typeof v.sessionId === "undefined") return true;
  return typeof v.sessionId === "string";
}
