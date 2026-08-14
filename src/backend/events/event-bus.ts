/**
 * Event Layer — in-process publish/subscribe bus.
 *
 * Deliberately simple: no queues, no brokers. The `EventBus` interface is the
 * contract, so a Redis/PgQueue/Cloudflare Queue transport can be swapped in
 * later without touching publishers or subscribers.
 */

import type { DomainEvent, DomainEventMap, DomainEventName } from "./event-types";

export type EventHandler<N extends DomainEventName> = (
  event: DomainEvent<N>,
) => void | Promise<void>;

export interface EventBus {
  publish<N extends DomainEventName>(
    name: N,
    payload: DomainEventMap[N],
    options?: { requestId?: string },
  ): Promise<DomainEvent<N>>;
  subscribe<N extends DomainEventName>(name: N, handler: EventHandler<N>): () => void;
  /** Bounded ring buffer of recent events — dev/observability only. */
  recent(limit?: number): DomainEvent[];
}

export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler<DomainEventName>>>();
  private log: DomainEvent[] = [];
  private readonly logLimit: number;

  constructor(logLimit = 100) {
    this.logLimit = logLimit;
  }

  subscribe<N extends DomainEventName>(name: N, handler: EventHandler<N>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as EventHandler<DomainEventName>);
    this.handlers.set(name, set);
    return () => set.delete(handler as EventHandler<DomainEventName>);
  }

  async publish<N extends DomainEventName>(
    name: N,
    payload: DomainEventMap[N],
    options: { requestId?: string } = {},
  ): Promise<DomainEvent<N>> {
    const event: DomainEvent<N> = {
      id: globalThis.crypto?.randomUUID?.() ?? `evt_${Date.now()}`,
      name,
      payload,
      occurredAt: new Date().toISOString(),
      requestId: options.requestId,
    };

    this.log.push(event as DomainEvent);
    if (this.log.length > this.logLimit) this.log.shift();

    const handlers = this.handlers.get(name);
    if (handlers) {
      await Promise.all(
        [...handlers].map(async (handler) => {
          try {
            await handler(event as DomainEvent<DomainEventName>);
          } catch (error) {
            // A failing subscriber must never break the publisher.
            console.error(`event handler failed for ${name}`, error);
          }
        }),
      );
    }
    return event;
  }

  recent(limit = 20): DomainEvent[] {
    return this.log.slice(-limit).reverse();
  }
}

let bus: EventBus | undefined;

export function getEventBus(): EventBus {
  if (!bus) bus = new InMemoryEventBus();
  return bus;
}
