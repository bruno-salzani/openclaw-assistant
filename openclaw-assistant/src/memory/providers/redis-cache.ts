import type { ShortTermMemory } from "../memory-types.js";
import { Redis } from "ioredis";

export class RedisCache implements ShortTermMemory {
  private client: Redis | null = null;

  private readonly localCache = new Map<string, string>();

  constructor(url?: string) {
    if (url) {
      this.client = new Redis(url, { lazyConnect: true });
    }
  }

  async connect() {
    if (this.client) await this.client.connect();
  }

  async get(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    return this.localCache.get(key) ?? null;
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (this.client) {
      if (ttl) await this.client.set(key, value, "EX", ttl);
      else await this.client.set(key, value);
    } else {
      this.localCache.set(key, value);
    }
  }
}
