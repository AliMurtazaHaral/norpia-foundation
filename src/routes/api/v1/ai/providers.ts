import { createFileRoute } from "@tanstack/react-router";

import { listAiProviders } from "@/backend/ai/ai-registry";
import { apiRoute } from "@/backend/core/http";

export const Route = createFileRoute("/api/v1/ai/providers")({
  server: {
    handlers: {
      GET: apiRoute(() => listAiProviders()),
    },
  },
});
