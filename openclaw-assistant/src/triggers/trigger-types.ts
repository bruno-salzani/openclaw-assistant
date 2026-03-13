export type ConditionOperator = "equals" | "contains" | "starts_with" | "ends_with" | "exists";

export type TriggerCondition = {
  field: string;
  operator: ConditionOperator;
  value?: string;
};

export type TriggerSpec = {
  trigger_id: string;
  event_type?: string;
  conditions?: TriggerCondition[];
  workflow: string;
  schedule?: { everyMs?: number; cron?: string };
  dedupe?: { windowMs?: number; keyFields?: string[] };
};
