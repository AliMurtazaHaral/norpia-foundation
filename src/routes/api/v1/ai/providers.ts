import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "@/backend/core/http";
import { getActiveProviderId } from "@/backend/ai/provider/provider-config";
import { listProviders } from "@/backend/ai/provider/provider-registry";

/**
 * Provider configuration view. Only ids, labels, models and availability —
 * never credentials.
 */
export const Route = createFileRoute("/api/v1/ai/providers")({
  server: {
    handlers: {
      GET: apiRoute(() => ({
        active: getActiveProviderId(),
        providers: listProviders(),
      })),
    },
  },
});
