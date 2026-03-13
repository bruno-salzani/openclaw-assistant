export type OpenClawTaskStatus = "pending" | "running" | "completed" | "failed";

export type OpenClawTaskRecord = {
  id: string;
  agentName: string;
  context: any;
  status: OpenClawTaskStatus;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  output?: any;
  error?: string;
};

export class TaskStore {
  private readonly tasks = new Map<string, OpenClawTaskRecord>();

  save(task: OpenClawTaskRecord) {
    this.tasks.set(task.id, task);
  }

  get(id: string) {
    return this.tasks.get(id);
  }

  update(id: string, patch: Partial<OpenClawTaskRecord>) {
    const cur = this.tasks.get(id);
    if (!cur) return;
    const next: OpenClawTaskRecord = {
      ...cur,
      ...patch,
      id: cur.id,
      createdAt: cur.createdAt,
      updatedAt: Date.now(),
    };
    this.tasks.set(id, next);
  }

  list(limit = 100) {
    const all = Array.from(this.tasks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    return all.slice(0, Math.max(0, Math.min(1000, limit)));
  }
}
