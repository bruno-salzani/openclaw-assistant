import type { ClusterNodeInfo, ClusterNodeRole } from "./node-registry.js";
import type { TaskType } from "../tasks/task-types.js";

export type LoadBalancingStrategy = "least_busy" | "random";

function clamp(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export class LoadBalancer {
  constructor(private readonly params?: { strategy?: LoadBalancingStrategy }) {}

  pickNode(input: {
    nodes: ClusterNodeInfo[];
    role?: ClusterNodeRole;
    type?: TaskType;
  }): ClusterNodeInfo | null {
    let nodes = input.nodes;
    if (input.role) nodes = nodes.filter((n) => n.role === input.role);
    if (input.type) nodes = nodes.filter((n) => (n.types ?? []).includes(input.type!));
    if (nodes.length === 0) return null;

    const strategy = this.params?.strategy ?? "least_busy";
    if (strategy === "random") {
      const i = Math.floor(Math.random() * nodes.length);
      return nodes[i] ?? null;
    }

    const scored = nodes.map((n) => {
      const busy = Number.isFinite(n.busy) ? Number(n.busy) : 0;
      const capacity = Number.isFinite(n.capacity) ? Number(n.capacity) : 1;
      const utilization = capacity > 0 ? busy / capacity : busy;
      return { n, utilization, busy, capacity };
    });
    scored.sort((a, b) => a.utilization - b.utilization || a.busy - b.busy);
    const best = scored[0]?.n ?? null;
    if (!best) return null;

    const bestUtil = scored[0]!.utilization;
    const near = scored.filter((s) => Math.abs(s.utilization - bestUtil) <= 0.05);
    if (near.length <= 1) return best;
    const i = Math.floor(Math.random() * clamp(near.length, 1, 1000));
    return near[i]?.n ?? best;
  }
}

