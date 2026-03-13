export function tryParseJson<T>(text: string): T | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  const unfenced = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced) as T;
  } catch {}

  const startObj = unfenced.indexOf("{");
  const endObj = unfenced.lastIndexOf("}");
  if (startObj >= 0 && endObj > startObj) {
    try {
      return JSON.parse(unfenced.slice(startObj, endObj + 1)) as T;
    } catch {}
  }

  const startArr = unfenced.indexOf("[");
  const endArr = unfenced.lastIndexOf("]");
  if (startArr >= 0 && endArr > startArr) {
    try {
      return JSON.parse(unfenced.slice(startArr, endArr + 1)) as T;
    } catch {}
  }

  return null;
}

