export type EventPayload = Record<string, unknown>;

export type EventEnvelope = {
  event_id: string;
  type: string;
  timestamp: string;
  source: string;
  payload: EventPayload;
};

export type EventSource =
  | "email"
  | "github"
  | "calendar"
  | "database"
  | "filesystem"
  | "webhook"
  | "cron"
  | "user";
