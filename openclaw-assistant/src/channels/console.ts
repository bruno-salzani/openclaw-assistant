import type { ChannelAdapter, ChannelInboundMessage, ChannelOutboundMessage } from "./types.js";
import type { CoreGateway } from "../gateway/core-gateway.js";

export class ConsoleChannelAdapter implements ChannelAdapter {
  id = "console";

  constructor(private readonly gateway: CoreGateway) {}

  async ingest(msg: ChannelInboundMessage): Promise<ChannelOutboundMessage> {
    return (this.gateway as any).ingestChannelMessage({
      channel: this.id,
      sender: msg.sender,
      text: msg.text,
      metadata: msg.metadata,
    });
  }
}
