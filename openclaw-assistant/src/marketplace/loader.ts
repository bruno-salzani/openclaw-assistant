import fs from "node:fs";
import path from "node:path";

import type { Marketplace } from "./registry.js";

function readJsonSafe(p: string) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function listDirs(p: string) {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function loadPluginMeta(dir: string) {
  const p = path.join(dir, "plugin.json");
  if (!fs.existsSync(p)) return null;
  const m = readJsonSafe(p);
  if (!m || typeof m !== "object") return null;
  const name = typeof (m as any).name === "string" ? String((m as any).name) : null;
  const version = typeof (m as any).version === "string" ? String((m as any).version) : undefined;
  const description =
    typeof (m as any).description === "string" ? String((m as any).description) : undefined;
  const entry = typeof (m as any).entry === "string" ? String((m as any).entry) : undefined;
  const permissions = Array.isArray((m as any).permissions)
    ? (m as any).permissions.map(String).slice(0, 50)
    : undefined;
  const type = typeof (m as any).type === "string" ? String((m as any).type) : undefined;
  return { name, version, description, entry, permissions, type };
}

export function loadMarketplace(repoPath: string, marketplace: Marketplace) {
  const agentsDir = path.join(repoPath, "agents");
  const skillsDir = path.join(repoPath, "skills");
  const extensionsDir = path.join(repoPath, "extensions");

  for (const name of listDirs(agentsDir)) {
    const meta = loadPluginMeta(path.join(agentsDir, name));
    marketplace.add({
      kind: "agent",
      name,
      description: meta?.description,
      version: meta?.version,
      entry: meta?.entry,
      permissions: meta?.permissions,
    });
  }
  for (const name of listDirs(skillsDir)) {
    const meta = loadPluginMeta(path.join(skillsDir, name));
    marketplace.add({
      kind: "skill",
      name,
      description: meta?.description,
      version: meta?.version,
      entry: meta?.entry,
      permissions: meta?.permissions,
    });
  }
  for (const name of listDirs(extensionsDir)) {
    const meta = loadPluginMeta(path.join(extensionsDir, name));
    marketplace.add({
      kind: "tool",
      name,
      description: meta?.description,
      version: meta?.version,
      entry: meta?.entry,
      permissions: meta?.permissions,
    });
  }

  return marketplace;
}
