export type ChannelInboundMessage = {
  channel: string;
  sender: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type ChannelOutboundMessage = {
  ok: boolean;
  response?: unknown;
  pairing?: { code: string };
  error?: string;
};

export interface ChannelAdapter {
  id: string;
  ingest(msg: ChannelInboundMessage): Promise<ChannelOutboundMessage>;
}
