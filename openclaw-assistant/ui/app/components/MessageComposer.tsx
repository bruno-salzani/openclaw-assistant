"use client";

import { useCallback, useState } from "react";

export function MessageComposer(params: {
  disabled: boolean;
  onSend: (text: string) => Promise<void> | void;
}) {
  const { disabled, onSend } = params;
  const [value, setValue] = useState("");

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text) return;
    setValue("");
    await onSend(text);
  }, [onSend, value]);

  return (
    <div className="border-t border-neutral-800 pt-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex gap-2"
      >
        <label className="sr-only" htmlFor="chat-input">
          Mensagem
        </label>
        <input
          id="chat-input"
          aria-label="Mensagem"
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          placeholder="Type your instruction..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button
          disabled={disabled}
          className="rounded-lg bg-emerald-600 px-6 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          type="submit"
          aria-label="Enviar"
        >
          Send
        </button>
      </form>
    </div>
  );
}
