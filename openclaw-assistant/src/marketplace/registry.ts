export type MarketplaceItem =
  | {
      kind: "agent";
      name: string;
      description?: string;
      version?: string;
      entry?: string;
      permissions?: string[];
    }
  | {
      kind: "skill";
      name: string;
      description?: string;
      version?: string;
      entry?: string;
      permissions?: string[];
    }
  | {
      kind: "tool";
      name: string;
      description?: string;
      version?: string;
      entry?: string;
      permissions?: string[];
    };

export class Marketplace {
  agents: MarketplaceItem[] = [];

  skills: MarketplaceItem[] = [];

  tools: MarketplaceItem[] = [];

  add(item: MarketplaceItem) {
    if (item.kind === "agent") this.agents.push(item);
    if (item.kind === "skill") this.skills.push(item);
    if (item.kind === "tool") this.tools.push(item);
  }
}
