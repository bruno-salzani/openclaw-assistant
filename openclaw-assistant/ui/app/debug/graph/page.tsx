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

function uniq<T>(xs: T[]) {
  return Array.from(new Set(xs));
}

function byTs(a: AgentObsEvent, b: AgentObsEvent) {
  const ta = typeof a.ts === "number" ? a.ts : 0;
  const tb = typeof b.ts === "number" ? b.ts : 0;
  return ta - tb;
}

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

type Node = {
  id: string;
  label: string;
  latencyMs: number;
  tokens: number;
  toolCalls: number;
  costUsd: number;
  ok: boolean;
};

type Edge = { from: string; to: string };

function buildGraph(events: AgentObsEvent[]): { nodes: Node[]; edges: Edge[] } {
  const evts = events.slice().sort(byTs);
  const nodes: Node[] = evts.map((e, i) => ({
    id: `${e.agent}:${i}`,
    label: e.agent,
    latencyMs: Number(e.latencyMs ?? 0),
    tokens: Number(e.tokens?.total ?? 0),
    toolCalls: Number(e.toolCalls ?? 0),
    costUsd: Number(e.costUsd ?? 0),
    ok: Boolean(e.ok),
  }));
  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id });
  }
  return { nodes, edges };
}

export default function DebugGraphPage() {
  const [events, setEvents] = useState<AgentObsEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string>("");
  const [limit, setLimit] = useState<number>(500);

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
    return uniq(withTrace.map((e) => String(e.traceId)));
  }, [events]);

  useEffect(() => {
    if (selectedTraceId) return;
    if (traces.length === 0) return;
    setSelectedTraceId(traces[0]!);
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
    const ok = evts.every((e) => e.ok);
    return { traceId: id, events: evts, totalLatencyMs, totalTokens, totalToolCalls, totalCost, ok };
  }, [events, selectedTraceId]);

  const graph = useMemo(() => (selected ? buildGraph(selected.events) : null), [selected]);

  const svg = useMemo(() => {
    if (!graph) return null;
    const nodeW = 180;
    const nodeH = 70;
    const gapX = 40;
    const pad = 24;
    const width = pad * 2 + graph.nodes.length * nodeW + Math.max(0, graph.nodes.length - 1) * gapX;
    const height = pad * 2 + nodeH;

    const xOf = (idx: number) => pad + idx * (nodeW + gapX);
    const y = pad;

    return (
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="block">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(120,120,120)" />
          </marker>
        </defs>
        {graph.edges.map((e, i) => {
          const fromIdx = graph.nodes.findIndex((n) => n.id === e.from);
          const toIdx = graph.nodes.findIndex((n) => n.id === e.to);
          const x1 = xOf(fromIdx) + nodeW;
          const x2 = xOf(toIdx);
          const y1 = y + nodeH / 2;
          const y2 = y + nodeH / 2;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgb(120,120,120)" strokeWidth="2" markerEnd="url(#arrow)" />;
        })}
        {graph.nodes.map((n, idx) => {
          const x = xOf(idx);
          const stroke = n.ok ? "rgb(16,185,129)" : "rgb(248,113,113)";
          return (
            <g key={n.id} transform={`translate(${x},${y})`}>
              <rect width={nodeW} height={nodeH} rx={10} ry={10} fill="rgb(10,10,10)" stroke={stroke} strokeWidth={2} />
              <text x={12} y={22} fill="rgb(240,240,240)" fontSize="14" fontFamily="ui-sans-serif, system-ui" fontWeight={600}>
                {n.label}
              </text>
              <text x={12} y={42} fill="rgb(170,170,170)" fontSize="11" fontFamily="ui-sans-serif, system-ui">
                {fmtMs(n.latencyMs)} · tools {n.toolCalls} · tok {n.tokens}
              </text>
              <text x={12} y={58} fill="rgb(170,170,170)" fontSize="11" fontFamily="ui-sans-serif, system-ui">
                {fmtUsd(n.costUsd)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }, [graph]);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 bg-neutral-950 px-6 py-6 text-neutral-100">
      <header className="flex items-center justify-between">
        <div className="flex flex-col">
          <h1 className="text-xl font-semibold">Debug Graph</h1>
          <div className="text-sm text-neutral-400">Visualização do fluxo de agentes por traceId</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-neutral-400">limit</label>
          <input
            className="w-24 rounded bg-neutral-900 px-2 py-1 text-sm text-neutral-100"
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value) || 500)}
          />
        </div>
      </header>

      {error ? (
        <div className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      <section className="rounded border border-neutral-800 bg-neutral-950">
        <div className="border-b border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-200">Trace</div>
        <div className="flex flex-col gap-3 px-4 py-4">
          <select
            className="w-full rounded bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            value={selectedTraceId}
            onChange={(e) => setSelectedTraceId(e.target.value)}
          >
            {traces.slice(0, 500).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {!selected ? (
            <div className="text-sm text-neutral-400">Nenhum trace selecionado.</div>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-300">
              <span className="text-neutral-500">traceId</span>
              <span className="font-mono">{selected.traceId}</span>
              <span className="text-neutral-500">ok</span>
              <span className={selected.ok ? "text-emerald-400" : "text-red-400"}>{selected.ok ? "ok" : "fail"}</span>
              <span className="text-neutral-500">latência</span>
              <span>{fmtMs(selected.totalLatencyMs)}</span>
              <span className="text-neutral-500">tokens</span>
              <span>{selected.totalTokens}</span>
              <span className="text-neutral-500">tools</span>
              <span>{selected.totalToolCalls}</span>
              <span className="text-neutral-500">custo</span>
              <span>{fmtUsd(selected.totalCost)}</span>
            </div>
          )}
        </div>
      </section>

      <section className="rounded border border-neutral-800 bg-neutral-950">
        <div className="border-b border-neutral-800 px-4 py-3 text-sm font-medium text-neutral-200">Grafo</div>
        <div className="overflow-auto px-4 py-4">{svg ?? <div className="text-sm text-neutral-400">Sem dados.</div>}</div>
      </section>
    </main>
  );
}

