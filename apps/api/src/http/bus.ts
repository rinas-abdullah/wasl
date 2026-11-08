import { EventEmitter } from "node:events";

/**
 * In-process pub/sub used to push invalidation messages to connected SSE
 * clients after a transaction commits. A single API instance is assumed for the
 * prototype; for horizontal scaling replace with Postgres LISTEN/NOTIFY or Redis
 * pub/sub (documented in docs/ARCHITECTURE.md).
 */
export interface LiveMessage {
  facilityId: string;
  topics: string[];
  eventType?: string;
  entityType?: string;
  entityId?: string | null;
  at: string;
}

class Bus extends EventEmitter {
  publish(msg: Omit<LiveMessage, "at">) {
    this.emit("message", { ...msg, at: new Date().toISOString() } satisfies LiveMessage);
  }
}

export const bus = new Bus();
bus.setMaxListeners(1000);
