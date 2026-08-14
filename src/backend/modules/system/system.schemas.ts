import { z } from "zod";

export const architectureLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  responsibility: z.string(),
  status: z.enum(["ready", "scaffolded", "planned"]),
});

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  service: z.string(),
  apiVersion: z.string(),
  uptimeMs: z.number(),
});

export type ArchitectureLayer = z.infer<typeof architectureLayerSchema>;
export type Health = z.infer<typeof healthSchema>;
