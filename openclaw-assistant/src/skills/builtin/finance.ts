import type { Skill } from "../skill-types.js";

export const financeSkill: Skill = {
  id: "finance",
  description: "Market data and portfolio analysis tools",
  commands: [
    {
      name: "get_market_data",
      input: { symbols: "string" },
      run: async (input: unknown) => {
        const symbols = String((input as any).symbols || "")
          .split(",")
          .map((s) => s.trim().toUpperCase());
        const data = symbols.map((s) => ({
          symbol: s,
          price: +(100 + Math.random() * 50).toFixed(2),
          change: +(Math.random() * 4 - 2).toFixed(2),
        }));
        return { ok: true, data };
      },
    },
    {
      name: "optimize_portfolio",
      input: { holdings: "string" },
      run: async (input: unknown) => {
        // holdings JSON: [{symbol, qty, price}]
        const holdings = JSON.parse(String((input as any).holdings || "[]")) as Array<{
          symbol: string;
          qty: number;
          price: number;
        }>;
        const suggestion = holdings.map((h) => ({
          symbol: h.symbol,
          targetWeight: +Math.random().toFixed(2),
        }));
        return { ok: true, suggestion };
      },
    },
  ],
};
