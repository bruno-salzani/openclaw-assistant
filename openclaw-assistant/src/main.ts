/*
 * IA Assistant
 * Copyright (c) 2026 Bruno Salzani
 */

import "dotenv/config";
import { createRuntime } from "./runtime.js";

function argValue(args: string[], key: string) {
  const i = args.findIndex((a) => a === key);
  if (i < 0) return null;
  const v = args[i + 1];
  return typeof v === "string" ? v : null;
}

async function main() {
  const args = process.argv.slice(2);
  const role = argValue(args, "--role") ?? argValue(args, "--cluster-role");
  if (role) {
    process.env.IA_ASSISTANT_CLUSTER_ENABLE = "1";
    process.env.IA_ASSISTANT_CLUSTER_ROLE = String(role).toLowerCase();
  }

  const runtime = await createRuntime();
  if (args.includes("--serve")) {
    const portRaw = argValue(args, "--port");
    const port = portRaw ? Number(portRaw) : undefined;
    await runtime.start({ port: Number.isFinite(port) ? port : undefined });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
