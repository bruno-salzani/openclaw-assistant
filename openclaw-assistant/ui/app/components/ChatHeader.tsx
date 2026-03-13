"use client";

export function ChatHeader(params: { connected: boolean }) {
  const { connected } = params;
  const label = connected ? "Gateway Connected" : "Gateway Offline";
  const color = connected ? "bg-emerald-500" : "bg-red-500";

  return (
    <header className="flex items-center justify-between border-b border-neutral-800 pb-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-emerald-400">IA Assistant</h1>
        <p className="text-xs text-neutral-500">Autonomous Multi-Agent System</p>
      </div>
      <div className="flex gap-2">
        <div
          className="flex items-center gap-2 rounded-full bg-neutral-900 px-3 py-1 text-xs"
          role="status"
          aria-label={label}
        >
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color} animate-pulse`} />
          {label}
        </div>
      </div>
    </header>
  );
}
