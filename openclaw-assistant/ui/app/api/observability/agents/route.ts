import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const gatewayUrl = process.env.GATEWAY_URL || "http://localhost:18789";
    const token = process.env.GATEWAY_TOKEN;

    const limit = u.searchParams.get("limit");
    const agent = u.searchParams.get("agent");
    const sessionId = u.searchParams.get("sessionId");
    const traceId = u.searchParams.get("traceId");
    const stats = u.searchParams.get("stats");

    const qs = new URLSearchParams();
    if (limit) qs.set("limit", limit);
    if (agent) qs.set("agent", agent);
    if (sessionId) qs.set("sessionId", sessionId);
    if (traceId) qs.set("traceId", traceId);

    const path = stats === "1" ? "/v1/observability/agents/stats" : "/v1/observability/agents";
    const url = `${gatewayUrl}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      return NextResponse.json(
        { error: `Gateway error (${res.status})`, raw: data },
        { status: 502 }
      );
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Unhandled server error" }, { status: 500 });
  }
}

