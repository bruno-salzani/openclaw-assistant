/*
 * IA Assistant (UI)
 * Copyright (c) 2026 Bruno Salzani
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isChatRequest } from "../../../lib/chat-types";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (!isChatRequest(body)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const text = body.text.trim();
    if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });
    if (text.length > 50_000)
      return NextResponse.json({ error: "Message too large" }, { status: 413 });

    const gatewayUrl = process.env.GATEWAY_URL || "http://localhost:18789";
    const token = process.env.GATEWAY_TOKEN;
    const sessionId = (body.sessionId ? body.sessionId.trim() : "") || `web-${randomUUID()}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    const res = await fetch(`${gatewayUrl}/v1/agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        text,
        channel: "web",
        userId: "user-web",
        sessionId: sessionId.slice(0, 200),
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      return NextResponse.json({ error: `Gateway error (${res.status})` }, { status: 502 });
    }

    const data = (await res.json().catch(() => null)) as unknown;
    const reply =
      data && typeof data === "object" && typeof (data as any).text === "string"
        ? String((data as any).text)
        : JSON.stringify(data);
    return NextResponse.json({ text: reply, raw: data });
  } catch (err) {
    const name = err && typeof err === "object" ? String((err as any).name ?? "") : "";
    if (name === "AbortError")
      return NextResponse.json({ error: "Gateway timeout" }, { status: 504 });
    return NextResponse.json({ error: "Unhandled server error" }, { status: 500 });
  }
}
