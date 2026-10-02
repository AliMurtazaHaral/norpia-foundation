import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "@/backend/core/http";
import { getActiveProviderId } from "@/backend/ai/provider/provider-config";
import { listProviders } from "@/backend/ai/provider/provider-registry";
import { getOrchestrationConfig } from "@/backend/ai/orchestration/routing-config";

/**
 * Provider configuration view. Only ids, labels, models and availability —
 * never credentials.
 */
export const Route = createFileRoute("/api/v1/ai/providers")({
  server: {
    handlers: {
      GET: apiRoute(() => {
        const config = getOrchestrationConfig();
        return {
          active: getActiveProviderId(),
          providers: listProviders(),
          // Routing rules only — no credentials, no user data.
          routing: {
            taskProviders: config.taskProviders,
            fallback: { enabled: config.fallback.enabled, provider: config.fallback.provider ?? null },
            dualProviderComparison: config.dualProviderComparison,
          },
        };
      }),
    },
  },
});
