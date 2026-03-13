import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { tryParseJson } from "../infra/json.js";

export type SharedMemoryBackend = "memory" | "file" | "redis";

export type SharedMemoryEntry<T = unknown> = {
  value: T;
  updatedAt: number;
  expiresAt?: number;
};

export type SharedMemoryConfig = {
  backend: SharedMemoryBackend;
  namespace?: string;
  baseDir?: string;
  redisUrl?: string;
};

type Store = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlMs?: number) => Promise<void>;
  del: (key: string) => Promise<number>;
  keys: (prefix: string, limit: number) => Promise<string[]>;
  acquireLock: (key: string, owner: string, ttlMs: number) => Promise<boolean>;
  releaseLock: (key: string, owner: string) => Promise<boolean>;
};

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function nsKey(ns: string, key: string) {
  const k = String(key ?? "").trim();
  const safe = k.replace(/\\s+/g, " ");
  return `${ns}:${safe}`;
}

class InMemoryStore implements Store {
  private readonly map = new Map<string, { v: string; exp?: number }>();

  private readonly locks = new Map<string, { owner: string; exp: number }>();

  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (typeof e.exp === "number" && Date.now() >= e.exp) {
      this.map.delete(key);
      return null;
    }
    return e.v;
  }

  async set(key: string, value: string, ttlMs?: number) {
    const exp = typeof ttlMs === "number" && ttlMs > 0 ? Date.now() + ttlMs : undefined;
    this.map.set(key, { v: value, exp });
  }

  async del(key: string) {
    const ok = this.map.delete(key);
    return ok ? 1 : 0;
  }

  async keys(prefix: string, limit: number) {
    const out: string[] = [];
    const now = Date.now();
    for (const [k, v] of this.map.entries()) {
      if (typeof v.exp === "number" && now >= v.exp) {
        this.map.delete(k);
        continue;
      }
      if (!k.startsWith(prefix)) continue;
      out.push(k);
      if (out.length >= limit) break;
    }
    return out;
  }

  async acquireLock(key: string, owner: string, ttlMs: number) {
    const now = Date.now();
    const ttl = clamp(ttlMs, 50, 5 * 60_000);
    const cur = this.locks.get(key);
    if (cur && now < cur.exp) return false;
    this.locks.set(key, { owner, exp: now + ttl });
    return true;
  }

  async releaseLock(key: string, owner: string) {
    const cur = this.locks.get(key);
    if (!cur) return false;
    if (Date.now() >= cur.exp) {
      this.locks.delete(key);
      return false;
    }
    if (cur.owner !== owner) return false;
    this.locks.delete(key);
    return true;
  }
}

class FileStore implements Store {
  private readonly dir: string;

  private readonly locks = new Map<string, { owner: string; exp: number }>();

  constructor(baseDir: string, private readonly namespace: string) {
    this.dir = path.join(baseDir, ".ia-assistant", "shared-memory", namespace);
  }

  private indexPath() {
    return path.join(this.dir, "_index.json");
  }

  private loadIndex() {
    try {
      const p = this.indexPath();
      if (!fs.existsSync(p)) return {} as Record<string, string>;
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = tryParseJson<Record<string, string>>(raw);
      if (!parsed || typeof parsed !== "object") return {} as Record<string, string>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const key = String(k ?? "").trim();
        const val = String(v ?? "").trim();
        if (!key || !val) continue;
        out[key] = val;
      }
      return out;
    } catch {
      return {} as Record<string, string>;
    }
  }

  private saveIndex(idx: Record<string, string>) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.indexPath(), JSON.stringify(idx, null, 2));
  }

  private filePath(key: string) {
    const digest = createHash("sha256").update(String(key)).digest("hex").slice(0, 24);
    return path.join(this.dir, `${digest}.json`);
  }

  async get(key: string) {
    const idx = this.loadIndex();
    const file = idx[key];
    if (!file) return null;
    const p = path.join(this.dir, file);
    try {
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, "utf-8");
      const entry = tryParseJson<{ v?: unknown; exp?: unknown }>(raw);
      if (!entry) return null;
      const exp = Number(entry.exp);
      if (Number.isFinite(exp) && exp > 0 && Date.now() >= exp) {
        try {
          fs.unlinkSync(p);
        } catch {}
        return null;
      }
      return typeof entry.v === "string" ? String(entry.v) : null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlMs?: number) {
    fs.mkdirSync(this.dir, { recursive: true });
    const idx = this.loadIndex();
    const file = idx[key] ?? path.basename(this.filePath(key));
    idx[key] = file;
    this.saveIndex(idx);
    const p = path.join(this.dir, file);
    const exp = typeof ttlMs === "number" && ttlMs > 0 ? Date.now() + ttlMs : undefined;
    fs.writeFileSync(p, JSON.stringify({ v: value, exp }, null, 2));
  }

  async del(key: string) {
    const idx = this.loadIndex();
    const file = idx[key];
    if (!file) return 0;
    const p = path.join(this.dir, file);
    try {
      if (!fs.existsSync(p)) return 0;
      fs.unlinkSync(p);
      delete idx[key];
      this.saveIndex(idx);
      return 1;
    } catch {
      return 0;
    }
  }

  async keys(prefix: string, limit: number) {
    fs.mkdirSync(this.dir, { recursive: true });
    const out: string[] = [];
    const idx = this.loadIndex();
    for (const k of Object.keys(idx)) {
      if (!k.startsWith(prefix)) continue;
      out.push(k);
      if (out.length >= limit) break;
    }
    return out;
  }

  async acquireLock(key: string, owner: string, ttlMs: number) {
    const now = Date.now();
    const ttl = clamp(ttlMs, 50, 5 * 60_000);
    const cur = this.locks.get(key);
    if (cur && now < cur.exp) return false;
    this.locks.set(key, { owner, exp: now + ttl });
    return true;
  }

  async releaseLock(key: string, owner: string) {
    const cur = this.locks.get(key);
    if (!cur) return false;
    if (Date.now() >= cur.exp) {
      this.locks.delete(key);
      return false;
    }
    if (cur.owner !== owner) return false;
    this.locks.delete(key);
    return true;
  }
}

class RedisStore implements Store {
  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, { lazyConnect: true });
  }

  private async ensure() {
    if ((this.client as any).status === "end") return;
    if ((this.client as any).status === "ready") return;
    try {
      await this.client.connect();
    } catch {}
  }

  async get(key: string) {
    await this.ensure();
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlMs?: number) {
    await this.ensure();
    if (typeof ttlMs === "number" && ttlMs > 0) {
      await this.client.set(key, value, "PX", Math.floor(ttlMs));
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string) {
    await this.ensure();
    return this.client.del(key);
  }

  async keys(prefix: string, limit: number) {
    await this.ensure();
    const match = `${prefix}*`;
    const out: string[] = [];
    let cursor = "0";
    for (let i = 0; i < 20; i++) {
      const res = await (this.client as any).scan(cursor, "MATCH", match, "COUNT", 200);
      cursor = String(res?.[0] ?? "0");
      const keys = Array.isArray(res?.[1]) ? (res[1] as string[]) : [];
      for (const k of keys) {
        out.push(String(k));
        if (out.length >= limit) return out;
      }
      if (cursor === "0") break;
    }
    return out;
  }

  async acquireLock(key: string, owner: string, ttlMs: number) {
    await this.ensure();
    const ttl = clamp(ttlMs, 50, 5 * 60_000);
    const res = await (this.client as any).set(key, owner, "PX", Math.floor(ttl), "NX");
    return String(res ?? "") === "OK";
  }

  async releaseLock(key: string, owner: string) {
    await this.ensure();
    const lua = [
      "if redis.call('get', KEYS[1]) == ARGV[1] then",
      "  return redis.call('del', KEYS[1])",
      "else",
      "  return 0",
      "end",
    ].join("\\n");
    const res = await (this.client as any).eval(lua, 1, key, owner);
    return Number(res ?? 0) > 0;
  }
}

export class SharedMemory {
  private readonly store: Store;

  private readonly ns: string;

  constructor(cfg: SharedMemoryConfig) {
    this.ns = String(cfg.namespace ?? "ia-assistant:shared").trim() || "ia-assistant:shared";
    const backend = cfg.backend;
    if (backend === "redis" && cfg.redisUrl) {
      this.store = new RedisStore(cfg.redisUrl);
    } else if (backend === "file") {
      this.store = new FileStore(cfg.baseDir ?? process.cwd(), this.ns);
    } else {
      this.store = new InMemoryStore();
    }
  }

  async get<T>(key: string): Promise<SharedMemoryEntry<T> | null> {
    const raw = await this.store.get(nsKey(this.ns, key));
    if (!raw) return null;
    const parsed = tryParseJson<SharedMemoryEntry<T>>(raw);
    if (!parsed) return null;
    if (typeof parsed.expiresAt === "number" && parsed.expiresAt > 0 && Date.now() >= parsed.expiresAt) return null;
    return parsed;
  }

  async set<T>(key: string, value: T, ttlMs?: number) {
    const ttl = typeof ttlMs === "number" && ttlMs > 0 ? clamp(ttlMs, 50, 24 * 60 * 60_000) : undefined;
    const entry: SharedMemoryEntry<T> = {
      value,
      updatedAt: Date.now(),
      ...(ttl ? { expiresAt: Date.now() + ttl } : {}),
    };
    await this.store.set(nsKey(this.ns, key), JSON.stringify(entry), ttl);
    return entry;
  }

  async del(key: string) {
    return this.store.del(nsKey(this.ns, key));
  }

  async keys(prefix?: string, limit?: number) {
    const pfx = nsKey(this.ns, String(prefix ?? ""));
    const lim = typeof limit === "number" ? Math.max(1, Math.min(500, Math.floor(limit))) : 200;
    const ks = await this.store.keys(pfx, lim);
    return ks.map((k) => k.replace(`${this.ns}:`, ""));
  }

  async acquireLock(key: string, owner: string, ttlMs?: number) {
    const ttl = typeof ttlMs === "number" && ttlMs > 0 ? clamp(ttlMs, 50, 5 * 60_000) : 30_000;
    return this.store.acquireLock(nsKey(this.ns, `lock:${key}`), String(owner), ttl);
  }

  async releaseLock(key: string, owner: string) {
    return this.store.releaseLock(nsKey(this.ns, `lock:${key}`), String(owner));
  }
}
