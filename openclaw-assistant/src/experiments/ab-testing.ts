export type Variant = {
  id: string;
  meta?: Record<string, unknown>;
};

export type AbTestResult<T> = {
  ok: boolean;
  a: { id: string; results: T[] };
  b: { id: string; results: T[] };
};

export function splitEvenly<T>(items: T[]) {
  const a: T[] = [];
  const b: T[] = [];
  for (let i = 0; i < items.length; i += 1) {
    (i % 2 === 0 ? a : b).push(items[i]!);
  }
  return { a, b };
}

