"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../lib/chat-types";
import { postChat } from "../../lib/chat-client";

function makeId() {
  const g = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === "function") return g.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(true);
  const [online, setOnline] = useState(true);
  const sessionIdRef = useRef<string>(`web-${makeId()}`);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const canSend = useMemo(() => online && !loading, [loading, online]);

  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (!navigator.onLine) {
      setOnline(false);
      setConnected(false);
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "system", content: "Você está offline. Verifique sua conexão." },
      ]);
      return;
    }

    setMessages((prev) => [...prev, { id: makeId(), role: "user", content: clean }]);
    setLoading(true);
    try {
      const res = await postChat(
        { text: clean, sessionId: sessionIdRef.current },
        { timeoutMs: 20_000 }
      );
      if (res.ok) {
        setConnected(true);
        setMessages((prev) => [...prev, { id: makeId(), role: "assistant", content: res.text }]);
      } else {
        setConnected(false);
        setMessages((prev) => [...prev, { id: makeId(), role: "system", content: res.error }]);
      }
    } catch (err) {
      setConnected(false);
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "system", content: `Erro inesperado: ${String(err)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  const effectiveConnected = connected && online;

  return {
    messages,
    loading,
    connected: effectiveConnected,
    canSend,
    send,
    clear,
    sessionId: sessionIdRef.current,
  };
}
