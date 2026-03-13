import { Redis } from "ioredis";

export class TriggerDedupeStore {
  private readonly redis: Redis | null;

  private readonly local = new Map<string, number>();

  constructor(url?: string) {
    this.redis = url
      ? new Redis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1 })
      : null;
  }

  private sweep(now: number) {
    for (const [k, exp] of this.local.entries()) {
      if (exp <= now) this.local.delete(k);
    }
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    if (this.redis) {
      try {
        await this.redis.connect();
        const res = await this.redis.set(`trg:${key}`, "1", "PX", ttlMs, "NX");
        return res === "OK";
      } catch {
        this.redis.disconnect();
      }
    }
    this.sweep(now);
    const exp = this.local.get(key);
    if (exp && exp > now) return false;
    this.local.set(key, now + ttlMs);
    return true;
  }
}
