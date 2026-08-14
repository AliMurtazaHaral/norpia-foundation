import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "@/backend/core/http";
import { listIntegrations } from "@/backend/integrations/integration-registry";

export const Route = createFileRoute("/api/v1/integrations")({
  server: {
    handlers: {
      GET: apiRoute(() => listIntegrations()),
    },
  },
});
