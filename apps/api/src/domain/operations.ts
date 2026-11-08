import { and, eq, gt, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { addMinutes, type DockStatus } from "@wasl/shared";
import { db, schema, type Tx } from "../db/client";
import type { Actor } from "../http/context";
import { conflict, notFound, unprocessable } from "../http/errors";
import { recordEvent } from "./audit";
import { notify, ROLE_GROUPS } from "./notify";
import { dockCompatibility, isDockDown } from "./requirements";
import type { Dock } from "./snapshot";
import { bumpState, withTx } from "./tx";
import { getTruckRow, truckStateView } from "./trucks";
import { enqueueOptimization } from "./optimization";

/* ------------------------------------------------------------------ */
/* Effective dock status                                               */
/* ------------------------------------------------------------------ */

/**
 * Administrative status (AVAILABLE / OUT_OF_SERVICE / MAINTENANCE) is stored;
 * OCCUPIED and RESERVED are derived from live truck/reservation state so every
 * screen agrees on the same answer.
 */
export function effectiveDockStatus(dock: Dock, inServiceDockIds: Set<string>, reservations: { resourceId: string; startAt: Date; endAt: Date }[], now = new Date()): DockStatus {
  if (isDockDown(dock)) return dock.status;
  if (inServiceDockIds.has(dock.id)) return "OCCUPIED";
  const soon = addMinutes(now, 60);
  if (reservations.some((r) => r.resourceId === dock.id && r.startAt < soon && r.endAt > now)) return "RESERVED";
  return "AVAILABLE";
}

export async function listDocks(actor: Actor) {
  const now = new Date();
  const [docks, inService, resv, trucks] = await Promise.all([
    db.select().from(schema.docks).where(eq(schema.docks.facilityId, actor.facilityId)).orderBy(schema.docks.position),
    db.select({ dockId: schema.trucks.assignedDockId, id: schema.trucks.id, code: schema.trucks.code, startedAt: schema.trucks.serviceStartedAt, est: schema.trucks.serviceEstimateMin }).from(schema.trucks).where(and(eq(schema.trucks.facilityId, actor.facilityId), eq(schema.trucks.status, "IN_SERVICE"))),
    db
      .select()
      .from(schema.resourceReservations)
      .where(and(eq(schema.resourceReservations.facilityId, actor.facilityId), eq(schema.resourceReservations.resourceType, "DOCK"), eq(schema.resourceReservations.status, "ACTIVE"), gt(schema.resourceReservations.endAt, now))),
    db
      .select({ id: schema.trucks.id, code: schema.trucks.code, status: schema.trucks.status, dockId: schema.trucks.assignedDockId, reassignmentRequired: schema.trucks.reassignmentRequired, confirmedStart: schema.appointments.confirmedStart, durationMin: schema.appointments.durationMin })
      .from(schema.trucks)
      .leftJoin(schema.appointments, and(eq(schema.appointments.truckId, schema.trucks.id), eq(schema.appointments.status, "CONFIRMED")))
      .where(and(eq(schema.trucks.facilityId, actor.facilityId), isNull(schema.trucks.deletedAt), notInArray(schema.trucks.status, ["DEPARTED", "CANCELLED", "NO_SHOW"]))),
  ]);
  const inServiceIds = new Set(inService.map((t) => t.dockId!).filter(Boolean));
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  return docks.map((d) => {
    const assigned = trucks.filter((t) => t.dockId === d.id);
    const current = inService.find((t) => t.dockId === d.id) ?? null;
    const scheduledMin = assigned.reduce((s, t) => s + (t.durationMin ?? 0), 0);
    const reservations = resv.filter((r) => r.resourceId === d.id);
    const busyUntil = [...reservations].sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).reduce<Date | null>((acc, r) => (r.startAt <= (acc ?? now) ? (r.endAt > (acc ?? now) ? r.endAt : acc) : acc), null);
    return {
      ...d,
      effectiveStatus: effectiveDockStatus(d, inServiceIds, resv, now),
      currentTruck: current ? { id: current.id, code: current.code, serviceStartedAt: current.startedAt, estimatedCompletion: current.startedAt ? addMinutes(current.startedAt, current.est).toISOString() : null } : null,
      assignedTrucks: assigned.map((t) => ({ id: t.id, code: t.code, status: t.status, confirmedStart: t.confirmedStart, reassignmentRequired: t.reassignmentRequired })),
      upcomingReservations: reservations.map((r) => ({ id: r.id, truckId: r.truckId, startAt: r.startAt, endAt: r.endAt })),
      scheduledWorkloadMin: scheduledMin,
      estimatedAvailableAt: isDockDown(d) ? d.statusUntil : (busyUntil ?? now).toISOString(),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Release revocation (shared by dock / team / equipment disruptions)  */
/* ------------------------------------------------------------------ */

export async function revokeReleases(tx: Tx, actor: Actor, truckIds: string[], reason: string, correlationId: string) {
  if (!truckIds.length) return [];
  await tx
    .update(schema.resourceReservations)
    .set({ status: "SUSPENDED", updatedAt: new Date() })
    .where(and(inArray(schema.resourceReservations.truckId, truckIds), eq(schema.resourceReservations.status, "ACTIVE")));
  const trucks = await tx.select().from(schema.trucks).where(inArray(schema.trucks.id, truckIds));
  const changed = [];
  for (const t of trucks) {
    let to = t.status;
    // System alternate path: a release becomes invalid when its resources fail.
    if (t.status === "CALLED") to = t.actualArrival ? "WAITING" : "SCHEDULED";
    else if (t.status === "ARRIVED") to = "WAITING";
    const [u] = await tx
      .update(schema.trucks)
      .set({ status: to, reassignmentRequired: true, statusReason: reason, version: t.version + 1, updatedAt: new Date() })
      .where(eq(schema.trucks.id, t.id))
      .returning();
    await recordEvent(tx, {
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      eventType: "TRUCK_STATUS_CHANGED",
      entityType: "truck",
      entityId: t.id,
      entityLabel: t.code,
      actor,
      source: "SYSTEM",
      payload: { action: "RELEASE_REVOKED", reason },
      previousState: truckStateView(t),
      newState: truckStateView(u),
      correlationId,
    });
    await tx.insert(schema.decisions).values({
      facilityId: actor.facilityId,
      truckId: t.id,
      type: "REASSIGNMENT",
      status: "PENDING_REVIEW",
      outcome: "REASSIGNMENT_REQUIRED",
      reasons: [{ en: reason, ar: reason }],
      suggestedAction: { en: "Review the optimisation proposal or reassign manually", ar: "راجع مقترح التحسين أو أعد التخصيص يدويًا" },
      actorId: actor.userId,
    });
    changed.push(u);
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* Dock status workflow                                                */
/* ------------------------------------------------------------------ */

export async function setDockStatus(actor: Actor, dockId: string, input: { status: "AVAILABLE" | "OUT_OF_SERVICE" | "MAINTENANCE"; reason: string; until?: string | null }) {
  const result = await withTx(async ({ tx, live, after }) => {
    const [dock] = await tx.select().from(schema.docks).where(and(eq(schema.docks.id, dockId), eq(schema.docks.facilityId, actor.facilityId))).for("update");
    if (!dock) throw notFound("Dock");
    if (dock.status === input.status) throw unprocessable("NO_CHANGE", `Dock is already ${input.status}`);
    const goingDown = input.status !== "AVAILABLE";
    const [updated] = await tx
      .update(schema.docks)
      .set({ status: input.status, statusReason: input.reason, statusUntil: input.until ? new Date(input.until) : null, version: dock.version + 1, updatedAt: new Date() })
      .where(eq(schema.docks.id, dockId))
      .returning();
    const correlationId = crypto.randomUUID();
    let affected: { id: string; code: string; status: string }[] = [];
    let inService: { id: string; code: string }[] = [];
    if (goingDown) {
      const assigned = await tx
        .select()
        .from(schema.trucks)
        .where(and(eq(schema.trucks.assignedDockId, dockId), inArray(schema.trucks.status, ["SCHEDULED", "CALLED", "ARRIVED", "WAITING", "IN_SERVICE", "REGISTERED"])));
      inService = assigned.filter((t) => t.status === "IN_SERVICE").map((t) => ({ id: t.id, code: t.code }));
      const toRevoke = assigned.filter((t) => t.status !== "IN_SERVICE");
      const reason = `Dock ${dock.code} ${input.status}: ${input.reason}`;
      const changed = await revokeReleases(tx, actor, toRevoke.map((t) => t.id), reason, correlationId);
      affected = changed.map((t) => ({ id: t.id, code: t.code, status: t.status }));
      for (const t of inService) {
        await tx.insert(schema.decisions).values({
          facilityId: actor.facilityId,
          truckId: t.id,
          type: "HOLD",
          status: "PENDING_REVIEW",
          outcome: "MANUAL_REVIEW_REQUIRED",
          reasons: [{ en: `${t.code} is in service at ${dock.code}, which is now ${input.status}`, ar: `${t.code} قيد الخدمة على ${dock.code} الذي أصبح ${input.status}` }],
          suggestedAction: { en: "Supervisor to decide: complete safely or raise an exception", ar: "على المشرف أن يقرر: إكمال آمن أو تسجيل استثناء" },
          actorId: actor.userId,
        });
      }
      await notify(tx, {
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        type: "DOCK_FAILURE",
        severity: "CRITICAL",
        title: `Dock ${dock.code} ${input.status} — ${affected.length + inService.length} truck(s) affected`,
        titleAr: `الرصيف ${dock.code} ${input.status === "OUT_OF_SERVICE" ? "معطل" : "في الصيانة"} — ${affected.length + inService.length} شاحنة متأثرة`,
        body: `${input.reason}. Affected: ${[...affected, ...inService].map((t) => t.code).join(", ") || "none"}. A re-optimisation proposal was requested.`,
        bodyAr: `${input.reason}. المتأثرة: ${[...affected, ...inService].map((t) => t.code).join("، ") || "لا يوجد"}. تم طلب مقترح إعادة تحسين.`,
        roles: ROLE_GROUPS.ops,
        entityType: "dock",
        entityId: dockId,
        actionRequired: true,
      });
    } else {
      // Restoration: trucks still assigned to this dock may be released again.
      await tx.update(schema.trucks).set({ reassignmentRequired: false, updatedAt: new Date() }).where(and(eq(schema.trucks.assignedDockId, dockId), eq(schema.trucks.reassignmentRequired, true)));
      await tx.update(schema.notifications).set({ resolvedAt: new Date() }).where(and(eq(schema.notifications.entityId, dockId), eq(schema.notifications.type, "DOCK_FAILURE"), isNull(schema.notifications.resolvedAt)));
    }
    await recordEvent(tx, {
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      eventType: goingDown ? (input.status === "MAINTENANCE" ? "DOCK_MAINTENANCE_SCHEDULED" : "DOCK_FAILED") : "DOCK_RESTORED",
      entityType: "dock",
      entityId: dockId,
      entityLabel: dock.code,
      actor,
      source: "USER",
      payload: { reason: input.reason, until: input.until ?? null, affectedTrucks: affected, inServiceTrucks: inService },
      previousState: { status: dock.status },
      newState: { status: updated.status },
      correlationId,
    });
    await bumpState(tx, actor.facilityId);
    live({ facilityId: actor.facilityId, topics: ["docks", "trucks", "twin", "dashboard", "events", "notifications", "decisions", "resources"], eventType: goingDown ? "DOCK_FAILED" : "DOCK_RESTORED", entityType: "dock", entityId: dockId });
    if (goingDown && affected.length + inService.length > 0) {
      after(() => enqueueOptimization(actor, { trigger: "DOCK_FAILURE", label: `Auto re-plan after ${dock.code} ${input.status}` }).then(() => undefined));
    }
    return { dock: updated, affectedTrucks: affected, inServiceTrucks: inService, correlationId };
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Workforce & equipment status                                         */
/* ------------------------------------------------------------------ */

export async function setResourceStatus(actor: Actor, kind: "TEAM" | "EQUIPMENT", id: string, status: string, reason: string) {
  return withTx(async ({ tx, live, after }) => {
    const table = kind === "TEAM" ? schema.workforceTeams : schema.equipment;
    const [row] = await tx.select().from(table).where(and(eq(table.id, id), eq(table.facilityId, actor.facilityId))).for("update");
    if (!row) throw notFound(kind === "TEAM" ? "Team" : "Equipment");
    if (row.status === status) throw unprocessable("NO_CHANGE", `Already ${status}`);
    await tx.update(table).set({ status: status as never, statusReason: reason }).where(eq(table.id, id));
    const unavailable = status !== "AVAILABLE";
    const correlationId = crypto.randomUUID();
    let affected: { id: string; code: string }[] = [];
    if (unavailable) {
      const resv = await tx
        .select({ truckId: schema.resourceReservations.truckId })
        .from(schema.resourceReservations)
        .innerJoin(schema.trucks, eq(schema.trucks.id, schema.resourceReservations.truckId))
        .where(and(eq(schema.resourceReservations.resourceType, kind), eq(schema.resourceReservations.resourceId, id), eq(schema.resourceReservations.status, "ACTIVE"), ne(schema.trucks.status, "IN_SERVICE")));
      const changed = await revokeReleases(tx, actor, [...new Set(resv.map((r) => r.truckId))], `${kind === "TEAM" ? "Team" : "Equipment"} ${row.code} unavailable: ${reason}`, correlationId);
      affected = changed.map((t) => ({ id: t.id, code: t.code }));
      await notify(tx, {
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        type: "RESOURCE_SHORTAGE",
        severity: affected.length ? "HIGH" : "MEDIUM",
        title: `${row.code} unavailable — ${affected.length} release(s) revoked`,
        titleAr: `${row.code} غير متاح — أُلغي ${affected.length} استدعاء`,
        body: reason,
        bodyAr: reason,
        roles: ROLE_GROUPS.ops,
        entityType: kind === "TEAM" ? "team" : "equipment",
        entityId: id,
        actionRequired: affected.length > 0,
      });
    }
    await recordEvent(tx, {
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      eventType: unavailable ? "RESOURCE_UNAVAILABLE" : "RESOURCE_RESTORED",
      entityType: kind === "TEAM" ? "team" : "equipment",
      entityId: id,
      entityLabel: row.code,
      actor,
      source: "USER",
      payload: { reason, status, affectedTrucks: affected },
      previousState: { status: row.status },
      newState: { status },
      correlationId,
    });
    await bumpState(tx, actor.facilityId);
    live({ facilityId: actor.facilityId, topics: ["resources", "trucks", "twin", "dashboard", "events", "notifications", "decisions"], entityType: kind, entityId: id });
    if (affected.length) after(() => enqueueOptimization(actor, { trigger: "RESOURCE_UNAVAILABLE", label: `Auto re-plan after ${row.code} unavailable` }).then(() => undefined));
    return { id, status, affectedTrucks: affected };
  });
}

/* ------------------------------------------------------------------ */
/* Appointment scheduling                                              */
/* ------------------------------------------------------------------ */

export interface SlotValidation {
  ok: boolean;
  errors: { code: string; message: string; messageAr: string; details?: unknown }[];
  warnings: { code: string; message: string; messageAr: string; details?: unknown }[];
  start: string;
  end: string;
  durationMin: number;
}

export async function validateSlot(tx: Tx | typeof db, actor: Actor, input: { truckId: string; dockId: string; start: string; durationMin?: number }): Promise<SlotValidation & { truck: typeof schema.trucks.$inferSelect; dock: Dock }> {
  const truck = await getTruckRow(tx, actor, input.truckId);
  const [shipment] = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, truck.shipmentId));
  const [dock] = await tx.select().from(schema.docks).where(and(eq(schema.docks.id, input.dockId), eq(schema.docks.facilityId, actor.facilityId)));
  if (!dock) throw notFound("Dock");
  const durationMin = input.durationMin ?? truck.serviceEstimateMin;
  const start = new Date(input.start);
  const end = addMinutes(start, durationMin);
  const errors: SlotValidation["errors"] = [];
  const warnings: SlotValidation["warnings"] = [];
  if (isDockDown(dock)) errors.push({ code: "DOCK_DOWN", message: `${dock.code} is ${dock.status}`, messageAr: `الرصيف ${dock.code} بحالة ${dock.status}` });
  const compat = dockCompatibility(dock, truck.vehicleType, shipment.cargoType);
  if (!compat.ok) errors.push({ code: "DOCK_INCOMPATIBLE", message: compat.problems.map((p) => p.en).join("; "), messageAr: compat.problems.map((p) => p.ar).join("؛ ") });
  if (start.getTime() < Date.now() - 5 * 60_000) errors.push({ code: "IN_PAST", message: "Appointment start is in the past", messageAr: "بداية الموعد في الماضي" });
  if (!["REGISTERED", "SCHEDULED", "WAITING"].includes(truck.status)) errors.push({ code: "NOT_SCHEDULABLE", message: `Truck status ${truck.status} cannot be (re)scheduled; released trucks are managed by the readiness engine`, messageAr: `لا يمكن جدولة شاحنة بحالة ${truck.status}` });

  const resv = await tx
    .select({ r: schema.resourceReservations, code: schema.trucks.code })
    .from(schema.resourceReservations)
    .innerJoin(schema.trucks, eq(schema.trucks.id, schema.resourceReservations.truckId))
    .where(and(eq(schema.resourceReservations.resourceType, "DOCK"), eq(schema.resourceReservations.resourceId, dock.id), eq(schema.resourceReservations.status, "ACTIVE"), ne(schema.resourceReservations.truckId, truck.id)));
  const hardClash = resv.filter(({ r }) => r.startAt < end && start < r.endAt);
  if (hardClash.length) errors.push({ code: "RESERVATION_CONFLICT", message: `Overlaps active reservation(s): ${hardClash.map((c) => c.code).join(", ")}`, messageAr: `يتداخل مع حجز فعّال: ${hardClash.map((c) => c.code).join("، ")}`, details: hardClash.map((c) => c.r.id) });

  const appts = await tx
    .select({ a: schema.appointments, code: schema.trucks.code })
    .from(schema.appointments)
    .innerJoin(schema.trucks, eq(schema.trucks.id, schema.appointments.truckId))
    .where(and(eq(schema.appointments.dockId, dock.id), eq(schema.appointments.status, "CONFIRMED"), ne(schema.appointments.truckId, truck.id), notInArray(schema.trucks.status, ["CALLED", "ARRIVED", "IN_SERVICE", "COMPLETED", "DEPARTED"])));
  const apptClash = appts.filter(({ a }) => a.confirmedStart && a.confirmedStart < end && start < addMinutes(a.confirmedStart, a.durationMin));
  if (apptClash.length) errors.push({ code: "APPOINTMENT_CONFLICT", message: `Overlaps confirmed appointment(s): ${apptClash.map((c) => c.code).join(", ")}`, messageAr: `يتداخل مع موعد مؤكد: ${apptClash.map((c) => c.code).join("، ")}`, details: apptClash.map((c) => c.a.id) });

  const delta = Math.round((start.getTime() - truck.requestedArrival.getTime()) / 60_000);
  if (Math.abs(delta) > 60) warnings.push({ code: "FAR_FROM_REQUEST", message: `Start differs from carrier request by ${delta} min`, messageAr: `يختلف عن طلب الناقل بمقدار ${delta} دقيقة` });
  if (shipment.qualityStatus !== "NO_ISSUE_OBSERVED" && shipment.qualityStatus !== "RELEASED_BY_AUTHORIZED_USER") warnings.push({ code: "QUALITY_PENDING", message: `Quality status ${shipment.qualityStatus} may hold the release`, messageAr: `حالة الجودة ${shipment.qualityStatus} قد توقف الاستدعاء` });
  return { ok: errors.length === 0, errors, warnings, start: start.toISOString(), end: end.toISOString(), durationMin, truck, dock };
}

export async function scheduleAppointment(actor: Actor, input: { truckId: string; dockId: string; start: string; durationMin?: number; version: number; reason?: string | null }) {
  return withTx(async ({ tx, live }) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"appt:" + input.dockId}))`);
    const v = await validateSlot(tx, actor, input);
    if (v.truck.version !== input.version) throw conflict("STALE_VERSION", "Truck was modified by someone else. Reload and retry.", { currentVersion: v.truck.version });
    if (!v.ok) throw conflict(v.errors[0].code, v.errors.map((e) => e.message).join(" | "), { errors: v.errors, warnings: v.warnings });
    const [existing] = await tx
      .select()
      .from(schema.appointments)
      .where(and(eq(schema.appointments.truckId, input.truckId), inArray(schema.appointments.status, ["REQUESTED", "PROPOSED", "CONFIRMED"])));
    const isReschedule = existing?.status === "CONFIRMED";
    let appointment;
    if (existing) {
      [appointment] = await tx
        .update(schema.appointments)
        .set({ status: "CONFIRMED", dockId: input.dockId, confirmedStart: new Date(v.start), durationMin: v.durationMin, version: existing.version + 1, updatedAt: new Date(), source: "MANUAL" })
        .where(eq(schema.appointments.id, existing.id))
        .returning();
    } else {
      [appointment] = await tx
        .insert(schema.appointments)
        .values({ facilityId: actor.facilityId, truckId: input.truckId, dockId: input.dockId, status: "CONFIRMED", requestedStart: v.truck.requestedArrival, confirmedStart: new Date(v.start), durationMin: v.durationMin, source: "MANUAL" })
        .returning();
    }
    const [updated] = await tx
      .update(schema.trucks)
      .set({ assignedDockId: input.dockId, reassignmentRequired: false, status: v.truck.status === "REGISTERED" ? "SCHEDULED" : v.truck.status, version: v.truck.version + 1, updatedAt: new Date() })
      .where(eq(schema.trucks.id, input.truckId))
      .returning();
    await tx
      .update(schema.decisions)
      .set({ status: "SUPERSEDED", resolvedAt: new Date() })
      .where(and(eq(schema.decisions.truckId, input.truckId), eq(schema.decisions.status, "PENDING_REVIEW"), eq(schema.decisions.type, "REASSIGNMENT")));
    await recordEvent(tx, {
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      eventType: isReschedule ? "APPOINTMENT_RESCHEDULED" : "APPOINTMENT_SCHEDULED",
      entityType: "truck",
      entityId: input.truckId,
      entityLabel: v.truck.code,
      actor,
      source: "USER",
      payload: { appointmentId: appointment.id, dockId: input.dockId, dockCode: v.dock.code, confirmedStart: v.start, previousStart: existing?.confirmedStart ?? null, durationMin: v.durationMin, reason: input.reason ?? null, warnings: v.warnings },
      previousState: truckStateView(v.truck),
      newState: truckStateView(updated),
    });
    await bumpState(tx, actor.facilityId);
    live({ facilityId: actor.facilityId, topics: ["appointments", "trucks", "docks", "twin", "dashboard", "events", "readiness"], entityType: "truck", entityId: input.truckId });
    return { appointment, truck: updated, warnings: v.warnings };
  });
}
