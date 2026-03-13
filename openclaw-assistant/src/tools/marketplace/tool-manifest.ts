import { z } from "zod";

export const toolManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  permissions: z.array(z.string().min(1)).default([]),
  rateLimit: z.number().int().positive().optional(),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  costUsdPerCall: z.number().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retry: z
    .object({
      max: z.number().int().nonnegative().optional(),
      backoffMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  entry: z.string().min(1).optional(),
});

export type ToolManifestJson = z.infer<typeof toolManifestSchema>;
