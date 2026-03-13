"use client";

import { useEffect, useMemo, useState } from "react";

type AgentObsEvent = {
  agent: string;
  sessionId: string;
  traceId?: string;
  ts?: number;
  latencyMs: number;
  toolCalls: number;
  tokens: { prompt: number; completion: number; total: number };
  costUsd: number;
  ok: boolean;
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

function byTs(a: AgentObsEvent, b: AgentObsEvent) {
  const ta = typeof a.ts === "number" ? a.ts : 0;
  const tb = typeof b.ts === "number" ? b.ts : 0;
  return ta - tb;
}

function uniq<T>(xs: T[]) {
  return Array.from(new Set(xs));
}

export default function DebugPage() {
  const [events, setEvents] = useState<AgentObsEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string>("");
  const [limit, setLimit] = useState<number>(200);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setError(null);
        const res = await fetch(`/api/observability/agents?limit=${encodeURIComponent(String(limit))}`, {
          method: "GET",
        });
        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          if (!cancelled) setError(typeof data?.error === "string" ? data.error : "Erro ao carregar observability");
          return;
        }
        const list = Array.isArray(data?.events) ? (data.events as AgentObsEvent[]) : [];
        if (!cancelled) setEvents(list);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? "Erro ao carregar observability"));
      }
    }

    load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [limit]);

  const traces = useMemo(() => {
    const withTrace = events.filter((e) => typeof e.traceId === "string" && e.traceId);
    const ids = uniq(withTrace.map((e) => String(e.traceId)));
    const rows = ids
      .map((traceId) => {
        const evts = withTrace.filter((e) => e.traceId === traceId).slice().sort(byTs);
        const totalLatencyMs = evts.reduce((a, e) => a + (Number(e.latencyMs) || 0), 0);
        const totalTokens = evts.reduce((a, e) => a + (Number(e.tokens?.total) || 0), 0);
        const totalToolCalls = evts.reduce((a, e) => a + (Number(e.toolCalls) || 0), 0);
        const totalCost = evts.reduce((a, e) => a + (Number(e.costUsd) || 0), 0);
        const ok = evts.every((e) => e.ok);
        const agents = uniq(evts.map((e) => e.agent));
        const lastTs = evts.length > 0 ? Number(evts[evts.length - 1]?.ts ?? 0) : 0;
        return { traceId, agents, ok, totalLatencyMs, totalTokens, totalToolCalls, totalCost, lastTs };
      })
      .sort((a, b) => b.lastTs - a.lastTs);
    return rows;
  }, [events]);

  useEffect(() => {
    if (selectedTraceId) return;
    if (traces.length === 0) return;
    setSelectedTraceId(traces[0]!.traceId);
  }, [selectedTraceId, traces]);

  const selected = useMemo(() => {
    const id = selectedTraceId.trim();
    if (!id) return null;
    const evts = events.filter((e) => e.traceId === id).slice().sort(byTs);
    if (evts.length === 0) return null;
    const totalLatencyMs = evts.reduce((a, e) => a + (Number(e.latencyMs) || 0), 0);
    const totalTokens = evts.reduce((a, e) => a + (Number(e.tokens?.total) || 0), 0);
    const totalToolCalls = evts.reduce((a, e) => a + (Number(e.toolCalls) || 0), 0);
    const totalCost = evts.reduce((a, e) => a + (Number(e.costUsd) || 0), 0);
    return { traceId: id, events: evts, totalLatencyMs, totalTokens, totalToolCalls, totalCost };
  }, [events, selectedTraceId]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 bg-neutral-950 px-6 py-6 text-neutral-100">
      <header className="flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold">Visual AI Debugger</h1>
          <div className="text-sm text-neutral-400">
            Timeline por traceId (coordinator → planner → research → executor → reviewer)
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900" href="/debug/graph">
            graph
          </a>
          <a className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-900" href="/debug/dashboard">
            dashboard
          </a>
          <label className="text-sm text-neutral-400">limit</label>
          <input
            className="w-24 rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value) || 200)}
          />
        </div>
      </header>

      {error ? (
        <div className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded border border-neutral-800 bg-neutral-950">
          <div className="border-b border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-200">
            Traces recentes
          </div>
          <div className="max-h-[70vh] overflow-auto">
            {traces.length === 0 ? (
              <div className="px-4 py-4 text-sm text-neutral-400">Nenhum evento ainda.</div>
            ) : (
              <ul className="divide-y divide-neutral-900">
                {traces.slice(0, 200).map((t) => {
                  const active = t.traceId === selectedTraceId;
                  return (
                    <li
                      key={t.traceId}
                      className={`cursor-pointer px-4 py-3 ${active ? "bg-neutral-900" : "hover:bg-neutral-950/60"}`}
                      onClick={() => setSelectedTraceId(t.traceId)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="truncate text-sm font-medium">{t.traceId}</div>
                        <div className={`text-xs ${t.ok ? "text-emerald-400" : "text-red-400"}`}>
                          {t.ok ? "ok" : "fail"}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-400">
                        <span>{fmtMs(t.totalLatencyMs)}</span>
                        <span>tokens {t.totalTokens}</span>
                        <span>tools {t.totalToolCalls}</span>
                        <span>{fmtUsd(t.totalCost)}</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-neutral-500">{t.agents.join(" → ")}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <section className="rounded border border-neutral-800 bg-neutral-950">
          <div className="border-b border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-200">
            Execução
          </div>
          {!selected ? (
            <div className="px-4 py-4 text-sm text-neutral-400">Selecione um trace.</div>
          ) : (
            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300">
                <span className="text-neutral-500">traceId</span>
                <span className="font-mono">{selected.traceId}</span>
                <span className="text-neutral-500">latência</span>
                <span>{fmtMs(selected.totalLatencyMs)}</span>
                <span className="text-neutral-500">tokens</span>
                <span>{selected.totalTokens}</span>
                <span className="text-neutral-500">tools</span>
                <span>{selected.totalToolCalls}</span>
                <span className="text-neutral-500">custo</span>
                <span>{fmtUsd(selected.totalCost)}</span>
                <span className="text-neutral-500">memória</span>
                <span>—</span>
              </div>

              <div className="rounded border border-neutral-900">
                <div className="grid grid-cols-12 gap-2 border-b border-neutral-900 px-3 py-2 text-xs text-neutral-500">
                  <div className="col-span-4">etapa</div>
                  <div className="col-span-2">latência</div>
                  <div className="col-span-2">tokens</div>
                  <div className="col-span-2">tools</div>
                  <div className="col-span-2">ok</div>
                </div>
                <div className="divide-y divide-neutral-900">
                  {selected.events.map((e, idx) => (
                    <div key={`${e.agent}-${idx}`} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs">
                      <div className="col-span-4 truncate">
                        <span className="text-neutral-500">{idx === 0 ? "User Prompt → " : ""}</span>
                        <span className="font-medium text-neutral-100">{e.agent}</span>
                      </div>
                      <div className="col-span-2 text-neutral-300">{fmtMs(e.latencyMs)}</div>
                      <div className="col-span-2 text-neutral-300">{e.tokens?.total ?? 0}</div>
                      <div className="col-span-2 text-neutral-300">{e.toolCalls ?? 0}</div>
                      <div className={`col-span-2 ${e.ok ? "text-emerald-400" : "text-red-400"}`}>
                        {e.ok ? "ok" : "fail"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
