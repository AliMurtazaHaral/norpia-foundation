/**
 * Backend Layer — event service. Thin façade over the event bus so callers
 * (API routes, other services) never depend on the bus implementation.
 */

import { z } from "zod";

import { getEventBus } from "../../events/event-bus";
import { EVENT_CATALOGUE, type DomainEventName } from "../../events/event-types";

export const publishEventSchema = z.object({
  name: z.enum(EVENT_CATALOGUE as [DomainEventName, ...DomainEventName[]]),
  payload: z.record(z.unknown()).default({}),
});

export type PublishEventInput = z.infer<typeof publishEventSchema>;

export const eventsService = {
  catalogue() {
    return EVENT_CATALOGUE;
  },

  recent(limit = 20) {
    return getEventBus().recent(limit);
  },

  async publish(input: PublishEventInput, requestId: string) {
    return getEventBus().publish(
      input.name,
      input.payload as never,
      { requestId },
    );
  },
};
