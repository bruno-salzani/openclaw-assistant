import { randomUUID } from "node:crypto";
import type { MemorySystem } from "../memory-system.js";

export type Episode = {
  id: string;
  ts: number;
  kind: string;
  objective: string;
  sessionId?: string;
  userId?: string;
  workspaceId?: string;
  ok?: boolean;
  score?: number;
  lessons?: string[];
  tags?: string[];
  plan?: unknown;
  actions?: unknown;
  result?: unknown;
};

function tryParseEpisode(content: string): Episode | null {
  const raw = String(content ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    if (!obj || typeof obj !== "object") return null;
    if (typeof (obj as any).objective !== "string") return null;
    if (typeof (obj as any).id !== "string") return null;
    return obj as Episode;
  } catch {
    return null;
  }
}

export class EpisodeStore {
  constructor(private readonly deps: { memory: MemorySystem }) {}

  async record(ep: Omit<Episode, "id" | "ts"> & { id?: string; ts?: number }) {
    const now = typeof ep.ts === "number" ? ep.ts : Date.now();
    const id = typeof ep.id === "string" && ep.id.trim() ? ep.id : randomUUID();
    const episode: Episode = { ...ep, id, ts: now };
    const content = `[EPISODE]\n${JSON.stringify(episode)}`;
    await this.deps.memory.add("episodic", content, {
      kind: episode.kind,
      ts: episode.ts,
      sessionId: episode.sessionId,
      userId: episode.userId,
      workspaceId: episode.workspaceId,
      ok: episode.ok,
    });
    return { ok: true, episode };
  }

  async search(params: {
    query: string;
    limit?: number;
    type?: "semantic" | "exact";
    workspaceId?: string;
    userId?: string;
  }) {
    const query = String(params.query ?? "").trim();
    if (!query) return { ok: false, error: "missing_query" };
    const limit = typeof params.limit === "number" ? Math.max(1, Math.min(200, params.limit)) : 20;
    const hits = await this.deps.memory.search(query, {
      limit,
      type: params.type,
      workspaceId: params.workspaceId,
      userId: params.userId,
    });
    const episodes = hits.map((h) => tryParseEpisode(h.content)).filter((e): e is Episode => Boolean(e));
    return { ok: true, episodes };
  }

  async latest(params?: { limit?: number }) {
    const limit = typeof params?.limit === "number" ? Math.max(1, Math.min(200, params.limit)) : 20;
    const hits = await this.deps.memory.search("[EPISODE]", { limit, type: "exact" });
    const episodes = hits.map((h) => tryParseEpisode(h.content)).filter((e): e is Episode => Boolean(e));
    return { ok: true, episodes };
  }
}

