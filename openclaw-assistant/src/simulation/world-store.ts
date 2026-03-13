import fs from "node:fs";
import path from "node:path";
import { tryParseJson } from "../infra/json.js";

export type SimulationWorld = {
  id: string;
  tick: number;
  updatedAt: number;
  data: Record<string, unknown>;
};

export class SimulationWorldStore {
  constructor(private readonly baseDir: string = process.cwd()) {}

  private filePath(worldId: string) {
    const root = String(process.env.IA_ASSISTANT_SIMULATION_WORLD_DIR ?? "").trim();
    const base = root ? path.resolve(this.baseDir, root) : path.join(this.baseDir, ".ia-assistant", "simulation", "worlds");
    const safe = String(worldId ?? "").trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
    return path.join(base, `${safe || "default"}.json`);
  }

  load(worldId: string): SimulationWorld {
    const p = this.filePath(worldId);
    try {
      if (!fs.existsSync(p)) {
        return { id: worldId, tick: 0, updatedAt: Date.now(), data: {} };
      }
      const raw = fs.readFileSync(p, "utf-8");
      const parsed = tryParseJson<SimulationWorld>(raw);
      if (!parsed || typeof parsed !== "object") return { id: worldId, tick: 0, updatedAt: Date.now(), data: {} };
      const id = typeof (parsed as any).id === "string" ? String((parsed as any).id) : worldId;
      const tick = Number.isFinite(Number((parsed as any).tick)) ? Number((parsed as any).tick) : 0;
      const data = (parsed as any).data && typeof (parsed as any).data === "object" ? (parsed as any).data : {};
      const updatedAt = Number.isFinite(Number((parsed as any).updatedAt))
        ? Number((parsed as any).updatedAt)
        : Date.now();
      return { id, tick, updatedAt, data };
    } catch {
      return { id: worldId, tick: 0, updatedAt: Date.now(), data: {} };
    }
  }

  save(world: SimulationWorld) {
    const p = this.filePath(world.id);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(world, null, 2));
  }
}

