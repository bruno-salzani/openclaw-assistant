export type InputModality = "text" | "voice" | "image" | "action";

export type GatewayUserRole = "user" | "admin" | "service";

export type GatewayMessage = {
  sessionId: string;
  userId: string;
  channel: string;
  userRole?: GatewayUserRole;
  modality: InputModality;
  text?: string;
  audio?: Buffer;
  image?: Buffer;
  metadata?: Record<string, unknown>;
};

export type GatewayResponse = {
  sessionId: string;
  text?: string;
  audio?: Buffer;
  ui?: Record<string, unknown>; // For dashboard rendering
  meta?: Record<string, unknown>;
};
