import type { LLMMessage, LLMProvider } from "./llm-provider.js";

type OllamaChatResponse = {
  message?: { content?: string };
  error?: string;
};

export class OllamaProvider implements LLMProvider {
  name: string;

  private readonly baseUrl: string;

  private readonly model: string;

  private readonly timeoutMs: number;

  constructor(params: { name?: string; baseUrl?: string; model: string; timeoutMs?: number }) {
    this.name = params.name ?? "ollama";
    this.baseUrl = (params.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = params.model;
    this.timeoutMs = params.timeoutMs ?? 60_000;
  }

  async chat(input: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
          options: {
            temperature: input.temperature,
            num_predict: input.maxTokens,
          },
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as OllamaChatResponse | null;
      if (!res.ok) throw new Error(data?.error || `Ollama error (${res.status})`);
      const txt = data?.message?.content;
      return typeof txt === "string" ? txt : "";
    } finally {
      clearTimeout(timeout);
    }
  }
}
