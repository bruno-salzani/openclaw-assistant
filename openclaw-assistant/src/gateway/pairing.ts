import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type PairingState = {
  allowlist: Record<string, string[]>;
  pending: Record<string, { channel: string; sender: string; createdAt: number }>;
};

function safeChannelId(channel: string) {
  return channel.replace(/[^a-z0-9._:-]/gi, "").slice(0, 64) || "unknown";
}

function safeSenderId(sender: string) {
  return sender.replace(/[^\w@.+:-]/g, "").slice(0, 256) || "unknown";
}

export class PairingManager {
  private readonly filePath: string;

  private state: PairingState = { allowlist: {}, pending: {} };

  private readonly pendingTtlMs: number;

  constructor(params: { cwd: string; pendingTtlMs?: number }) {
    this.pendingTtlMs = params.pendingTtlMs ?? 15 * 60_000;
    const dir = path.join(params.cwd, ".ia-assistant");
    this.filePath = path.join(dir, "pairing.json");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    this.load();
  }

  private load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PairingState;
      if (parsed && typeof parsed === "object") this.state = parsed;
    } catch {}
    this.sweepPending();
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
    } catch {}
  }

  private sweepPending() {
    const now = Date.now();
    const next: PairingState["pending"] = {};
    for (const [code, v] of Object.entries(this.state.pending ?? {})) {
      if (!v || typeof v !== "object") continue;
      if (now - v.createdAt > this.pendingTtlMs) continue;
      next[code] = v;
    }
    this.state.pending = next;
  }

  isAllowed(channel: string, sender: string) {
    const c = safeChannelId(channel);
    const s = safeSenderId(sender);
    const arr = this.state.allowlist[c] ?? [];
    return arr.includes(s);
  }

  listPending() {
    this.sweepPending();
    return Object.entries(this.state.pending).map(([code, v]) => ({
      code,
      channel: v.channel,
      sender: v.sender,
      createdAt: v.createdAt,
    }));
  }

  requestPairing(channel: string, sender: string) {
    this.sweepPending();
    const c = safeChannelId(channel);
    const s = safeSenderId(sender);
    const existing = Object.entries(this.state.pending).find(
      ([, v]) => v.channel === c && v.sender === s
    );
    if (existing) return { code: existing[0] };
    const code = randomUUID().split("-")[0];
    this.state.pending[code] = { channel: c, sender: s, createdAt: Date.now() };
    this.save();
    return { code };
  }

  approve(code: string) {
    this.sweepPending();
    const entry = this.state.pending[code];
    if (!entry) return { ok: false as const };
    const arr = this.state.allowlist[entry.channel] ?? [];
    if (!arr.includes(entry.sender)) arr.push(entry.sender);
    this.state.allowlist[entry.channel] = arr;
    delete this.state.pending[code];
    this.save();
    return { ok: true as const, channel: entry.channel, sender: entry.sender };
  }
}
