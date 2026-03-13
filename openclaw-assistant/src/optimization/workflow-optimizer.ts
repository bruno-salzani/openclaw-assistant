import type { ToolProfile } from "../tools/intelligence/tool-profiler.js";
import { recommendTools } from "../tools/intelligence/tool-recommendation.js";

export function suggestWorkflowToolSwap(params: {
  profiles: ToolProfile[];
  category: "search" | "filesystem" | "calendar" | "email" | "db";
  candidates?: string[];
}) {
  const query =
    params.category === "search"
      ? "search"
      : params.category === "filesystem"
        ? "filesystem"
        : params.category === "calendar"
          ? "calendar"
          : params.category === "email"
            ? "email"
            : "postgres";
  const out = recommendTools({
    profiles: params.profiles,
    candidates: params.candidates,
    query,
    limit: 5,
  });
  return {
    ok: true,
    category: params.category,
    best: out.best,
    ranked: out.ranked,
  };
}

