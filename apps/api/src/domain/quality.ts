import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { evaluateQualityAction, type QualityAction, type QualityStatus } from "@wasl/shared";
import { db, schema, type Tx } from "../db/client";
import type { Actor } from "../http/context";
import { conflict, forbidden, notFound, unprocessable } from "../http/errors";
import { recordEvent } from "./audit";
import { notify, ROLE_GROUPS } from "./notify";
import { revokeReleases } from "./operations";
import { evaluateAndRecord } from "./readiness/service";
import { bumpState, withTx } from "./tx";

const Q = schema.qualityReviews;
const OPEN: QualityStatus[] = ["REVIEW_REQUIRED", "UNDER_REVIEW", "ESCALATED", "HOLD"];

/**
 * Opens (or extends) the quality review of a shipment and propagates the
 * requirement into operations: shipment quality status, inspection flag, and
 * revocation of any release whose readiness assumptions no longer hold.
 */
export async function openQualityRequirement(
  tx: Tx,
  actor: Actor,
  input: { shipmentId: string; trigger: string; sensorEventIds?: string[]; violations?: unknown[]; missingData?: boolean; notes?: string | null; correlationId: string },
) {
  const [shipment] = await tx.select().from(schema.shipments).where(and(eq(schema.shipments.id, input.shipmentId), eq(schema.shipments.facilityId, actor.facilityId))).for("update");
  if (!shipment) throw notFound("Shipment");
  const [truck] = await tx.select().from(schema.trucks).where(eq(schema.trucks.shipmentId, shipment.id));
  const [open] = await tx.select().from(Q).where(and(eq(Q.shipmentId, shipment.id), inArray(Q.status, OPEN)));
  const now = new Date();
  let review;
  if (open) {
    [review] = await tx
      .update(Q)
      .set({
        sensorEventIds: [...open.sensorEventIds, ...(input.sensorEventIds ?? [])],
        violations: [...open.violations, ...(input.violations ?? [])],
        missingData: open.missingData || !!input.missingData,
        history: [...open.history, { at: now.toISOString(), actor: actor.name, from: open.status, to: open.status, notes: `Additional trigger: ${input.trigger}` }],
        version: open.version + 1,
        updatedAt: now,
      })
      .where(eq(Q.id, open.id))
      .returning();
  } else {
    [review] = await tx
      .insert(Q)
      .values({
        facilityId: actor.facilityId,
        shipmentId: shipment.id,
        truckId: truck?.id ?? null,
        status: "REVIEW_REQUIRED",
        trigger: input.trigger,
        sensorEventIds: input.sensorEventIds ?? [],
        violations: input.violations ?? [],
        missingData: !!input.missingData,
        notes: input.notes ?? null,
        history: [{ at: now.toISOString(), actor: actor.name, from: null, to: "REVIEW_REQUIRED", notes: input.notes ?? input.trigger }],
      })
      .returning();
  }
  const newShipmentStatus: QualityStatus = open ? (shipment.qualityStatus as QualityStatus) : "REVIEW_REQUIRED";
  await tx.update(schema.shipments).set({ qualityStatus: newShipmentStatus, inspectionRequired: true, updatedAt: now }).where(eq(schema.shipments.id, shipment.id));

  let revoked: string[] = [];
  if (truck && ["CALLED", "ARRIVED"].includes(truck.status)) {
    const changed = await revokeReleases(tx, actor, [truck.id], `Quality requirement raised (${input.trigger}) after release — readiness must be re-evaluated`, input.correlationId);
    revoked = changed.map((t) => t.code);
    // quality (not dock) is the issue: clear the reassignment flag set by revokeReleases
    await tx.update(schema.trucks).set({ reassignmentRequired: false }).where(eq(schema.trucks.id, truck.id));
  }
  await recordEvent(tx, {
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    eventType: "QUALITY_ALERT_CREATED",
    entityType: "shipment",
    entityId: shipment.id,
    entityLabel: shipment.reference,
    actor,
    source: input.trigger === "SENSOR_EVENT" ? "SENSOR_ENGINE" : "USER",
    payload: { reviewId: review.id, trigger: input.trigger, sensorEventIds: input.sensorEventIds ?? [], truckId: truck?.id ?? null, revokedReleases: revoked },
    previousState: { qualityStatus: shipment.qualityStatus, inspectionRequired: shipment.inspectionRequired },
    newState: { qualityStatus: newShipmentStatus, inspectionRequired: true },
    correlationId: input.correlationId,
  });
  await notify(tx, {
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    type: "QUALITY_REVIEW_REQUIRED",
    severity: "HIGH",
    title: `Quality review required: ${shipment.reference}${truck ? ` (${truck.code})` : ""}`,
    titleAr: `مطلوب مراجعة جودة: ${shipment.reference}${truck ? ` (${truck.code})` : ""}`,
    body: `Trigger: ${input.trigger}.${revoked.length ? ` Release revoked for ${revoked.join(", ")}.` : ""} Readiness now requires the review to be started by a quality officer.`,
    bodyAr: `السبب: ${input.trigger}.${revoked.length ? ` أُلغي استدعاء ${revoked.join("، ")}.` : ""} تتطلب الجاهزية الآن بدء المراجعة من مسؤول الجودة.`,
    roles: ROLE_GROUPS.quality,
    entityType: "quality_review",
    entityId: review.id,
    actionRequired: true,
  });
  await bumpState(tx, actor.facilityId);
  return { review, truckId: truck?.id ?? null, revoked };
}

export async function createManualReview(actor: Actor, shipmentId: string, notes: string) {
  return withTx(async ({ tx, live, after }) => {
    const res = await openQualityRequirement(tx, actor, { shipmentId, trigger: "MANUAL", notes, correlationId: crypto.randomUUID() });
    live({ facilityId: actor.facilityId, topics: ["quality", "trucks", "readiness", "notifications", "events", "twin", "dashboard"], entityType: "shipment", entityId: shipmentId });
    if (res.truckId) after(() => evaluateAndRecord(actor, res.truckId!).then(() => undefined));
    return res.review;
  });
}

export async function listReviews(actor: Actor, status?: string) {
  const rows = await db
    .select({ review: Q, shipment: schema.shipments, truck: { id: schema.trucks.id, code: schema.trucks.code, status: schema.trucks.status }, inspector: { id: schema.users.id, name: schema.users.name } })
    .from(Q)
    .innerJoin(schema.shipments, eq(schema.shipments.id, Q.shipmentId))
    .leftJoin(schema.trucks, eq(schema.trucks.id, Q.truckId))
    .leftJoin(schema.users, eq(schema.users.id, Q.assignedInspectorId))
    .where(and(eq(Q.facilityId, actor.facilityId), status ? eq(Q.status, status as QualityStatus) : undefined))
    .orderBy(desc(Q.updatedAt));
  return rows.map((r) => ({ ...r.review, shipment: r.shipment, truck: r.truck?.id ? r.truck : null, inspector: r.inspector?.id ? r.inspector : null }));
}

export async function getReview(actor: Actor, id: string) {
  const [row] = await db
    .select({ review: Q, shipment: schema.shipments })
    .from(Q)
    .innerJoin(schema.shipments, eq(schema.shipments.id, Q.shipmentId))
    .where(and(eq(Q.id, id), eq(Q.facilityId, actor.facilityId)));
  if (!row) throw notFound("Quality review");
  const [truck] = row.review.truckId ? await db.select().from(schema.trucks).where(eq(schema.trucks.id, row.review.truckId)) : [null];
  const events = row.review.sensorEventIds.length ? await db.select().from(schema.sensorEvents).where(inArray(schema.sensorEvents.id, row.review.sensorEventIds)) : [];
  const audit = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityType, "quality_review"), eq(schema.auditEvents.entityId, id))).orderBy(desc(schema.auditEvents.occurredAt));
  return { ...row.review, shipment: row.shipment, truck, sensorEvents: events, audit };
}

export async function actOnReview(actor: Actor, id: string, input: { action: QualityAction; version: number; notes?: string | null }) {
  return withTx(async ({ tx, live, after }) => {
    const [review] = await tx.select().from(Q).where(and(eq(Q.id, id), eq(Q.facilityId, actor.facilityId))).for("update");
    if (!review) throw notFound("Quality review");
    if (review.version !== input.version) throw conflict("STALE_VERSION", "Review was modified by someone else. Reload and retry.", { currentVersion: review.version });
    const res = evaluateQualityAction(review.status as QualityStatus, input.action, actor.role, input.notes);
    if (!res.ok) {
      if (res.code === "FORBIDDEN") throw forbidden(res.message);
      throw unprocessable(res.code, res.message);
    }
    const now = new Date();
    const patch: Partial<typeof Q.$inferInsert> = {
      status: res.to,
      version: review.version + 1,
      updatedAt: now,
      history: [...review.history, { at: now.toISOString(), actor: `${actor.name} (${actor.role})`, from: review.status, to: res.to, notes: input.notes ?? null }],
    };
    if (input.action === "START_REVIEW") patch.assignedInspectorId = actor.userId;
    if (["RELEASE", "ESCALATE", "PLACE_HOLD"].includes(input.action)) {
      patch.decision = input.action;
      patch.notes = input.notes ?? null;
      patch.decidedBy = actor.userId;
      patch.decidedAt = now;
    }
    const [updated] = await tx.update(Q).set(patch).where(eq(Q.id, id)).returning();
    const [shipment] = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, review.shipmentId));
    await tx
      .update(schema.shipments)
      .set({ qualityStatus: res.to, ...(res.to === "RELEASED_BY_AUTHORIZED_USER" && shipment.cargoType !== "PHARMA" ? { inspectionRequired: false } : {}), updatedAt: now })
      .where(eq(schema.shipments.id, review.shipmentId));
    if (res.to === "RELEASED_BY_AUTHORIZED_USER" || res.to === "UNDER_REVIEW") {
      await tx.update(schema.notifications).set({ resolvedAt: now }).where(and(eq(schema.notifications.entityId, id), eq(schema.notifications.type, "QUALITY_REVIEW_REQUIRED")));
    }
    await recordEvent(tx, {
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      eventType: "QUALITY_REVIEW_UPDATED",
      entityType: "quality_review",
      entityId: id,
      entityLabel: shipment.reference,
      actor,
      source: "USER",
      payload: { action: input.action, notes: input.notes ?? null, shipmentId: shipment.id },
      previousState: { status: review.status },
      newState: { status: res.to },
    });
    await bumpState(tx, actor.facilityId);
    live({ facilityId: actor.facilityId, topics: ["quality", "trucks", "readiness", "twin", "notifications", "events", "dashboard"], entityType: "quality_review", entityId: id });
    if (review.truckId) {
      const truckId = review.truckId;
      after(async () => {
        const [t] = await db.select({ status: schema.trucks.status }).from(schema.trucks).where(eq(schema.trucks.id, truckId));
        if (t && ["SCHEDULED", "WAITING"].includes(t.status)) await evaluateAndRecord(actor, truckId);
      });
    }
    return updated;
  });
}

export async function qualityStats(facilityId: string) {
  const rows = await db.select({ status: Q.status, n: sql<number>`count(*)::int` }).from(Q).where(eq(Q.facilityId, facilityId)).groupBy(Q.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
