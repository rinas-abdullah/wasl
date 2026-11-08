import { randomUUID } from "node:crypto";
import type { EventSource, EventType } from "@wasl/shared";
import type { DbOrTx } from "../db/client";
import { schema } from "../db/client";
import type { Actor } from "../http/context";

export interface AuditInput {
  orgId: string;
  facilityId: string | null;
  eventType: EventType;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  actor?: Pick<Actor, "userId" | "name" | "role"> | null;
  source: EventSource;
  payload?: Record<string, unknown>;
  correlationId?: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  occurredAt?: Date;
}

export async function recordEvent(tx: DbOrTx, e: AuditInput) {
  const [row] = await tx
    .insert(schema.auditEvents)
    .values({
      orgId: e.orgId,
      facilityId: e.facilityId,
      eventType: e.eventType,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      entityLabel: e.entityLabel ?? null,
      actorId: e.actor?.userId ?? null,
      actorLabel: e.actor ? `${e.actor.name} (${e.actor.role})` : e.source,
      source: e.source,
      payload: e.payload ?? {},
      correlationId: e.correlationId ?? randomUUID(),
      previousState: e.previousState ?? null,
      newState: e.newState ?? null,
      occurredAt: e.occurredAt ?? new Date(),
    })
    .returning({ id: schema.auditEvents.id, seq: schema.auditEvents.seq });
  return row;
}
