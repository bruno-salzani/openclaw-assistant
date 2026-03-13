"use client";

import { useEffect, useMemo, useState } from "react";

type AgentStats = {
  agent: string;
  runs: number;
  ok: number;
  fail: number;
  avgLatencyMs: number;
  avgTokens: number;
  avgToolCalls: number;
  avgCostUsd: number;
};

function fmtMs(ms: number) {
  if (!Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtUsd(v: number) {
  if (!Number.isFinite(v)) return "-";
  if (v === 0) return "$0.0000";
  return `$${v.toFixed(4)}`;
}

export default function DebugDashboardPage() {
  const [rows, setRows] = useState<AgentStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<number>(10000);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setError(null);
        const res = await fetch(
          `/api/observability/agents?stats=1&limit=${encodeURIComponent(String(limit))}`,
          { method: "GET" }
        );
        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          if (!cancelled) setError(typeof data?.error === "string" ? data.error : "Erro ao carregar stats");
          return;
        }
        const list = Array.isArray(data?.stats) ? (data.stats as AgentStats[]) : Array.isArray(data) ? (data as AgentStats[]) : [];
        if (!cancelled) setRows(list);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? "Erro ao carregar stats"));
      }
    }
    load();
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [limit]);

  const sorted = useMemo(() => {
    return rows
      .slice()
      .sort((a, b) => Number(b.runs ?? 0) - Number(a.runs ?? 0))
      .slice(0, 50);
  }, [rows]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 bg-neutral-950 px-6 py-6 text-neutral-100">
      <header className="flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold">AI SRE Dashboard</h1>
          <div className="text-sm text-neutral-400">Métricas agregadas por agente (runs, latência, tokens, tools, custo)</div>
        </div>
        <div className="flex items-center gap-2">
          <a className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900" href="/debug">
            timeline
          </a>
          <a className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900" href="/debug/graph">
            graph
          </a>
          <label className="text-sm text-neutral-400">limit</label>
          <input
            className="w-28 rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value) || 10000)}
          />
        </div>
      </header>

      {error ? (
        <div className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <section className="rounded border border-neutral-800 bg-neutral-950">
        <div className="border-b border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-200">Agentes</div>
        <div className="overflow-auto">
          <div className="min-w-[900px]">
            <div className="grid grid-cols-12 gap-2 border-b border-neutral-900 px-4 py-2 text-xs text-neutral-500">
              <div className="col-span-2">agent</div>
              <div className="col-span-1">runs</div>
              <div className="col-span-1">ok</div>
              <div className="col-span-1">fail</div>
              <div className="col-span-2">avg latency</div>
              <div className="col-span-2">avg tokens</div>
              <div className="col-span-2">avg tools</div>
              <div className="col-span-1">avg cost</div>
            </div>
            <div className="divide-y divide-neutral-900">
              {sorted.map((r) => (
                <div key={r.agent} className="grid grid-cols-12 gap-2 px-4 py-2 text-xs">
                  <div className="col-span-2 font-medium text-neutral-100">{r.agent}</div>
                  <div className="col-span-1 text-neutral-300">{r.runs}</div>
                  <div className="col-span-1 text-emerald-400">{r.ok}</div>
                  <div className="col-span-1 text-red-400">{r.fail}</div>
                  <div className="col-span-2 text-neutral-300">{fmtMs(r.avgLatencyMs)}</div>
                  <div className="col-span-2 text-neutral-300">{Number(r.avgTokens ?? 0).toFixed(0)}</div>
                  <div className="col-span-2 text-neutral-300">{Number(r.avgToolCalls ?? 0).toFixed(1)}</div>
                  <div className="col-span-1 text-neutral-300">{fmtUsd(r.avgCostUsd)}</div>
                </div>
              ))}
              {sorted.length === 0 ? (
                <div className="px-4 py-4 text-sm text-neutral-400">Sem dados ainda.</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

