import type { LLMProvider, LLMMessage } from "../llm/llm-provider.js";
import { LLMRouter } from "../llm/router.js";

export class ModelRouter implements LLMProvider {
  name = "model-router";

  constructor(private readonly router: LLMRouter) {}

  pick(messages: LLMMessage[]) {
    return this.router.pickRoute(messages);
  }

  listConfiguredProviders() {
    return this.router.listConfiguredProviders();
  }

  async chat(input: { messages: LLMMessage[]; temperature?: number; maxTokens?: number }): Promise<string> {
    return this.router.chat(input);
  }

  async chatWithRoute(
    route: "cheap" | "reasoning" | "coding" | "offline" | "default",
    input: { messages: LLMMessage[]; temperature?: number; maxTokens?: number }
  ): Promise<string> {
    return this.router.chatWithRoute(route, input);
  }
}

