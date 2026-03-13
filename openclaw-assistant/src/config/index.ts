import { z } from "zod";

const schema = z.object({
  OPENCLAW_REPO_PATH: z.string().optional(),
  OPENCLAW_X_SYNC_CRON: z.enum(["0", "1"]).default("0"),
});

export const config = schema.parse(process.env);
