import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  evaluateTransition,
  addMinutes,
  type TruckAction,
  type TruckCreateInput,
  type TruckStatus,
} from "@wasl/shared";
import { z } from "zod";
import { truckListQuery, truckUpdateSchema } from "@wasl/shared";
import { db, schema, type DbOrTx, type Tx } from "../db/client";
import type { Actor } from "../http/context";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound, unprocessable } from "../http/errors";
import { recordEvent } from "./audit";
import { estimateServiceTime } from "./estimates";
import { bumpState, withTx } from "./tx";

const T = schema.trucks;

/** Row-level visibility for scoped roles (carrier operators and drivers). */
export function truckScope(actor: Actor): SQL | undefined {
  if (actor.role === "CARRIER_OPERATOR") return actor.carrierId ? eq(T.carrierId, actor.carrierId) : sql`false`;
  if (actor.role === "DRIVER") return actor.driverId ? eq(T.driverId, actor.driverId) : sql`false`;
  return undefined;
}

export async function getTruckRow(tx: DbOrTx, actor: Actor, id: string, lock = false) {
  const where = and(eq(T.id, id), eq(T.facilityId, actor.facilityId), isNull(T.deletedAt), truckScope(actor));
  const [row] = lock ? await tx.select().from(T).where(where).for("update") : await tx.select().from(T).where(where);
  if (!row) throw notFound("Truck");
  return row;
}

async function nextTruckCode(tx: Tx, facilityId: string) {
  const [r] = await tx
    .select({ max: sql<number>`coalesce(max((regexp_replace(code, '\\D', '', 'g'))::int), 1000)` })
    .from(T)
    .where(eq(T.facilityId, facilityId));
  return `WSL-${(r?.max ?? 1000) + 1}`;
}

export function truckStateView(t: typeof T.$inferSelect) {
  return { status: t.status, assignedDockId: t.assignedDockId, actualArrival: t.actualArrival?.toISOString() ?? null, reassignmentRequired: t.reassignmentRequired };
}

export async function createTruck(actor: Actor, input: TruckCreateInput) {
  if (actor.role === "CARRIER_OPERATOR" && input.carrierId !== actor.carrierId) throw forbidden("Carrier operators can only create trucks for their own carrier");
  const [carrier] = await db.select().from(schema.carriers).where(and(eq(schema.carriers.id, input.carrierId), eq(schema.carriers.orgId, actor.orgId)));
  if (!carrier) throw badRequest("INVALID_CARRIER", "Carrier does not belong to this organisation");
  if (input.driverId) {
    const [drv] = await db.select().from(schema.drivers).where(and(eq(schema.drivers.id, input.driverId), eq(schema.drivers.carrierId, input.carrierId)));
    if (!drv) throw badRequest("INVALID_DRIVER", "Driver does not belong to the selected carrier");
  }
  const inspectionRequired = input.shipment.inspectionRequired || input.shipment.cargoType === "PHARMA";
  const teamSize = (await db.select({ s: sql<number>`coalesce(round(avg(size)),4)::int` }).from(schema.workforceTeams).where(eq(schema.workforceTeams.facilityId, actor.facilityId)))[0]?.s ?? 4;
  const est = await estimateServiceTime({
    cargoType: input.shipment.cargoType,
    palletCount: input.shipment.palletCount,
    handlingMethod: input.shipment.handlingMethod,
    vehicleType: input.vehicleType,
    teamSize,
    dockHasLeveler: true,
    inspectionRequired: false,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTx(async ({ tx, live }) => {
        const code = await nextTruckCode(tx, actor.facilityId);
        const reference = input.shipment.reference ?? `SHP-${code.slice(4)}-${randomBytes(2).toString("hex").toUpperCase()}`;
        const [shipment] = await tx
          .insert(schema.shipments)
          .values({
            orgId: actor.orgId,
            facilityId: actor.facilityId,
            reference,
            cargoType: input.shipment.cargoType,
            palletCount: input.shipment.palletCount,
            weightKg: input.shipment.weightKg,
            handlingMethod: input.shipment.handlingMethod,
            documentsComplete: input.shipment.documentsComplete,
            inspectionRequired,
            requiredConditions: input.shipment.requiredConditions as Record<string, number>,
          })
          .returning();
        const [truck] = await tx
          .insert(T)
          .values({
            orgId: actor.orgId,
            facilityId: actor.facilityId,
            code,
            plateNumber: input.plateNumber,
            carrierId: input.carrierId,
            driverId: input.driverId ?? null,
            shipmentId: shipment.id,
            vehicleType: input.vehicleType,
            priority: input.priority,
            notes: input.notes ?? null,
            requestedArrival: new Date(input.requestedArrival),
            serviceEstimateMin: est.minutes,
            serviceEstimateLowMin: est.low,
            serviceEstimateHighMin: est.high,
            serviceEstimateSource: est.source,
          })
          .returning();
        await tx.insert(schema.appointments).values({
          facilityId: actor.facilityId,
          truckId: truck.id,
          status: "REQUESTED",
          requestedStart: truck.requestedArrival,
          durationMin: est.minutes,
          source: actor.role === "CARRIER_OPERATOR" ? "CARRIER_REQUEST" : "MANUAL",
        });
        await recordEvent(tx, {
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          eventType: "TRUCK_CREATED",
          entityType: "truck",
          entityId: truck.id,
          entityLabel: code,
          actor,
          source: "USER",
          payload: { shipmentId: shipment.id, cargoType: shipment.cargoType, pallets: shipment.palletCount, estimate: est },
          newState: truckStateView(truck),
        });
        await bumpState(tx, actor.facilityId);
        live({ facilityId: actor.facilityId, topics: ["trucks", "appointments", "dashboard", "twin", "events"], eventType: "TRUCK_CREATED", entityType: "truck", entityId: truck.id });
        return { ...truck, shipment };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  throw conflict("CODE_ALLOCATION_FAILED", "Could not allocate a truck code");
}

export async function updateTruck(actor: Actor, id: string, input: z.infer<typeof truckUpdateSchema>) {
  return withTx(async ({ tx, live }) => {
    const truck = await getTruckRow(tx, actor, id, true);
    if (truck.version !== input.version) throw conflict("STALE_VERSION", "Truck was modified by someone else. Reload and retry.", { currentVersion: truck.version });
    if (["DEPARTED", "CANCELLED", "NO_SHOW"].includes(truck.status)) throw unprocessable("TRUCK_CLOSED", "Closed trucks cannot be edited");
    const { shipment: sh, version: _v, ...fields } = input;
    const [updated] = await tx
      .update(T)
      .set({ ...fields, version: truck.version + 1, updatedAt: new Date() })
      .where(eq(T.id, id))
      .returning();
    if (sh && Object.keys(sh).length) {
      const { requiredConditions, ...rest } = sh;
      await tx
        .update(schema.shipments)
        .set({ ...rest, ...(requiredConditions ? { requiredConditions: requiredConditions as Record<string, number> } : {}), ...(rest.cargoType === "PHARMA" ? { inspectionRequired: true } : {}), updatedAt: new Date() })
        .where(eq(schema.shipments.id, truck.shipmentId));
    }
    await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "TRUCK_UPDATED", entityType: "truck", entityId: id, entityLabel: truck.code, actor, source: "USER", payload: { changed: Object.keys(fields), shipmentChanged: sh ? Object.keys(sh) : [] } });
    await bumpState(tx, actor.facilityId);
    live({ facilityId: actor.facilityId, topics: ["trucks", "readiness", "twin"], entityType: "truck", entityId: id });
    return updated;
  });
}

async function syncHandover(tx: Tx, actor: Actor | null, truckId: string, to: "ARRIVAL_CONFIRMED" | "UNLOADING" | "CLOSED", action: string) {
  const [ho] = await tx.select().from(schema.handoverRecords).where(eq(schema.handoverRecords.truckId, truckId));
  if (!ho) return;
  const order = ["PENDING_ARRIVAL", "ARRIVAL_CONFIRMED", "UNLOADING", "INSPECTION_RECORDED", "APPROVED", "CLOSED"];
  if (order.indexOf(ho.status) >= order.indexOf(to)) return;
  if (to === "CLOSED" && ho.status !== "APPROVED") return;
  await tx.update(schema.handoverRecords).set({ status: to, version: ho.version + 1, updatedAt: new Date() }).where(eq(schema.handoverRecords.id, ho.id));
  await tx
    .insert(schema.handoverActions)
    .values({ handoverId: ho.id, action, previousStatus: ho.status, newStatus: to, actorId: actor?.userId ?? null, idempotencyKey: `auto:${action}`, notes: "Recorded from truck lifecycle action" })
    .onConflictDoNothing();
}

/** Generic lifecycle transition (all actions except RELEASE / SCHEDULE which have dedicated workflows). */
export async function transitionTruck(actor: Actor, id: string, action: Exclude<TruckAction, "RELEASE" | "SCHEDULE">, opts: { version?: number; reason?: string | null; bulk?: boolean }) {
  return withTx(async ({ tx, live }) => {
    const truck = await getTruckRow(tx, actor, id, true);
    if (opts.version !== undefined && truck.version !== opts.version) throw conflict("STALE_VERSION", "Truck was modified by someone else. Reload and retry.", { currentVersion: truck.version });
    const res = await applyTransition(tx, actor, truck, action, opts.reason ?? null);
    live({ facilityId: actor.facilityId, topics: ["trucks", "docks", "resources", "twin", "dashboard", "events", "handover", "appointments"], eventType: "TRUCK_STATUS_CHANGED", entityType: "truck", entityId: id });
    return res;
  });
}

export async function applyTransition(tx: Tx, actor: Actor, truck: typeof T.$inferSelect, action: Exclude<TruckAction, "RELEASE" | "SCHEDULE">, reason: string | null, opts: { skipHandoverSync?: boolean } = {}) {
  const now = new Date();
  const activeDock = await tx
    .select()
    .from(schema.resourceReservations)
    .where(and(eq(schema.resourceReservations.truckId, truck.id), eq(schema.resourceReservations.status, "ACTIVE"), eq(schema.resourceReservations.resourceType, "DOCK")));
  const [ho] = await tx.select().from(schema.handoverRecords).where(eq(schema.handoverRecords.truckId, truck.id));
  const result = evaluateTransition(truck.status, action, {
    hasActiveRelease: activeDock.length > 0,
    hasArrived: truck.actualArrival !== null,
    handoverApprovedOrNotRequired: !ho || ho.status === "APPROVED" || ho.status === "CLOSED",
    reason,
  });
  if (!result.ok) throw unprocessable(result.code, result.message);
  const to: TruckStatus = result.to;
  const patch: Partial<typeof T.$inferInsert> = { status: to, version: truck.version + 1, updatedAt: now, statusReason: reason ?? truck.statusReason };
  let eventType: Parameters<typeof recordEvent>[1]["eventType"] = "TRUCK_STATUS_CHANGED";

  const releaseReservations = async (status: "RELEASED" | "CANCELLED") => {
    // Shorten active reservations to "now" so the resource becomes free immediately.
    await tx.execute(sql`
      update resource_reservations
         set status = ${status}, end_at = greatest(start_at + interval '1 minute', least(end_at, now())), updated_at = now()
       where truck_id = ${truck.id} and status in ('ACTIVE','SUSPENDED')`);
  };

  switch (action) {
    case "MARK_ARRIVAL":
      patch.actualArrival = now;
      eventType = "TRUCK_ARRIVED";
      if (!opts.skipHandoverSync) await syncHandover(tx, actor, truck.id, "ARRIVAL_CONFIRMED", "CONFIRM_ARRIVAL");
      break;
    case "START_SERVICE": {
      patch.serviceStartedAt = now;
      eventType = "SERVICE_STARTED";
      // Re-anchor the reservation window to the actual start (bounded by the next booking).
      for (const r of activeDock.concat(await tx.select().from(schema.resourceReservations).where(and(eq(schema.resourceReservations.truckId, truck.id), eq(schema.resourceReservations.status, "ACTIVE"), inArray(schema.resourceReservations.resourceType, ["TEAM", "EQUIPMENT"]))))) {
        const end = addMinutes(now, truck.serviceEstimateMin);
        try {
          await tx.transaction(async (sp) => {
            await sp.update(schema.resourceReservations).set({ startAt: now < r.startAt ? now : r.startAt, endAt: end > r.endAt ? end : r.endAt, updatedAt: now }).where(eq(schema.resourceReservations.id, r.id));
          });
        } catch {
          // Savepoint rolled back: keep the original window if the extension would collide with the next booking.
        }
      }
      if (!opts.skipHandoverSync) await syncHandover(tx, actor, truck.id, "UNLOADING", "START_UNLOADING");
      break;
    }
    case "COMPLETE_SERVICE":
      patch.serviceCompletedAt = now;
      eventType = "SERVICE_COMPLETED";
      await releaseReservations("RELEASED");
      await tx.update(schema.appointments).set({ status: "COMPLETED", updatedAt: now }).where(and(eq(schema.appointments.truckId, truck.id), eq(schema.appointments.status, "CONFIRMED")));
      break;
    case "REGISTER_DEPARTURE":
      patch.departedAt = now;
      eventType = "TRUCK_DEPARTED";
      if (!opts.skipHandoverSync) await syncHandover(tx, actor, truck.id, "CLOSED", "CLOSE_OPERATION");
      break;
    case "CANCEL":
    case "MARK_NO_SHOW":
      eventType = action === "CANCEL" ? "TRUCK_CANCELLED" : "TRUCK_STATUS_CHANGED";
      await releaseReservations("CANCELLED");
      await tx
        .update(schema.appointments)
        .set({ status: action === "CANCEL" ? "CANCELLED" : "NO_SHOW", updatedAt: now })
        .where(and(eq(schema.appointments.truckId, truck.id), inArray(schema.appointments.status, ["REQUESTED", "PROPOSED", "CONFIRMED"])));
      break;
    case "RAISE_EXCEPTION":
      await releaseReservations("CANCELLED");
      break;
    case "UNSCHEDULE":
      patch.assignedDockId = null;
      await tx
        .update(schema.appointments)
        .set({ status: "REQUESTED", confirmedStart: null, dockId: null, updatedAt: now })
        .where(and(eq(schema.appointments.truckId, truck.id), eq(schema.appointments.status, "CONFIRMED")));
      break;
    default:
      break;
  }
  const [updated] = await tx.update(T).set(patch).where(eq(T.id, truck.id)).returning();
  await recordEvent(tx, {
    orgId: actor.orgId,
    facilityId: actor.facilityId,
    eventType,
    entityType: "truck",
    entityId: truck.id,
    entityLabel: truck.code,
    actor,
    source: "USER",
    payload: { action, reason },
    previousState: truckStateView(truck),
    newState: truckStateView(updated),
  });
  await bumpState(tx, actor.facilityId);
  return updated;
}

export async function bulkTransition(actor: Actor, ids: string[], action: Exclude<TruckAction, "RELEASE" | "SCHEDULE">, reason: string | null) {
  const results: { truckId: string; ok: boolean; status?: string; error?: string }[] = [];
  for (const id of ids) {
    try {
      const t = await transitionTruck(actor, id, action, { reason, bulk: true });
      results.push({ truckId: id, ok: true, status: t.status });
    } catch (err) {
      results.push({ truckId: id, ok: false, error: (err as Error).message });
    }
  }
  return { action, results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}

export async function listTrucks(actor: Actor, q: z.infer<typeof truckListQuery>) {
  const statuses = q.status ? (Array.isArray(q.status) ? q.status : [q.status]) : undefined;
  const where = and(
    eq(T.facilityId, actor.facilityId),
    isNull(T.deletedAt),
    truckScope(actor),
    statuses ? inArray(T.status, statuses) : undefined,
    q.carrierId ? eq(T.carrierId, q.carrierId) : undefined,
    q.dockId ? eq(T.assignedDockId, q.dockId) : undefined,
    q.priority ? eq(T.priority, q.priority) : undefined,
    q.cargoType ? eq(schema.shipments.cargoType, q.cargoType) : undefined,
    q.q ? or(ilike(T.code, `%${q.q}%`), ilike(T.plateNumber, `%${q.q}%`), ilike(schema.shipments.reference, `%${q.q}%`), ilike(schema.carriers.name, `%${q.q}%`)) : undefined,
  );
  const sortCol = {
    code: T.code,
    plannedArrival: sql`coalesce(${schema.appointments.confirmedStart}, ${T.requestedArrival})`,
    requestedArrival: T.requestedArrival,
    status: T.status,
    priority: T.priority,
    createdAt: T.createdAt,
  }[q.sort];
  const base = db
    .select({
      truck: T,
      shipment: schema.shipments,
      carrier: { id: schema.carriers.id, name: schema.carriers.name, nameAr: schema.carriers.nameAr, code: schema.carriers.code },
      dock: { id: schema.docks.id, code: schema.docks.code, status: schema.docks.status },
      appointment: schema.appointments,
    })
    .from(T)
    .innerJoin(schema.shipments, eq(schema.shipments.id, T.shipmentId))
    .innerJoin(schema.carriers, eq(schema.carriers.id, T.carrierId))
    .leftJoin(schema.docks, eq(schema.docks.id, T.assignedDockId))
    .leftJoin(schema.appointments, and(eq(schema.appointments.truckId, T.id), inArray(schema.appointments.status, ["REQUESTED", "PROPOSED", "CONFIRMED"])));
  const [rows, [{ total }]] = await Promise.all([
    base
      .where(where)
      .orderBy(q.dir === "asc" ? asc(sortCol) : desc(sortCol), asc(T.code))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(T)
      .innerJoin(schema.shipments, eq(schema.shipments.id, T.shipmentId))
      .innerJoin(schema.carriers, eq(schema.carriers.id, T.carrierId))
      .leftJoin(schema.appointments, and(eq(schema.appointments.truckId, T.id), inArray(schema.appointments.status, ["REQUESTED", "PROPOSED", "CONFIRMED"])))
      .where(where),
  ]);
  return {
    items: rows.map((r) => ({ ...r.truck, shipment: r.shipment, carrier: r.carrier, dock: r.dock?.id ? r.dock : null, appointment: r.appointment })),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export async function getTruckDetail(actor: Actor, id: string) {
  const truck = await getTruckRow(db, actor, id);
  const [shipment] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, truck.shipmentId));
  const [carrier] = await db.select().from(schema.carriers).where(eq(schema.carriers.id, truck.carrierId));
  const [driver] = truck.driverId ? await db.select().from(schema.drivers).where(eq(schema.drivers.id, truck.driverId)) : [null];
  const [dock] = truck.assignedDockId ? await db.select().from(schema.docks).where(eq(schema.docks.id, truck.assignedDockId)) : [null];
  const [appointmentsRows, reservations, evaluations, quality, handover, events] = await Promise.all([
    db.select().from(schema.appointments).where(eq(schema.appointments.truckId, id)).orderBy(desc(schema.appointments.createdAt)),
    db.select().from(schema.resourceReservations).where(eq(schema.resourceReservations.truckId, id)).orderBy(desc(schema.resourceReservations.createdAt)),
    db.select().from(schema.readinessEvaluations).where(eq(schema.readinessEvaluations.truckId, id)).orderBy(desc(schema.readinessEvaluations.evaluatedAt)).limit(5),
    db.select().from(schema.qualityReviews).where(eq(schema.qualityReviews.shipmentId, truck.shipmentId)).orderBy(desc(schema.qualityReviews.createdAt)),
    db.select().from(schema.handoverRecords).where(eq(schema.handoverRecords.truckId, id)),
    db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityType, "truck"), eq(schema.auditEvents.entityId, id))).orderBy(desc(schema.auditEvents.occurredAt)).limit(50),
  ]);
  const scoped = actor.role === "CARRIER_OPERATOR" || actor.role === "DRIVER";
  return {
    ...truck,
    shipment,
    carrier,
    driver,
    dock,
    appointments: appointmentsRows,
    reservations: scoped ? [] : reservations,
    latestEvaluation: scoped ? null : evaluations[0] ?? null,
    qualityReviews: scoped ? [] : quality,
    handover: handover[0] ? { ...handover[0], qrToken: scoped ? undefined : handover[0].qrToken } : null,
    events: scoped ? events.filter((e) => ["TRUCK_CREATED", "TRUCK_RELEASED", "TRUCK_ARRIVED", "SERVICE_STARTED", "SERVICE_COMPLETED", "TRUCK_DEPARTED", "APPOINTMENT_SCHEDULED", "APPOINTMENT_RESCHEDULED"].includes(e.eventType)) : events,
  };
}
