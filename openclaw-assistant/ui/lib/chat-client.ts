import type { ChatRequest, ChatResponse } from "./chat-types";

export async function postChat(
  req: ChatRequest,
  params?: { timeoutMs?: number }
): Promise<ChatResponse> {
  const timeoutMs = params?.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && typeof (data as any).error === "string"
          ? String((data as any).error)
          : "Erro ao chamar o gateway.";
      return { ok: false, error: msg };
    }
    const text =
      data && typeof data === "object" && typeof (data as any).text === "string"
        ? String((data as any).text)
        : JSON.stringify(data);
    return { ok: true, text, raw: data };
  } catch (err) {
    const name = err && typeof err === "object" ? String((err as any).name ?? "") : "";
    if (name === "AbortError") return { ok: false, error: "Timeout ao chamar o gateway." };
    return { ok: false, error: "Falha de rede ao chamar o gateway." };
  } finally {
    clearTimeout(timeout);
  }
}
