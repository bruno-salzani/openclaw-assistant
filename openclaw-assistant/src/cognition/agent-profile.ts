export type AgentProfile = {
  id: string;
  style?: "academic" | "concise" | "friendly" | "formal";
  sources?: "scientific" | "general" | "primary";
  temperature?: number;
  system?: string;
};

