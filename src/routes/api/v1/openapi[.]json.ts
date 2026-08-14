import { createFileRoute } from "@tanstack/react-router";

import { openApiDocument } from "@/backend/api/openapi";

export const Route = createFileRoute("/api/v1/openapi.json")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(openApiDocument, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    },
  },
});
