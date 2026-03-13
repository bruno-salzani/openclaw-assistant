import type { AgentDeps } from "../agents/agent-deps.js";
import type { AgentAccount, CivilizationId } from "./types.js";

export class CognitiveEconomy {
  private readonly accounts = new Map<string, AgentAccount>();

  constructor(private readonly deps: AgentDeps) {
    this.deps.metrics.createCounter("economy_trades_total", "Total economy trades");
  }

  upsertAccount(account: AgentAccount) {
    this.accounts.set(account.agentId, account);
  }

  getAccount(agentId: string): AgentAccount | undefined {
    return this.accounts.get(agentId);
  }

  ensureCivilizationTreasury(civ: CivilizationId) {
    const id = `treasury:${civ}`;
    if (this.accounts.has(id)) return;
    this.upsertAccount({
      agentId: id,
      civilization: civ,
      rank: "meta",
      reputation: 1,
      trust: 1,
      credits: 1_000_000,
      capacity: 1,
      capabilities: [],
    });
  }

  transfer(fromAgentId: string, toAgentId: string, credits: number) {
    const from = this.accounts.get(fromAgentId);
    const to = this.accounts.get(toAgentId);
    if (!from) throw new Error(`Unknown payer: ${fromAgentId}`);
    if (!to) throw new Error(`Unknown payee: ${toAgentId}`);
    if (credits <= 0) throw new Error("Invalid credit amount");
    if (from.credits < credits) throw new Error("Insufficient credits");
    from.credits -= credits;
    to.credits += credits;
    this.deps.metrics.counter("economy_trades_total").inc();
  }

  reward(agentId: string, deltaReputation: number, deltaTrust: number, deltaCredits: number) {
    const a = this.accounts.get(agentId);
    if (!a) return;
    a.reputation = this.clamp01(a.reputation + deltaReputation);
    a.trust = this.clamp01(a.trust + deltaTrust);
    a.credits = Math.max(0, a.credits + deltaCredits);
  }

  private clamp01(v: number) {
    if (Number.isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }
}
