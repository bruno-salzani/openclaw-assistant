function parse(v: string) {
  const m = String(v ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function bumpVersion(v: string, kind: "major" | "minor" | "patch" = "patch") {
  const p = parse(v) ?? { major: 0, minor: 0, patch: 0 };
  if (kind === "major") return `${p.major + 1}.0.0`;
  if (kind === "minor") return `${p.major}.${p.minor + 1}.0`;
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}

