import { SimulationWorldStore, type SimulationWorld } from "./world-store.js";

export type SimulationConfig = {
  failureRate?: number;
  seed?: number;
  worldId?: string;
  persistWorld?: boolean;
};

export class SimulationEnvironment {
  private state: number;

  private world: SimulationWorld;

  private store?: SimulationWorldStore;

  constructor(private readonly config: SimulationConfig = {}) {
    const seed = Number.isFinite(config.seed) ? Number(config.seed) : Date.now();
    this.state = seed >>> 0;
    const worldId = String(config.worldId ?? "").trim();
    const persist = Boolean(config.persistWorld);
    if (persist && worldId) {
      this.store = new SimulationWorldStore(process.cwd());
      this.world = this.store.load(worldId);
    } else {
      this.world = { id: worldId || "ephemeral", tick: 0, updatedAt: Date.now(), data: {} };
    }
  }

  random() {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 2 ** 32;
  }

  shouldFail() {
    const r = this.random();
    const p = Number(this.config.failureRate ?? 0);
    const rate = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
    return r < rate;
  }

  getWorld() {
    return this.world;
  }

  updateWorld(mut: (world: typeof this.world) => void) {
    mut(this.world);
    this.world.updatedAt = Date.now();
    if (this.store && this.config.persistWorld) this.store.save(this.world);
  }

  tick() {
    this.updateWorld((w) => {
      w.tick += 1;
    });
    return this.world.tick;
  }
}
