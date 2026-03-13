export type VectorDbSearchResult = {
  id: string;
  score?: number;
  text?: string;
  metadata?: Record<string, unknown>;
};

export interface VectorDB {
  init?(): Promise<void>;

  insert(input: {
    id: string;
    text: string;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  search(input: {
    query: number[];
    limit?: number;
    filter?: Record<string, unknown>;
  }): Promise<VectorDbSearchResult[]>;
}
