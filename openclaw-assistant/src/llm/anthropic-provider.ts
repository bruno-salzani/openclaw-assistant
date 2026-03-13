import type { LLMMessage, LLMProvider } from "./llm-provider.js";

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

export class AnthropicProvider implements LLMProvider {
  name: string;

  private readonly apiKey: string;

  private readonly model: string;

  private readonly baseUrl: string;

  private readonly timeoutMs: number;

  constructor(params: {
    name?: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    this.name = params.name ?? "anthropic";
    this.apiKey = params.apiKey;
    this.model = params.model;
    this.baseUrl = (params.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
    this.timeoutMs = params.timeoutMs ?? 30_000;
  }

  async chat(input: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const systemParts = input.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .filter(Boolean);
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
    const messages = input.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          system,
          messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens ?? 1024,
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as AnthropicMessageResponse | null;
      if (!res.ok) {
        const msg = data?.error?.message || `Anthropic error (${res.status})`;
        throw new Error(msg);
      }
      const txt = data?.content?.find((c) => c.type === "text")?.text;
      return typeof txt === "string" ? txt : "";
    } finally {
      clearTimeout(timeout);
    }
  }
}
