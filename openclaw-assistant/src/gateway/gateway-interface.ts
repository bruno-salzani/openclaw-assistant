import type { GatewayMessage, GatewayResponse } from "./types.js";

export interface ICoreGateway {
  handleMessage(message: GatewayMessage): Promise<GatewayResponse>;
  runWorkflow(name: string, input: Record<string, unknown>): Promise<unknown>;
  getSession(sessionId: string): { userId: string; channel: string; lastSeen: number } | undefined;
}
