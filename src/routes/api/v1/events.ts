import { createFileRoute } from "@tanstack/react-router";

import { apiRoute, parseJsonBody } from "@/backend/core/http";
import { eventsService, publishEventSchema } from "@/backend/modules/events/events.service";

export const Route = createFileRoute("/api/v1/events")({
  server: {
    handlers: {
      GET: apiRoute(() => ({
        catalogue: eventsService.catalogue(),
        recent: eventsService.recent(),
      })),
      POST: apiRoute(
        async (ctx) => {
          const input = await parseJsonBody(ctx, publishEventSchema);
          return eventsService.publish(input, ctx.requestId);
        },
        { status: 201 },
      ),
    },
  },
});
