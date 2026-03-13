import { randomUUID } from "node:crypto";
import type { SharedMemory } from "./shared-memory.js";

export type ConsensusProposal = {
  id: string;
  score: number;
  value: unknown;
  createdAt: number;
};

export type ConsensusResolution = {
  topic: string;
  resolvedAt: number;
  winner: ConsensusProposal | null;
  proposals: ConsensusProposal[];
};

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function idxKey(topic: string) {
  return `consensus:${topic}:index`;
}

function proposalKey(topic: string, id: string) {
  return `consensus:${topic}:proposal:${id}`;
}

function resolvedKey(topic: string) {
  return `consensus:${topic}:resolved`;
}

export async function propose(params: {
  shared: SharedMemory;
  topic: string;
  id?: string;
  value: unknown;
  score?: number;
  ttlMs?: number;
}) {
  const topic = String(params.topic ?? "").trim();
  if (!topic) return { ok: false, error: "missing_topic" } as const;
  const id = String(params.id ?? randomUUID());
  const score = clamp(Number(params.score ?? 0.5), 0, 1);
  const ttlMs = typeof params.ttlMs === "number" ? clamp(params.ttlMs, 500, 24 * 60 * 60_000) : 60 * 60_000;

  const lockOwner = randomUUID();
  const lockOk = await params.shared.acquireLock(`consensus:${topic}`, lockOwner, 2000);
  if (!lockOk) return { ok: false, error: "locked" } as const;
  try {
    const proposal: ConsensusProposal = { id, score, value: params.value, createdAt: Date.now() };
    await params.shared.set(proposalKey(topic, id), proposal, ttlMs);
    const idx = (await params.shared.get<string[]>(idxKey(topic)))?.value;
    const next = Array.isArray(idx) ? idx.slice() : [];
    if (!next.includes(id)) next.push(id);
    await params.shared.set(idxKey(topic), next.slice(0, 200), ttlMs);
    return { ok: true, proposal } as const;
  } finally {
    await params.shared.releaseLock(`consensus:${topic}`, lockOwner);
  }
}

export async function resolve(params: { shared: SharedMemory; topic: string }) {
  const topic = String(params.topic ?? "").trim();
  if (!topic) return { ok: false, error: "missing_topic" } as const;

  const idx = (await params.shared.get<string[]>(idxKey(topic)))?.value;
  const ids = Array.isArray(idx) ? idx.slice(0, 200).map(String) : [];
  const proposals: ConsensusProposal[] = [];
  for (const id of ids) {
    const p = (await params.shared.get<ConsensusProposal>(proposalKey(topic, id)))?.value;
    if (!p) continue;
    proposals.push({
      id: String((p as any).id ?? id),
      score: clamp(Number((p as any).score ?? 0.5), 0, 1),
      value: (p as any).value,
      createdAt: Number((p as any).createdAt ?? Date.now()),
    });
  }
  proposals.sort((a, b) => b.score - a.score);
  const winner = proposals[0] ?? null;
  const resolution: ConsensusResolution = {
    topic,
    resolvedAt: Date.now(),
    winner,
    proposals,
  };
  await params.shared.set(resolvedKey(topic), resolution, 24 * 60 * 60_000);
  return { ok: true, resolution } as const;
}

