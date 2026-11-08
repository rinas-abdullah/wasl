import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import { startOfLocalDay, addMinutes, type CargoType } from "@wasl/shared";
import { db, schema } from "../db/client";
import type { Actor } from "../http/context";
import { intel } from "../intel/client";
import { listDocks } from "./operations";
import { teamShiftWindow } from "./requirements";
import { truckScope } from "./trucks";

const T = schema.trucks;
const pct = (arr: number[], p: number) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
};
const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const mins = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 60_000;

async function facility(actor: Actor) {
  const [f] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, actor.facilityId));
  return f;
}

/* ------------------------------------------------------------------ */
/* Congestion risk (Model 02)                                           */
/* ------------------------------------------------------------------ */

export async function congestionRisk(actor: Actor) {
  const now = new Date();
  const in2h = addMinutes(now, 120);
  const [f, docks, teams, active] = await Promise.all([
    facility(actor),
    listDocks(actor),
    db.select().from(schema.workforceTeams).where(eq(schema.workforceTeams.facilityId, actor.facilityId)),
    db
      .select({ t: T, confirmedStart: schema.appointments.confirmedStart })
      .from(T)
      .leftJoin(schema.appointments, and(eq(schema.appointments.truckId, T.id), eq(schema.appointments.status, "CONFIRMED")))
      .where(and(eq(T.facilityId, actor.facilityId), isNull(T.deletedAt), notInArray(T.status, ["DEPARTED", "CANCELLED", "NO_SHOW"]))),
  ]);
  const operational = docks.filter((d) => d.effectiveStatus !== "OUT_OF_SERVICE" && d.effectiveStatus !== "MAINTENANCE");
  const occupied = docks.filter((d) => d.effectiveStatus === "OCCUPIED").length;
  const upcoming = active.filter(({ t, confirmedStart }) => !t.actualArrival && ["SCHEDULED", "CALLED", "REGISTERED"].includes(t.status) && (confirmedStart ?? t.requestedArrival) <= in2h);
  const onShift = teams.filter((t) => {
    const w = teamShiftWindow(t, now, f.timezone);
    return t.status === "AVAILABLE" && now >= w.start && now < w.end;
  });
  const features = {
    arrivals_next_2h: upcoming.length,
    dock_utilization: operational.length ? occupied / operational.length : 1,
    available_docks: operational.length,
    available_teams: onShift.length,
    mean_service_min: avg(upcoming.map(({ t }) => t.serviceEstimateMin)) ?? 45,
    yard_occupancy: active.filter(({ t }) => t.status === "WAITING" || t.status === "ARRIVED").length,
  };
  try {
    const r = await intel<{ probability: number; source: string; label: string; threshold_queue_length: number; beats_baseline: boolean }>("/predict/congestion", features, { timeoutMs: 3000, retries: 0 });
    return { available: true, ...r, features };
  } catch (err) {
    return { available: false, reason: (err as Error).message, features };
  }
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                            */
/* ------------------------------------------------------------------ */

export async function dashboardOverview(actor: Actor) {
  const f = await facility(actor);
  const now = new Date();
  const dayStart = startOfLocalDay(now, f.timezone);
  const dayEnd = addMinutes(dayStart, 1440);
  const scope = truckScope(actor);
  const [trucks, docks, openQuality, pendingDecisions, pendingPlans, teams, equipment, recent, upcomingRows] = await Promise.all([
    db
      .select({ t: T, confirmedStart: schema.appointments.confirmedStart, cargoType: schema.shipments.cargoType })
      .from(T)
      .innerJoin(schema.shipments, eq(schema.shipments.id, T.shipmentId))
      .leftJoin(schema.appointments, and(eq(schema.appointments.truckId, T.id), inArray(schema.appointments.status, ["CONFIRMED", "COMPLETED"])))
      .where(and(eq(T.facilityId, actor.facilityId), isNull(T.deletedAt), scope)),
    listDocks(actor),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.qualityReviews).where(and(eq(schema.qualityReviews.facilityId, actor.facilityId), inArray(schema.qualityReviews.status, ["REVIEW_REQUIRED", "UNDER_REVIEW", "ESCALATED", "HOLD"]))),
    db
      .select({ d: schema.decisions, code: T.code })
      .from(schema.decisions)
      .leftJoin(T, eq(T.id, schema.decisions.truckId))
      .where(and(eq(schema.decisions.facilityId, actor.facilityId), eq(schema.decisions.status, "PENDING_REVIEW")))
      .orderBy(desc(schema.decisions.createdAt)),
    db.select().from(schema.optimizationRuns).where(and(eq(schema.optimizationRuns.facilityId, actor.facilityId), eq(schema.optimizationRuns.approvalStatus, "PENDING"), eq(schema.optimizationRuns.jobStatus, "COMPLETED"))).orderBy(desc(schema.optimizationRuns.createdAt)),
    db.select().from(schema.workforceTeams).where(eq(schema.workforceTeams.facilityId, actor.facilityId)).orderBy(schema.workforceTeams.code),
    db.select().from(schema.equipment).where(eq(schema.equipment.facilityId, actor.facilityId)),
    db.select().from(schema.auditEvents).where(eq(schema.auditEvents.facilityId, actor.facilityId)).orderBy(desc(schema.auditEvents.occurredAt)).limit(25),
    db
      .select({ t: T, confirmedStart: schema.appointments.confirmedStart, dockCode: schema.docks.code, carrier: schema.carriers.name, carrierAr: schema.carriers.nameAr, cargoType: schema.shipments.cargoType, qualityStatus: schema.shipments.qualityStatus })
      .from(T)
      .innerJoin(schema.shipments, eq(schema.shipments.id, T.shipmentId))
      .innerJoin(schema.carriers, eq(schema.carriers.id, T.carrierId))
      .leftJoin(schema.appointments, and(eq(schema.appointments.truckId, T.id), eq(schema.appointments.status, "CONFIRMED")))
      .leftJoin(schema.docks, eq(schema.docks.id, T.assignedDockId))
      .where(and(eq(T.facilityId, actor.facilityId), isNull(T.deletedAt), inArray(T.status, ["REGISTERED", "SCHEDULED", "CALLED"]), isNull(T.actualArrival), scope))
      .orderBy(asc(sql`coalesce(${schema.appointments.confirmedStart}, ${T.requestedArrival})`))
      .limit(10),
  ]);
  const ts = trucks.map((r) => r.t);
  const planned = (r: (typeof trucks)[number]) => r.confirmedStart ?? r.t.requestedArrival;
  const todays = trucks.filter((r) => planned(r) >= dayStart && planned(r) < dayEnd && !["CANCELLED"].includes(r.t.status));
  const servedToday = ts.filter((t) => t.serviceStartedAt && t.actualArrival && t.serviceStartedAt >= dayStart);
  const departedToday = ts.filter((t) => t.departedAt && t.actualArrival && t.departedAt >= dayStart);
  const waits = servedToday.map((t) => mins(t.serviceStartedAt!, t.actualArrival!));
  const turnarounds = departedToday.map((t) => mins(t.departedAt!, t.actualArrival!));
  const downDocks = docks.filter((d) => d.effectiveStatus === "OUT_OF_SERVICE" || d.effectiveStatus === "MAINTENANCE");
  const unavailableTeams = teams.filter((t) => t.status !== "AVAILABLE");
  const unavailableEquipment = equipment.filter((e) => e.status !== "AVAILABLE");

  const hourly: { hour: string; planned: number; arrived: number; completed: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const a = addMinutes(dayStart, h * 60);
    const b = addMinutes(a, 60);
    hourly.push({
      hour: new Intl.DateTimeFormat("en-GB", { timeZone: f.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(a),
      planned: todays.filter((r) => planned(r) >= a && planned(r) < b).length,
      arrived: ts.filter((t) => t.actualArrival && t.actualArrival >= a && t.actualArrival < b).length,
      completed: ts.filter((t) => t.serviceCompletedAt && t.serviceCompletedAt >= a && t.serviceCompletedAt < b).length,
    });
  }
  const statusCounts = Object.fromEntries(
    ["REGISTERED", "SCHEDULED", "CALLED", "ARRIVED", "WAITING", "IN_SERVICE", "COMPLETED", "DEPARTED", "CANCELLED", "NO_SHOW", "EXCEPTION"].map((s) => [s, ts.filter((t) => t.status === s).length]),
  );
  const alerts = await db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.facilityId, actor.facilityId), isNull(schema.notifications.resolvedAt), inArray(schema.notifications.severity, ["HIGH", "CRITICAL"])))
    .orderBy(desc(schema.notifications.createdAt))
    .limit(8);

  return {
    generatedAt: now.toISOString(),
    facility: { id: f.id, name: f.name, nameAr: f.nameAr, timezone: f.timezone, yardCapacity: f.yardCapacity, stateVersion: f.stateVersion },
    dataSource: "OPERATIONAL_RECORDS",
    kpis: {
      totalScheduledToday: todays.length,
      arrivalsToday: ts.filter((t) => t.actualArrival && t.actualArrival >= dayStart).length,
      trucksWaiting: ts.filter((t) => t.status === "WAITING" || t.status === "ARRIVED").length,
      trucksInService: ts.filter((t) => t.status === "IN_SERVICE").length,
      availableDocks: docks.filter((d) => d.effectiveStatus === "AVAILABLE" || d.effectiveStatus === "RESERVED").length,
      occupiedDocks: docks.filter((d) => d.effectiveStatus === "OCCUPIED").length,
      outOfServiceDocks: downDocks.length,
      avgWaitingTimeMin: avg(waits),
      avgWaitingSample: waits.length,
      avgTurnaroundTimeMin: avg(turnarounds),
      avgTurnaroundSample: turnarounds.length,
      pendingQualityReviews: openQuality[0]?.n ?? 0,
      readinessHolds: pendingDecisions.filter((d) => d.d.type === "HOLD" || d.d.type === "REASSIGNMENT").length,
      activeDisruptions: downDocks.length + unavailableTeams.length + unavailableEquipment.length,
      yardOccupancy: ts.filter((t) => t.status === "WAITING" || t.status === "ARRIVED" || t.status === "EXCEPTION").length,
    },
    statusCounts,
    docks: docks.map((d) => ({ id: d.id, code: d.code, name: d.name, effectiveStatus: d.effectiveStatus, statusReason: d.statusReason, currentTruck: d.currentTruck, features: d.features })),
    teams: teams.map((t) => ({ id: t.id, code: t.code, name: t.name, nameAr: t.nameAr, status: t.status, size: t.size, shiftStart: t.shiftStart, shiftEnd: t.shiftEnd, skills: t.skills })),
    disruptions: {
      docks: downDocks.map((d) => ({ id: d.id, code: d.code, status: d.effectiveStatus, reason: d.statusReason })),
      teams: unavailableTeams.map((t) => ({ id: t.id, code: t.code, reason: t.statusReason })),
      equipment: unavailableEquipment.map((e) => ({ id: e.id, code: e.code, status: e.status, reason: e.statusReason })),
    },
    alerts,
    upcoming: upcomingRows.map((r) => ({ id: r.t.id, code: r.t.code, status: r.t.status, plannedArrival: r.confirmedStart ?? r.t.requestedArrival, confirmed: !!r.confirmedStart, dockCode: r.dockCode, carrier: r.carrier, carrierAr: r.carrierAr, cargoType: r.cargoType, qualityStatus: r.qualityStatus, priority: r.t.priority, reassignmentRequired: r.t.reassignmentRequired })),
    decisionQueue: [
      ...pendingPlans.map((p) => ({ kind: "PLAN" as const, id: p.id, createdAt: p.createdAt, title: p.label ?? "Optimization plan", solverStatus: p.solverStatus, objective: p.objectiveValue, trigger: p.trigger })),
      ...pendingDecisions.map((d) => ({ kind: "DECISION" as const, id: d.d.id, createdAt: d.d.createdAt, type: d.d.type, outcome: d.d.outcome, truckId: d.d.truckId, truckCode: d.code, reasons: d.d.reasons, suggestedAction: d.d.suggestedAction })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    timeline: recent,
    hourly,
  };
}

/* ------------------------------------------------------------------ */
/* Digital twin                                                         */
/* ------------------------------------------------------------------ */

export async function twinState(actor: Actor) {
  const f = await facility(actor);
  const scope = truckScope(actor);
  const [docks, gates, teams, equipment, trucks] = await Promise.all([
    listDocks(actor),
    db.select().from(schema.gates).where(eq(schema.gates.facilityId, actor.facilityId)).orderBy(schema.gates.code),
    db.select().from(schema.workforceTeams).where(eq(schema.workforceTeams.facilityId, actor.facilityId)).orderBy(schema.workforceTeams.code),
    db.select().from(schema.equipment).where(eq(schema.equipment.facilityId, actor.facilityId)).orderBy(schema.equipment.code),
    db
      .select({ t: T, shipment: schema.shipments, carrier: schema.carriers.name, carrierAr: schema.carriers.nameAr, confirmedStart: schema.appointments.confirmedStart })
      .from(T)
      .innerJoin(schema.shipments, eq(schema.shipments.id, T.shipmentId))
      .innerJoin(schema.carriers, eq(schema.carriers.id, T.carrierId))
      .leftJoin(schema.appointments, and(eq(schema.appointments.truckId, T.id), inArray(schema.appointments.status, ["CONFIRMED", "COMPLETED"])))
      .where(and(eq(T.facilityId, actor.facilityId), isNull(T.deletedAt), notInArray(T.status, ["CANCELLED", "NO_SHOW"]), sql`(${T.departedAt} is null or ${T.departedAt} > now() - interval '2 hours')`, scope)),
  ]);
  const zone = (t: typeof T.$inferSelect, qs: string): string => {
    if (t.status === "DEPARTED") return "EXITED";
    if (t.status === "IN_SERVICE" || t.status === "COMPLETED") return "DOCK";
    if (t.status === "ARRIVED" || (t.status === "CALLED" && t.actualArrival)) return "TO_DOCK";
    if (t.status === "WAITING" || t.status === "EXCEPTION") return ["REVIEW_REQUIRED", "UNDER_REVIEW", "HOLD", "ESCALATED"].includes(qs) ? "QUALITY" : "YARD";
    if (t.status === "CALLED") return "APPROACH";
    return "PLANNED";
  };
  return {
    mode: "LIVE",
    generatedAt: new Date().toISOString(),
    stateVersion: f.stateVersion,
    facility: { id: f.id, name: f.name, nameAr: f.nameAr, yardCapacity: f.yardCapacity, timezone: f.timezone },
    docks: docks.map((d) => ({ id: d.id, code: d.code, name: d.name, position: d.position, status: d.effectiveStatus, adminStatus: d.status, statusReason: d.statusReason, statusUntil: d.statusUntil, maxVehicleType: d.maxVehicleType, compatibleCargo: d.compatibleCargo, features: d.features, restrictions: d.restrictions, currentTruck: d.currentTruck, assignedTrucks: d.assignedTrucks, estimatedAvailableAt: d.estimatedAvailableAt })),
    gates: gates.map((g) => ({ id: g.id, code: g.code, type: g.type, status: g.status, capacityPerHour: g.capacityPerHour })),
    teams: teams.map((t) => ({ id: t.id, code: t.code, name: t.name, nameAr: t.nameAr, status: t.status, size: t.size, skills: t.skills, shiftStart: t.shiftStart, shiftEnd: t.shiftEnd })),
    equipment: equipment.map((e) => ({ id: e.id, code: e.code, type: e.type, status: e.status })),
    trucks: trucks.map((r) => ({
      id: r.t.id,
      code: r.t.code,
      status: r.t.status,
      zone: zone(r.t, r.shipment.qualityStatus),
      dockId: r.t.assignedDockId,
      carrier: r.carrier,
      carrierAr: r.carrierAr,
      vehicleType: r.t.vehicleType,
      cargoType: r.shipment.cargoType,
      qualityStatus: r.shipment.qualityStatus,
      inspectionRequired: r.shipment.inspectionRequired,
      priority: r.t.priority,
      plannedArrival: r.confirmedStart ?? r.t.requestedArrival,
      actualArrival: r.t.actualArrival,
      serviceStartedAt: r.t.serviceStartedAt,
      serviceEstimateMin: r.t.serviceEstimateMin,
      reassignmentRequired: r.t.reassignmentRequired,
    })),
  };
}

/** Event-sourced replay of the operations log: folds audit new_state snapshots. */
export async function twinReplay(actor: Actor, from: Date, to: Date) {
  const rows = await db
    .select({ seq: schema.auditEvents.seq, id: schema.auditEvents.id, eventType: schema.auditEvents.eventType, entityType: schema.auditEvents.entityType, entityId: schema.auditEvents.entityId, entityLabel: schema.auditEvents.entityLabel, newState: schema.auditEvents.newState, occurredAt: schema.auditEvents.occurredAt, actorLabel: schema.auditEvents.actorLabel, payload: schema.auditEvents.payload })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.facilityId, actor.facilityId), inArray(schema.auditEvents.entityType, ["truck", "dock"]), isNotNull(schema.auditEvents.newState), lte(schema.auditEvents.occurredAt, to)))
    .orderBy(asc(schema.auditEvents.occurredAt), asc(schema.auditEvents.seq));
  const initial: Record<string, { entityType: string; label: string | null; state: Record<string, unknown> }> = {};
  const events = [];
  for (const r of rows) {
    if (r.occurredAt <= from) {
      initial[r.entityId!] = { entityType: r.entityType, label: r.entityLabel, state: { ...(initial[r.entityId!]?.state ?? {}), ...r.newState } };
    } else {
      events.push(r);
    }
  }
  return { mode: "REPLAY", from: from.toISOString(), to: to.toISOString(), initial, events };
}

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

export async function operationsReport(actor: Actor, q: { from?: string; to?: string; dockId?: string; carrierId?: string; cargoType?: CargoType }) {
  const f = await facility(actor);
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : startOfLocalDay(to, f.timezone);
  const periodMin = Math.max(1, mins(to, from));
  const rows = await db
    .select({ t: T, cargoType: schema.shipments.cargoType, carrier: schema.carriers.name, carrierAr: schema.carriers.nameAr, dockCode: schema.docks.code, quality: schema.shipments.qualityStatus })
    .from(T)
    .innerJoin(schema.shipments, eq(schema.shipments.id, T.shipmentId))
    .innerJoin(schema.carriers, eq(schema.carriers.id, T.carrierId))
    .leftJoin(schema.docks, eq(schema.docks.id, T.assignedDockId))
    .where(
      and(
        eq(T.facilityId, actor.facilityId),
        isNull(T.deletedAt),
        truckScope(actor),
        q.dockId ? eq(T.assignedDockId, q.dockId) : undefined,
        q.carrierId ? eq(T.carrierId, q.carrierId) : undefined,
        q.cargoType ? eq(schema.shipments.cargoType, q.cargoType) : undefined,
        sql`(${T.actualArrival} between ${from} and ${to} or ${T.requestedArrival} between ${from} and ${to} or ${T.serviceStartedAt} between ${from} and ${to})`,
      ),
    );
  const ts = rows.map((r) => r.t);
  const served = rows.filter((r) => r.t.serviceStartedAt && r.t.actualArrival && r.t.serviceStartedAt >= from && r.t.serviceStartedAt <= to);
  const waits = served.map((r) => mins(r.t.serviceStartedAt!, r.t.actualArrival!));
  const departed = rows.filter((r) => r.t.departedAt && r.t.actualArrival && r.t.departedAt >= from && r.t.departedAt <= to);
  const tats = departed.map((r) => mins(r.t.departedAt!, r.t.actualArrival!));
  const docks = await db.select().from(schema.docks).where(eq(schema.docks.facilityId, actor.facilityId)).orderBy(schema.docks.position);
  const busyByDock = (id: string) =>
    rows
      .filter((r) => r.t.assignedDockId === id && r.t.serviceStartedAt)
      .reduce((s, r) => {
        const a = r.t.serviceStartedAt! < from ? from : r.t.serviceStartedAt!;
        const bRaw = r.t.serviceCompletedAt ?? (r.t.status === "IN_SERVICE" ? new Date() : r.t.serviceStartedAt!);
        const b = bRaw > to ? to : bRaw;
        return s + Math.max(0, mins(b, a));
      }, 0);
  const dockPerf = docks.map((d) => {
    const dRows = rows.filter((r) => r.t.assignedDockId === d.id);
    const dServed = dRows.filter((r) => r.t.serviceCompletedAt);
    return {
      dockId: d.id,
      code: d.code,
      status: d.status,
      trucksServed: dServed.length,
      busyMin: Math.round(busyByDock(d.id)),
      utilization: busyByDock(d.id) / periodMin,
      avgServiceMin: avg(dServed.map((r) => mins(r.t.serviceCompletedAt!, r.t.serviceStartedAt!))),
    };
  });
  // Team utilisation from reservations of served trucks
  const teamRes = await db
    .select()
    .from(schema.resourceReservations)
    .where(and(eq(schema.resourceReservations.facilityId, actor.facilityId), eq(schema.resourceReservations.resourceType, "TEAM"), inArray(schema.resourceReservations.status, ["ACTIVE", "RELEASED"]), lt(schema.resourceReservations.startAt, to), gte(schema.resourceReservations.endAt, from)));
  const teams = await db.select().from(schema.workforceTeams).where(eq(schema.workforceTeams.facilityId, actor.facilityId));
  const teamUtil = teams.map((t) => {
    const busy = teamRes.filter((r) => r.resourceId === t.id).reduce((s, r) => s + Math.max(0, mins(r.endAt > to ? to : r.endAt, r.startAt < from ? from : r.startAt)), 0);
    const w = teamShiftWindow(t, from, f.timezone);
    const shiftMin = Math.max(1, mins(w.end > to ? to : w.end, w.start < from ? from : w.start));
    return { teamId: t.id, code: t.code, busyMin: Math.round(busy), utilization: Math.min(1, busy / shiftMin) };
  });
  const reviews = await db.select({ n: sql<number>`count(distinct ${schema.qualityReviews.shipmentId})::int` }).from(schema.qualityReviews).where(and(eq(schema.qualityReviews.facilityId, actor.facilityId), gte(schema.qualityReviews.createdAt, from), lte(schema.qualityReviews.createdAt, to)));
  const audit = await db
    .select({ eventType: schema.auditEvents.eventType, n: sql<number>`count(*)::int` })
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.facilityId, actor.facilityId), gte(schema.auditEvents.occurredAt, from), lte(schema.auditEvents.occurredAt, to)))
    .groupBy(schema.auditEvents.eventType);
  const count = (t: string) => audit.find((a) => a.eventType === t)?.n ?? 0;
  const holds = await db
    .select({ reasons: schema.readinessEvaluations.checks })
    .from(schema.readinessEvaluations)
    .where(and(eq(schema.readinessEvaluations.facilityId, actor.facilityId), gte(schema.readinessEvaluations.evaluatedAt, from), lte(schema.readinessEvaluations.evaluatedAt, to), sql`${schema.readinessEvaluations.outcome} <> 'READY'`));
  const bottlenecks: Record<string, number> = {};
  for (const h of holds) for (const c of h.reasons as { checkId: string; result: string; blocking: boolean }[]) if (c.result === "FAIL" && c.blocking) bottlenecks[c.checkId] = (bottlenecks[c.checkId] ?? 0) + 1;
  const scheduled = count("APPOINTMENT_SCHEDULED");
  const rescheduled = count("APPOINTMENT_RESCHEDULED");
  return {
    period: { from: from.toISOString(), to: to.toISOString(), minutes: Math.round(periodMin) },
    filters: q,
    dataSource: "OPERATIONAL_RECORDS",
    synthetic: true,
    summary: {
      trucksInPeriod: ts.length,
      throughput: departed.length,
      served: served.length,
      avgWaitingMin: avg(waits),
      p95WaitingMin: pct(waits, 95),
      avgTurnaroundMin: avg(tats),
      dockUtilization: avg(dockPerf.filter((d) => d.status === "AVAILABLE" || d.trucksServed > 0).map((d) => d.utilization)),
      resourceUtilization: avg(teamUtil.map((t) => t.utilization)),
      qualityReviewRate: ts.length ? (reviews[0]?.n ?? 0) / ts.length : null,
      scheduleStability: scheduled + rescheduled ? 1 - rescheduled / (scheduled + rescheduled) : null,
      reschedules: rescheduled,
      readinessHolds: holds.length,
      dockFailures: count("DOCK_FAILED"),
      releases: count("TRUCK_RELEASED"),
      overrides: count("RELEASE_OVERRIDDEN"),
      plansApproved: count("PLAN_APPROVED"),
    },
    bottlenecks: Object.entries(bottlenecks).map(([checkId, n]) => ({ checkId, count: n })).sort((a, b) => b.count - a.count),
    docks: dockPerf,
    teams: teamUtil,
    trucks: rows
      .map((r) => ({
        id: r.t.id,
        code: r.t.code,
        status: r.t.status,
        carrier: r.carrier,
        carrierAr: r.carrierAr,
        cargoType: r.cargoType,
        dock: r.dockCode,
        requestedArrival: r.t.requestedArrival,
        actualArrival: r.t.actualArrival,
        serviceStartedAt: r.t.serviceStartedAt,
        serviceCompletedAt: r.t.serviceCompletedAt,
        departedAt: r.t.departedAt,
        waitingMin: r.t.serviceStartedAt && r.t.actualArrival ? Math.round(mins(r.t.serviceStartedAt, r.t.actualArrival)) : null,
        turnaroundMin: r.t.departedAt && r.t.actualArrival ? Math.round(mins(r.t.departedAt, r.t.actualArrival)) : null,
        serviceEstimateMin: r.t.serviceEstimateMin,
        actualServiceMin: r.t.serviceCompletedAt && r.t.serviceStartedAt ? Math.round(mins(r.t.serviceCompletedAt, r.t.serviceStartedAt)) : null,
        quality: r.quality,
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
