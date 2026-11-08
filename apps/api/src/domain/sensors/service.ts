import { and, asc, desc, eq } from "drizzle-orm";
import type { CargoType, SensorScenario } from "@wasl/shared";
import { db, schema } from "../../db/client";
import type { Actor } from "../../http/context";
import { notFound } from "../../http/errors";
import { recordEvent } from "../audit";
import { openQualityRequirement } from "../quality";
import { evaluateAndRecord } from "../readiness/service";
import { withTx } from "../tx";
import { detectEvents } from "./detect";
import { GENERATOR_VERSION, INTERVAL_SEC, generateSeries, resolveThresholds } from "./generator";

export async function generateScenario(actor: Actor, input: { shipmentId: string; scenario: SensorScenario; seed?: number; journeyMinutes: number }) {
  const seed = input.seed ?? Math.floor(Math.random() * 2_147_483_647);
  return withTx(async ({ tx, live, after }) => {
    const [shipment] = await tx.select().from(schema.shipments).where(and(eq(schema.shipments.id, input.shipmentId), eq(schema.shipments.facilityId, actor.facilityId)));
    if (!shipment) throw notFound("Shipment");
    const thresholds = resolveThresholds(shipment.cargoType as CargoType, shipment.requiredConditions);
    const end = new Date();
    const series = generateSeries(input.scenario, seed, end, input.journeyMinutes, thresholds);
    await tx.update(schema.sensorStreams).set({ isActive: false }).where(eq(schema.sensorStreams.shipmentId, shipment.id));
    const [stream] = await tx
      .insert(schema.sensorStreams)
      .values({ facilityId: actor.facilityId, shipmentId: shipment.id, scenario: input.scenario, seed, generatorVersion: GENERATOR_VERSION, intervalSec: INTERVAL_SEC, startAt: series.readings[0].ts, endAt: end, thresholds: thresholds as Record<string, number>, createdBy: actor.userId })
      .returning();
    for (let i = 0; i < series.readings.length; i += 500) {
      await tx.insert(schema.sensorReadings).values(series.readings.slice(i, i + 500).map((r) => ({ streamId: stream.id, ...r })));
    }
    const detected = detectEvents(series.readings, thresholds);
    const events = detected.length
      ? await tx
          .insert(schema.sensorEvents)
          .values(detected.map((e) => ({ streamId: stream.id, shipmentId: shipment.id, type: e.type, ruleId: e.ruleId, startedAt: e.startedAt, endedAt: e.endedAt, peakValue: e.peakValue, threshold: e.threshold, readingsCount: e.readingsCount, severity: e.severity, requiresReview: e.requiresReview })))
          .returning()
      : [];
    const correlationId = crypto.randomUUID();
    await recordEvent(tx, {
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      eventType: "SENSOR_SCENARIO_GENERATED",
      entityType: "shipment",
      entityId: shipment.id,
      entityLabel: shipment.reference,
      actor,
      source: "SENSOR_ENGINE",
      payload: { streamId: stream.id, scenario: input.scenario, seed, generatorVersion: GENERATOR_VERSION, readings: series.readings.length, detected: detected.map((d) => ({ type: d.type, ruleId: d.ruleId, severity: d.severity })) },
      correlationId,
    });
    let review = null;
    let truckId: string | null = null;
    const needsReview = events.filter((e) => e.requiresReview);
    if (needsReview.length) {
      const res = await openQualityRequirement(tx, actor, {
        shipmentId: shipment.id,
        trigger: "SENSOR_EVENT",
        sensorEventIds: needsReview.map((e) => e.id),
        violations: detected.map((d) => ({ type: d.type, ruleId: d.ruleId, severity: d.severity, description: d.description, descriptionAr: d.descriptionAr, peak: d.peakValue, threshold: d.threshold })),
        missingData: detected.some((d) => d.type === "MISSING_DATA"),
        correlationId,
      });
      review = res.review;
      truckId = res.truckId;
    }
    live({ facilityId: actor.facilityId, topics: ["sensors", "quality", "trucks", "readiness", "notifications", "events", "twin", "dashboard"], entityType: "shipment", entityId: shipment.id });
    if (truckId) after(() => evaluateAndRecord(actor, truckId!).then(() => undefined));
    return { stream, readingsCount: series.readings.length, events: detected, reviewId: review?.id ?? null, injected: series.injected, synthetic: true };
  });
}

export async function getStreams(actor: Actor, shipmentId: string) {
  const streams = await db
    .select()
    .from(schema.sensorStreams)
    .where(and(eq(schema.sensorStreams.shipmentId, shipmentId), eq(schema.sensorStreams.facilityId, actor.facilityId)))
    .orderBy(desc(schema.sensorStreams.createdAt))
    .limit(10);
  return streams;
}

export async function getStream(actor: Actor, streamId: string) {
  const [stream] = await db.select().from(schema.sensorStreams).where(and(eq(schema.sensorStreams.id, streamId), eq(schema.sensorStreams.facilityId, actor.facilityId)));
  if (!stream) throw notFound("Sensor stream");
  const [readings, events] = await Promise.all([
    db.select().from(schema.sensorReadings).where(eq(schema.sensorReadings.streamId, streamId)).orderBy(asc(schema.sensorReadings.ts)),
    db.select().from(schema.sensorEvents).where(eq(schema.sensorEvents.streamId, streamId)).orderBy(asc(schema.sensorEvents.startedAt)),
  ]);
  return { ...stream, readings, events, synthetic: true, label: "Synthetic virtual sensor data — not a physical device" };
}

export async function resetShipmentSensors(actor: Actor, shipmentId: string) {
  return withTx(async ({ tx, live }) => {
    const [shipment] = await tx.select().from(schema.shipments).where(and(eq(schema.shipments.id, shipmentId), eq(schema.shipments.facilityId, actor.facilityId)));
    if (!shipment) throw notFound("Shipment");
    await tx.update(schema.sensorStreams).set({ isActive: false }).where(eq(schema.sensorStreams.shipmentId, shipmentId));
    live({ facilityId: actor.facilityId, topics: ["sensors"], entityType: "shipment", entityId: shipmentId });
    // Quality reviews already opened are NOT reverted: they are part of the audit trail and must be closed by a quality officer.
    return { archived: true };
  });
}
