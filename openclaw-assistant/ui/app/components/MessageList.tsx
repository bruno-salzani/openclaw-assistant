"use client";

import type { ChatMessage } from "../../lib/chat-types";

function bubbleClasses(role: ChatMessage["role"]) {
  if (role === "user") return "bg-emerald-600 text-white";
  if (role === "system") return "bg-red-900/50 text-red-200";
  return "bg-neutral-800 text-neutral-200";
}

export function MessageList(params: { messages: ChatMessage[]; loading: boolean }) {
  const { messages, loading } = params;

  return (
    <section
      aria-label="Conversation"
      className="flex-1 overflow-y-auto py-6 space-y-4"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      tabIndex={0}
    >
      {messages.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center text-center text-neutral-500">
          <p className="text-lg">Ready to assist.</p>
          <p className="text-sm">
            Try &quot;Research about AI Agents&quot; or &quot;Create a plan to deploy&quot;
          </p>
        </div>
      )}

      <ul role="list" className="space-y-4">
        {messages.map((msg) => (
          <li
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <article
              aria-label={msg.role === "user" ? "Mensagem do usuário" : "Mensagem do assistente"}
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${bubbleClasses(msg.role)}`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
            </article>
          </li>
        ))}
      </ul>

      {loading && (
        <div className="flex justify-start">
          <div
            className="bg-neutral-800 rounded-lg px-4 py-2 text-sm text-neutral-400 animate-pulse"
            role="status"
            aria-label="Carregando resposta"
          >
            Thinking...
          </div>
        </div>
      )}
    </section>
  );
}
