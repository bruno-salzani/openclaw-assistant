import { Redis } from "ioredis";
import type { TaskType } from "../tasks/task-types.js";

export type ClusterNodeRole = "runtime" | "worker" | "simulation";

export type ClusterNodeInfo = {
  nodeId: string;
  role: ClusterNodeRole;
  types: TaskType[];
  capacity?: number;
  busy?: number;
  meta?: Record<string, unknown>;
  lastSeenAt: number;
};

type Keys = {
  nodes: string;
  heartbeats: string;
};

function keys(ns: string): Keys {
  return {
    nodes: `${ns}:nodes`,
    heartbeats: `${ns}:heartbeats`,
  };
}

function uniq(xs: string[]) {
  return Array.from(new Set(xs.map(String).map((s) => s.trim()).filter(Boolean)));
}

export class NodeRegistry {
  private readonly redis: Redis;

  private readonly k: Keys;

  constructor(params: { redisUrl: string; namespace?: string }) {
    this.redis = new Redis(params.redisUrl);
    this.k = keys(params.namespace ?? "ia-assistant:cluster");
  }

  async upsert(node: Omit<ClusterNodeInfo, "lastSeenAt"> & { lastSeenAt?: number }) {
    const now = Number.isFinite(node.lastSeenAt) ? Number(node.lastSeenAt) : Date.now();
    const info: ClusterNodeInfo = {
      nodeId: String(node.nodeId),
      role: node.role,
      types: uniq((node.types ?? []).map(String)) as any,
      capacity: Number.isFinite(node.capacity) ? Number(node.capacity) : undefined,
      busy: Number.isFinite(node.busy) ? Number(node.busy) : undefined,
      meta: node.meta,
      lastSeenAt: now,
    };
    await this.redis.hset(this.k.nodes, info.nodeId, JSON.stringify(info));
    await this.redis.zadd(this.k.heartbeats, String(now), info.nodeId);
    return info;
  }

  async heartbeat(nodeId: string, patch?: { busy?: number; capacity?: number; types?: TaskType[] }) {
    const id = String(nodeId);
    const now = Date.now();
    const raw = await this.redis.hget(this.k.nodes, id);
    let prev: ClusterNodeInfo | null = null;
    try {
      prev = raw ? (JSON.parse(raw) as ClusterNodeInfo) : null;
    } catch {
      prev = null;
    }
    const next: ClusterNodeInfo = {
      nodeId: id,
      role: (prev?.role ?? "worker") as any,
      types: uniq(((patch?.types ?? prev?.types ?? []) as any).map(String)) as any,
      capacity: Number.isFinite(patch?.capacity) ? Number(patch?.capacity) : prev?.capacity,
      busy: Number.isFinite(patch?.busy) ? Number(patch?.busy) : prev?.busy,
      meta: prev?.meta,
      lastSeenAt: now,
    };
    await this.redis.hset(this.k.nodes, id, JSON.stringify(next));
    await this.redis.zadd(this.k.heartbeats, String(now), id);
    return next;
  }

  async list(params?: { role?: ClusterNodeRole; includeStale?: boolean; staleMs?: number }) {
    const staleMs = Number.isFinite(params?.staleMs) ? Number(params?.staleMs) : 15_000;
    const now = Date.now();
    const raw = await this.redis.hgetall(this.k.nodes);
    const nodes = Object.values(raw)
      .map((v) => {
        try {
          return JSON.parse(v) as ClusterNodeInfo;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as ClusterNodeInfo[];

    const filtered = nodes.filter((n) => {
      if (params?.role && n.role !== params.role) return false;
      if (params?.includeStale) return true;
      return now - Number(n.lastSeenAt ?? 0) <= staleMs;
    });
    filtered.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return filtered;
  }

  async reapStale(staleMs = 60_000, limit = 500) {
    const cutoff = Date.now() - staleMs;
    const ids = await this.redis.zrangebyscore(this.k.heartbeats, 0, cutoff, "LIMIT", 0, limit);
    if (ids.length === 0) return { removed: 0 };
    await this.redis.hdel(this.k.nodes, ...ids);
    await this.redis.zrem(this.k.heartbeats, ...ids);
    return { removed: ids.length };
  }

  async close() {
    try {
      await this.redis.quit();
    } catch {}
  }
}
