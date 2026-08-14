import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "@/backend/core/http";
import { systemService } from "@/backend/modules/system/system.service";

export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: {
      GET: apiRoute(() => systemService.health()),
    },
  },
});
