import type { LLMMessage, LLMProvider } from "../llm/llm-provider.js";
import type { AgentTracker } from "../observability/agent-tracker.js";
import type { AgentProfileRegistry } from "./agent-profile-registry.js";

function buildSystemDirective(profile: { style?: string; sources?: string; system?: string }) {
  const parts: string[] = [];
  if (profile.style) parts.push(`Style: ${profile.style}`);
  if (profile.sources) parts.push(`Sources: ${profile.sources}`);
  if (profile.system) parts.push(String(profile.system));
  if (parts.length === 0) return "";
  return ["[Agent Profile]", ...parts].join("\n");
}

export function wrapLlmWithProfiles(params: {
  base: LLMProvider;
  tracker?: AgentTracker;
  profiles: AgentProfileRegistry;
}): LLMProvider {
  return {
    name: params.base.name,
    chat: async (input) => {
      const agent = params.tracker?.current()?.agent ?? "";
      const profile = agent ? params.profiles.get(agent) : undefined;
      const temperature =
        typeof input.temperature === "number"
          ? input.temperature
          : typeof profile?.temperature === "number"
            ? profile.temperature
            : undefined;
      const system = profile ? buildSystemDirective(profile) : "";
      const messages: LLMMessage[] =
        system && !input.messages.some((m) => m.role === "system" && String(m.content).includes("[Agent Profile]"))
          ? [{ role: "system", content: system }, ...input.messages]
          : input.messages;
      return params.base.chat({ ...input, temperature, messages });
    },
  };
}

