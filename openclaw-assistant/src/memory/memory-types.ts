export type MemoryEntry = {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export interface ShortTermMemory {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
}

export interface LongTermMemory {
  add(content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
}

export interface SemanticMemory {
  add(content: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  search(
    vector: number[],
    limit?: number,
    filter?: Record<string, unknown>
  ): Promise<MemoryEntry[]>;
}
