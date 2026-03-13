export type LLMMessage = { role: string; content: string };

export interface LLMProvider {
  name: string;
  chat(input: {
    messages: LLMMessage[];
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;
}
