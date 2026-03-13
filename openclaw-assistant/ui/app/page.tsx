/*
 * IA Assistant (UI)
 * Copyright (c) 2026 Bruno Salzani
 */

"use client";

import { ChatHeader } from "./components/ChatHeader";
import { MessageComposer } from "./components/MessageComposer";
import { MessageList } from "./components/MessageList";
import { useChat } from "./hooks/useChat";

export default function Home() {
  const chat = useChat();

  return (
    <main className="mx-auto flex h-screen max-w-6xl flex-col bg-neutral-950 px-6 py-6 text-neutral-100">
      <ChatHeader connected={chat.connected} />
      <MessageList messages={chat.messages} loading={chat.loading} />
      <MessageComposer disabled={!chat.canSend} onSend={chat.send} />
    </main>
  );
}
