import { z } from "zod";

import { defineTool } from "../tool-types";

/** Internal tool: current server time, optionally in an IANA time zone. */
export const systemTimeTool = defineTool({
  id: "system.time",
  name: "Current time",
  description: "Returns the current date and time, optionally in a given IANA time zone.",
  category: "system",
  source: "internal",
  inputSchema: z
    .object({ timeZone: z.string().min(1).max(64).optional() })
    .strict(),
  outputSchema: z.object({ iso: z.string(), timeZone: z.string(), formatted: z.string() }),
  permissions: ["system:read"],
  auth: { kind: "user-session" },
  enabled: true,
  timeoutMs: 2_000,
  metadata: { readOnly: true },
  async handler({ timeZone }) {
    const tz = timeZone ?? "UTC";
    const now = new Date();
    let formatted: string;
    try {
      formatted = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: tz,
      }).format(now);
    } catch {
      throw new Error("Unknown time zone");
    }
    return { iso: now.toISOString(), timeZone: tz, formatted };
  },
});
