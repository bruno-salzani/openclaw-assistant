import type { LLMMessage, LLMProvider } from "./llm-provider.js";

type OpenAIChatCompletionsResponse = {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
};

export class OpenAIProvider implements LLMProvider {
  name: string;

  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly model: string;

  private readonly timeoutMs: number;

  constructor(params: {
    name?: string;
    apiKey: string;
    model: string;
    baseUrl?: string;
    timeoutMs?: number;
  }) {
    this.name = params.name ?? "openai";
    this.apiKey = params.apiKey;
    this.model = params.model;
    this.baseUrl = (params.baseUrl ?? "https://api.openai.com").replace(/\/+$/, "");
    this.timeoutMs = params.timeoutMs ?? 30_000;
  }

  async chat(input: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: input.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          temperature: input.temperature,
          max_tokens: input.maxTokens,
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as OpenAIChatCompletionsResponse | null;
      if (!res.ok) {
        const msg = data?.error?.message || `OpenAI error (${res.status})`;
        throw new Error(msg);
      }
      const txt = data?.choices?.[0]?.message?.content;
      return typeof txt === "string" ? txt : "";
    } finally {
      clearTimeout(timeout);
    }
  }
}
