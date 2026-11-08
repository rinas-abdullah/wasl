import { randomBytes } from "node:crypto";
import { addMinutes, tzOffsetMinutes, type CargoType, type HandlingMethod, type VehicleType } from "@wasl/shared";
import { schema, type Tx } from "../client";
import { planningTableEstimate } from "../../domain/estimates";
import { generateSeries, resolveThresholds, GENERATOR_VERSION, INTERVAL_SEC } from "../../domain/sensors/generator";
import { detectEvents } from "../../domain/sensors/detect";

/**
 * Seeds one demo facility with coherent, SYNTHETIC operational data anchored
 * to `now`. Every number shown in the UI for this facility is derived from
 * these rows (and whatever users do afterwards) — nothing is hard-coded in
 * the front end.
 */
export interface SeedRefs {
  orgId: string;
  carriers: Record<string, string>;
  drivers: Record<string, string>;
  users: Record<string, { id: string; name: string; role: string }>;
}

const hhmm = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export async function seedFacility(tx: Tx, refs: SeedRefs, nowIn = new Date()) {
  const tz = "Asia/Riyadh";
  const now = new Date(Math.floor(nowIn.getTime() / 300_000) * 300_000);
  const at = (m: number) => addMinutes(now, m);
  const actor = (key: string) => ({ userId: refs.users[key].id, name: refs.users[key].name, role: refs.users[key].role });

  const [facility] = await tx
    .insert(schema.facilities)
    .values({ orgId: refs.orgId, code: "RUH-DC1", name: "Riyadh Distribution Center (Demo)", nameAr: "مركز توزيع الرياض (تجريبي)", city: "Riyadh", timezone: tz, yardCapacity: 6, gateCapacityPerHour: 12, travelTimeMin: 15, congestionThreshold: 5, settings: { demo: true } })
    .returning();
  const F = facility.id;

  const docks = await tx
    .insert(schema.docks)
    .values([
      { facilityId: F, code: "D1", name: "Dock 1 · Reefer", position: 1, maxVehicleType: "REEFER_TRAILER", compatibleCargo: ["CHILLED", "FROZEN", "PHARMA", "GENERAL", "FRAGILE", "BULK"], features: ["REEFER", "LEVELER"] },
      { facilityId: F, code: "D2", name: "Dock 2 · Reefer", position: 2, maxVehicleType: "REEFER_TRAILER", compatibleCargo: ["CHILLED", "FROZEN", "GENERAL", "FRAGILE", "BULK"], features: ["REEFER", "LEVELER"] },
      { facilityId: F, code: "D3", name: "Dock 3 · General + Inspection bay", position: 3, maxVehicleType: "ARTICULATED", compatibleCargo: ["GENERAL", "FRAGILE", "BULK"], features: ["LEVELER", "INSPECTION_BAY"] },
      { facilityId: F, code: "D4", name: "Dock 4 · Side loading", position: 4, maxVehicleType: "ARTICULATED", compatibleCargo: ["GENERAL", "BULK"], features: ["SIDE_LOADING"], restrictions: "No fragile cargo (side-loading ramp)" },
    ])
    .returning();
  const D = Object.fromEntries(docks.map((d) => [d.code, d]));

  await tx.insert(schema.gates).values([
    { facilityId: F, code: "G-IN", type: "ENTRY", capacityPerHour: 12 },
    { facilityId: F, code: "G-OUT", type: "EXIT", capacityPerHour: 12 },
  ]);

  // Shifts are anchored around the seed time so the demo is meaningful whenever it is reset.
  const localMin = (d: Date) => {
    const off = tzOffsetMinutes(d, tz);
    return ((Math.floor(d.getTime() / 60_000) + off) % 1440 + 1440) % 1440;
  };
  // Wall-clock shift boundaries relative to the seed time; may cross midnight (overnight shifts are supported).
  const wall = (offsetMin: number) => {
    const m = (((localMin(now) + offsetMin) % 1440) + 1440) % 1440;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const teams = await tx
    .insert(schema.workforceTeams)
    .values([
      { facilityId: F, code: "T-A", name: "Team Alpha", nameAr: "الفريق أ", shiftStart: wall(-240), shiftEnd: wall(300), size: 5, skills: ["GENERAL_UNLOADING", "FORKLIFT_LICENSED", "COLD_CHAIN", "PHARMA_GDP"] },
      { facilityId: F, code: "T-B", name: "Team Bravo", nameAr: "الفريق ب", shiftStart: wall(-240), shiftEnd: wall(420), size: 4, skills: ["GENERAL_UNLOADING", "FORKLIFT_LICENSED", "FRAGILE_HANDLING"] },
      { facilityId: F, code: "T-C", name: "Team Charlie", nameAr: "الفريق ج", shiftStart: wall(-60), shiftEnd: wall(600), size: 4, skills: ["GENERAL_UNLOADING", "FORKLIFT_LICENSED", "COLD_CHAIN"] },
    ])
    .returning();
  const TM = Object.fromEntries(teams.map((t) => [t.code, t]));

  const eq = await tx
    .insert(schema.equipment)
    .values([
      { facilityId: F, code: "FL-01", type: "FORKLIFT", compatibleOperations: ["PALLET_UNLOADING"] },
      { facilityId: F, code: "FL-02", type: "FORKLIFT", compatibleOperations: ["PALLET_UNLOADING"] },
      { facilityId: F, code: "FL-03", type: "FORKLIFT", status: "MAINTENANCE", statusReason: "Scheduled battery service (demo)", compatibleOperations: ["PALLET_UNLOADING"] },
      { facilityId: F, code: "PJ-01", type: "PALLET_JACK", compatibleOperations: ["PALLET_UNLOADING", "SHORT_MOVES"] },
      { facilityId: F, code: "PJ-02", type: "PALLET_JACK", compatibleOperations: ["PALLET_UNLOADING", "SHORT_MOVES"] },
      { facilityId: F, code: "CL-01", type: "CLAMP_TRUCK", compatibleOperations: ["BULK_CLAMP"] },
    ])
    .returning();
  const EQ = Object.fromEntries(eq.map((e) => [e.code, e]));

  /* ---------------- audit helper ---------------- */
  let seq = 0;
  const audit = async (e: { at: Date; type: string; entityType: string; entityId: string; label: string; actorKey?: string; source?: string; payload?: Record<string, unknown>; prev?: Record<string, unknown> | null; next?: Record<string, unknown> | null }) => {
    seq++;
    const a = e.actorKey ? actor(e.actorKey) : null;
    await tx.insert(schema.auditEvents).values({
      orgId: refs.orgId,
      facilityId: F,
      eventType: e.type,
      entityType: e.entityType,
      entityId: e.entityId,
      entityLabel: e.label,
      actorId: a?.userId ?? null,
      actorLabel: a ? `${a.name} (${a.role})` : e.source ?? "SEED",
      source: e.source ?? (a ? "USER" : "SEED"),
      payload: { ...(e.payload ?? {}), seeded: true },
      correlationId: crypto.randomUUID(),
      previousState: e.prev ?? null,
      newState: e.next ?? null,
      occurredAt: e.at,
    });
  };

  // Facility history: D4 maintenance earlier today (a past dock-disruption scenario)
  await audit({ at: at(-260), type: "DOCK_MAINTENANCE_SCHEDULED", entityType: "dock", entityId: D.D4.id, label: "D4", actorKey: "ops", payload: { reason: "Leveler inspection (demo history)" }, prev: { status: "AVAILABLE" }, next: { status: "MAINTENANCE" } });
  await audit({ at: at(-200), type: "DOCK_RESTORED", entityType: "dock", entityId: D.D4.id, label: "D4", actorKey: "ops", payload: { reason: "Inspection complete" }, prev: { status: "MAINTENANCE" }, next: { status: "AVAILABLE" } });
  for (const d of docks) if (d.code !== "D4") await audit({ at: at(-330), type: "DOCK_RESTORED", entityType: "dock", entityId: d.id, label: d.code, source: "SEED", payload: { note: "initial state" }, next: { status: "AVAILABLE" } });

  /* ---------------- trucks ---------------- */
  interface Spec {
    code: string;
    carrier: string;
    driver?: string;
    plate: string;
    vehicle: VehicleType;
    cargo: CargoType;
    pallets: number;
    weight: number;
    handling: HandlingMethod;
    dock: string | null;
    requested: number;
    confirmed: number | null;
    status: "DEPARTED" | "IN_SERVICE" | "WAITING" | "SCHEDULED" | "REGISTERED";
    arrived?: number;
    started?: number;
    completed?: number;
    departed?: number;
    team?: string;
    equipment?: string;
    docs?: boolean;
    priority?: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
    conditions?: Record<string, number>;
    notes?: string;
  }
  const specs: Spec[] = [
    { code: "WSL-1001", carrier: "NAJD", driver: "DRV-002", plate: "RUH 1427 (demo)", vehicle: "ARTICULATED", cargo: "GENERAL", pallets: 18, weight: 9800, handling: "FORKLIFT_PALLET", dock: "D2", requested: -205, confirmed: -205, status: "DEPARTED", arrived: -200, started: -188, completed: -150, departed: -140, team: "T-B", equipment: "FL-01" },
    { code: "WSL-1002", carrier: "EAST", driver: "DRV-005", plate: "DMM 8821 (demo)", vehicle: "REEFER_TRAILER", cargo: "CHILLED", pallets: 22, weight: 11200, handling: "FORKLIFT_PALLET", dock: "D1", requested: -175, confirmed: -175, status: "DEPARTED", arrived: -172, started: -160, completed: -112, departed: -100, team: "T-A", equipment: "FL-02", conditions: { tempMinC: 2, tempMaxC: 8 } },
    { code: "WSL-1003", carrier: "REDSEA", driver: "DRV-003", plate: "JED 5530 (demo)", vehicle: "ARTICULATED", cargo: "GENERAL", pallets: 24, weight: 12400, handling: "FORKLIFT_PALLET", dock: "D3", requested: -55, confirmed: -55, status: "IN_SERVICE", arrived: -50, started: -35, team: "T-B", equipment: "FL-01" },
    { code: "WSL-1004", carrier: "EAST", driver: "DRV-006", plate: "DMM 9104 (demo)", vehicle: "REEFER_TRAILER", cargo: "FROZEN", pallets: 20, weight: 10100, handling: "FORKLIFT_PALLET", dock: "D1", requested: -35, confirmed: -35, status: "IN_SERVICE", arrived: -30, started: -20, team: "T-A", equipment: "FL-02", conditions: { tempMinC: -25, tempMaxC: -15 } },
    { code: "WSL-1005", carrier: "QASSIM", driver: "DRV-008", plate: "QSM 3318 (demo)", vehicle: "RIGID", cargo: "FRAGILE", pallets: 14, weight: 5200, handling: "PALLET_JACK", dock: "D2", requested: -15, confirmed: -10, status: "WAITING", arrived: -15, priority: "HIGH", notes: "Glassware — fragile handling crew required" },
    { code: "WSL-1006", carrier: "NAJD", driver: "DRV-001", plate: "RUH 2210 (demo)", vehicle: "ARTICULATED", cargo: "GENERAL", pallets: 16, weight: 8700, handling: "FORKLIFT_PALLET", dock: "D3", requested: 30, confirmed: 40, status: "SCHEDULED" },
    { code: "WSL-1007", carrier: "EAST", driver: "DRV-007", plate: "DMM 4472 (demo)", vehicle: "REEFER_TRAILER", cargo: "PHARMA", pallets: 10, weight: 3900, handling: "PALLET_JACK", dock: "D1", requested: 70, confirmed: 70, status: "SCHEDULED", priority: "HIGH", conditions: { tempMinC: 2, tempMaxC: 8, humidityMaxPct: 65, shockMaxG: 2.5 } },
    { code: "WSL-1008", carrier: "REDSEA", driver: "DRV-004", plate: "JED 7781 (demo)", vehicle: "ARTICULATED", cargo: "BULK", pallets: 26, weight: 18500, handling: "CLAMP", dock: "D3", requested: 90, confirmed: 95, status: "SCHEDULED" },
    { code: "WSL-1009", carrier: "QASSIM", driver: "DRV-009", plate: "QSM 6002 (demo)", vehicle: "VAN", cargo: "GENERAL", pallets: 8, weight: 2100, handling: "MANUAL", dock: null, requested: 150, confirmed: null, status: "REGISTERED", priority: "LOW" },
    { code: "WSL-1010", carrier: "NAJD", driver: "DRV-010", plate: "RUH 9035 (demo)", vehicle: "REEFER_TRAILER", cargo: "CHILLED", pallets: 18, weight: 9300, handling: "FORKLIFT_PALLET", dock: "D2", requested: 120, confirmed: 120, status: "SCHEDULED", docs: false, conditions: { tempMinC: 2, tempMaxC: 8 }, notes: "Customs release document pending" },
  ];

  const created: Record<string, { truckId: string; shipmentId: string }> = {};
  for (const s of specs) {
    const est = planningTableEstimate({ cargoType: s.cargo, palletCount: s.pallets, handlingMethod: s.handling, vehicleType: s.vehicle, teamSize: 4, dockHasLeveler: true, inspectionRequired: false });
    const inspection = s.cargo === "PHARMA";
    const [shipment] = await tx
      .insert(schema.shipments)
      .values({ orgId: refs.orgId, facilityId: F, reference: `SHP-${s.code.slice(4)}`, cargoType: s.cargo, palletCount: s.pallets, weightKg: s.weight, handlingMethod: s.handling, documentsComplete: s.docs ?? true, inspectionRequired: inspection, requiredConditions: s.conditions ?? {}, createdAt: at(-320) })
      .returning();
    const actualStart = s.started !== undefined ? at(s.started) : null;
    const [truck] = await tx
      .insert(schema.trucks)
      .values({
        orgId: refs.orgId,
        facilityId: F,
        code: s.code,
        plateNumber: s.plate,
        carrierId: refs.carriers[s.carrier],
        driverId: s.driver ? refs.drivers[s.driver] : null,
        shipmentId: shipment.id,
        vehicleType: s.vehicle,
        status: s.status,
        priority: s.priority ?? "NORMAL",
        notes: s.notes ?? null,
        requestedArrival: at(s.requested),
        actualArrival: s.arrived !== undefined ? at(s.arrived) : null,
        assignedDockId: s.dock ? D[s.dock].id : null,
        serviceEstimateMin: est.minutes,
        serviceEstimateSource: est.source,
        calledAt: s.started !== undefined ? at((s.arrived ?? 0) - 15) : null,
        serviceStartedAt: actualStart,
        serviceCompletedAt: s.completed !== undefined ? at(s.completed) : null,
        departedAt: s.departed !== undefined ? at(s.departed) : null,
        createdAt: at(-320),
      })
      .returning();
    created[s.code] = { truckId: truck.id, shipmentId: shipment.id };
    const lifecycleDone = ["DEPARTED"].includes(s.status);
    await tx.insert(schema.appointments).values({
      facilityId: F,
      truckId: truck.id,
      dockId: s.dock ? D[s.dock].id : null,
      status: s.confirmed === null ? "REQUESTED" : lifecycleDone ? "COMPLETED" : "CONFIRMED",
      requestedStart: at(s.requested),
      proposedStart: s.confirmed !== null ? at(s.confirmed) : null,
      confirmedStart: s.confirmed !== null ? at(s.confirmed) : null,
      durationMin: est.minutes,
      source: s.carrier === "QASSIM" ? "CARRIER_REQUEST" : "MANUAL",
    });

    // History events (event-sourced replay depends on newState snapshots)
    await audit({ at: at(-320 + seq % 7), type: "TRUCK_CREATED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: s.carrier === "NAJD" ? "carrier" : "ops", payload: { cargoType: s.cargo, pallets: s.pallets, estimate: est }, next: { status: "REGISTERED", assignedDockId: null, actualArrival: null } });
    if (s.confirmed !== null) {
      await audit({ at: at(-300 + (seq % 11)), type: "APPOINTMENT_SCHEDULED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: "ops", payload: { dockId: D[s.dock!].id, dockCode: s.dock, confirmedStart: at(s.confirmed) }, prev: { status: "REGISTERED" }, next: { status: "SCHEDULED", assignedDockId: D[s.dock!].id, actualArrival: null } });
    }
    if (s.started !== undefined) {
      const callAt = at(s.arrived! - 15);
      const windowEnd = addMinutes(actualStart!, est.minutes);
      const resEnd = s.completed !== undefined ? at(s.completed) : windowEnd;
      const [ev] = await tx
        .insert(schema.readinessEvaluations)
        .values({ facilityId: F, truckId: truck.id, outcome: "READY", proposedCallTime: callAt, checks: [], inputSnapshot: { seeded: true }, result: { seeded: true, summary: "Seeded historical release (all mandatory checks passed at the time)" }, engineVersion: "seed", evaluatedBy: refs.users.dock.id, evaluatedAt: callAt })
        .returning();
      const [dec] = await tx
        .insert(schema.decisions)
        .values({ facilityId: F, truckId: truck.id, readinessEvaluationId: ev.id, type: "RELEASE", status: "EXECUTED", outcome: "READY", reasons: [{ en: `Released to ${s.dock} at ${hhmm(callAt, tz)} (seeded history)`, ar: `استدعاء إلى ${s.dock} عند ${hhmm(callAt, tz)} (سجل تجريبي)` }], actorId: refs.users.dock.id, createdAt: callAt, resolvedAt: callAt, executionResult: { seeded: true } })
        .returning();
      const status = s.status === "IN_SERVICE" ? "ACTIVE" : "RELEASED";
      await tx.insert(schema.resourceReservations).values([
        { facilityId: F, resourceType: "DOCK", resourceId: D[s.dock!].id, truckId: truck.id, decisionId: dec.id, startAt: actualStart!, endAt: resEnd, status },
        { facilityId: F, resourceType: "TEAM", resourceId: TM[s.team!].id, truckId: truck.id, decisionId: dec.id, startAt: actualStart!, endAt: resEnd, status },
        { facilityId: F, resourceType: "EQUIPMENT", resourceId: EQ[s.equipment!].id, truckId: truck.id, decisionId: dec.id, startAt: actualStart!, endAt: resEnd, status },
      ]);
      await audit({ at: callAt, type: "TRUCK_RELEASED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: "dock", source: "READINESS_ENGINE", payload: { decisionId: dec.id, dockId: D[s.dock!].id }, prev: { status: "SCHEDULED" }, next: { status: "CALLED", assignedDockId: D[s.dock!].id } });
      await audit({ at: at(s.arrived!), type: "TRUCK_ARRIVED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: "dock", payload: { action: "MARK_ARRIVAL" }, prev: { status: "CALLED" }, next: { status: "ARRIVED", actualArrival: at(s.arrived!).toISOString() } });
      await audit({ at: actualStart!, type: "SERVICE_STARTED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: "dock", payload: { action: "START_SERVICE" }, prev: { status: "ARRIVED" }, next: { status: "IN_SERVICE" } });
      const ho = { facilityId: F, shipmentId: shipment.id, truckId: truck.id, reference: `HO-${s.code.slice(4)}-${randomBytes(2).toString("hex").toUpperCase()}`, qrToken: randomBytes(24).toString("base64url"), status: (s.status === "DEPARTED" ? "CLOSED" : "UNLOADING") as "CLOSED" | "UNLOADING", createdAt: callAt };
      const [h] = await tx.insert(schema.handoverRecords).values(ho).returning();
      const steps: [string, string, string, number][] = [
        ["CONFIRM_ARRIVAL", "PENDING_ARRIVAL", "ARRIVAL_CONFIRMED", s.arrived!],
        ["START_UNLOADING", "ARRIVAL_CONFIRMED", "UNLOADING", s.started],
        ...(s.status === "DEPARTED" ? ([["APPROVE_HANDOVER", "UNLOADING", "APPROVED", s.completed!], ["CLOSE_OPERATION", "APPROVED", "CLOSED", s.departed!]] as [string, string, string, number][]) : []),
      ];
      for (const [action, from, to, m] of steps) {
        await tx.insert(schema.handoverActions).values({ handoverId: h.id, action, previousStatus: from as never, newStatus: to as never, actorId: refs.users.dock.id, idempotencyKey: `seed:${action}`, at: at(m), notes: "Seeded history" });
      }
      if (s.completed !== undefined) {
        await audit({ at: at(s.completed), type: "SERVICE_COMPLETED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: "dock", payload: { action: "COMPLETE_SERVICE" }, prev: { status: "IN_SERVICE" }, next: { status: "COMPLETED" } });
        await audit({ at: at(s.completed + 2), type: "HANDOVER_APPROVED", entityType: "handover", entityId: h.id, label: ho.reference, actorKey: "dock", payload: { truckCode: s.code }, prev: { status: "UNLOADING" }, next: { status: "APPROVED" } });
        await audit({ at: at(s.departed!), type: "TRUCK_DEPARTED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: "dock", payload: { action: "REGISTER_DEPARTURE" }, prev: { status: "COMPLETED" }, next: { status: "DEPARTED" } });
      }
    } else if (s.status === "WAITING") {
      await audit({ at: at(s.arrived!), type: "TRUCK_ARRIVED", entityType: "truck", entityId: truck.id, label: s.code, actorKey: "dock", payload: { action: "MARK_ARRIVAL", note: "arrived before release → yard" }, prev: { status: "SCHEDULED" }, next: { status: "WAITING", actualArrival: at(s.arrived!).toISOString() } });
    }
  }

  /* ---------------- sensor + quality history ---------------- */
  // (a) Normal journey for the departed chilled load — no excursion observed (which is NOT proof of product safety).
  // (b) Temperature excursion on WSL-1010 → open quality review (REVIEW_REQUIRED) that affects readiness.
  const sensorSeed = async (code: string, scenario: "NORMAL" | "TEMP_EXCURSION", seed: number, endOffset: number) => {
    const sh = created[code].shipmentId;
    const spec = specs.find((x) => x.code === code)!;
    const th = resolveThresholds(spec.cargo, spec.conditions ?? {});
    const end = at(endOffset);
    const series = generateSeries(scenario, seed, end, 300, th);
    const [stream] = await tx.insert(schema.sensorStreams).values({ facilityId: F, shipmentId: sh, scenario, seed, generatorVersion: GENERATOR_VERSION, intervalSec: INTERVAL_SEC, startAt: series.readings[0].ts, endAt: end, thresholds: th as Record<string, number>, createdBy: refs.users.quality.id, createdAt: end }).returning();
    await tx.insert(schema.sensorReadings).values(series.readings.map((r) => ({ streamId: stream.id, ...r })));
    const det = detectEvents(series.readings, th);
    const evs = det.length ? await tx.insert(schema.sensorEvents).values(det.map((d) => ({ streamId: stream.id, shipmentId: sh, type: d.type, ruleId: d.ruleId, startedAt: d.startedAt, endedAt: d.endedAt, peakValue: d.peakValue, threshold: d.threshold, readingsCount: d.readingsCount, severity: d.severity, requiresReview: d.requiresReview, createdAt: end }))).returning() : [];
    await audit({ at: end, type: "SENSOR_SCENARIO_GENERATED", entityType: "shipment", entityId: sh, label: `SHP-${code.slice(4)}`, actorKey: "quality", source: "SENSOR_ENGINE", payload: { scenario, seed, detected: det.map((d) => d.type) } });
    return { det, evs, sh, truckId: created[code].truckId, end };
  };
  await sensorSeed("WSL-1002", "NORMAL", 1002, -175);
  const exc = await sensorSeed("WSL-1010", "TEMP_EXCURSION", 1010, -25);
  if (exc.evs.length) {
    const [rev] = await tx
      .insert(schema.qualityReviews)
      .values({
        facilityId: F,
        shipmentId: exc.sh,
        truckId: exc.truckId,
        status: "REVIEW_REQUIRED",
        trigger: "SENSOR_EVENT",
        sensorEventIds: exc.evs.map((e) => e.id),
        violations: exc.det.map((d) => ({ type: d.type, ruleId: d.ruleId, severity: d.severity, description: d.description, descriptionAr: d.descriptionAr, peak: d.peakValue, threshold: d.threshold })),
        history: [{ at: exc.end.toISOString(), actor: "SENSOR_ENGINE", from: null, to: "REVIEW_REQUIRED", notes: "Seeded: virtual sensor temperature excursion" }],
        createdAt: exc.end,
      })
      .returning();
    await tx.update(schema.shipments).set({ qualityStatus: "REVIEW_REQUIRED", inspectionRequired: true }).where(eqId(exc.sh));
    await audit({ at: exc.end, type: "QUALITY_ALERT_CREATED", entityType: "shipment", entityId: exc.sh, label: "SHP-1010", source: "SENSOR_ENGINE", payload: { reviewId: rev.id, trigger: "SENSOR_EVENT" }, prev: { qualityStatus: "NO_ISSUE_OBSERVED" }, next: { qualityStatus: "REVIEW_REQUIRED", inspectionRequired: true } });
    await tx.insert(schema.notifications).values({ orgId: refs.orgId, facilityId: F, targetRoles: ["QUALITY_OFFICER", "OPERATIONS_MANAGER", "SUPER_ADMIN"], type: "QUALITY_REVIEW_REQUIRED", severity: "HIGH", title: "Quality review required: SHP-1010 (WSL-1010)", titleAr: "مطلوب مراجعة جودة: SHP-1010 (WSL-1010)", body: "Virtual sensor temperature excursion detected (synthetic). Readiness requires a quality officer to start the review.", bodyAr: "رُصد تجاوز حراري من حساس افتراضي (بيانات اصطناعية). تتطلب الجاهزية بدء المراجعة من مسؤول الجودة.", entityType: "quality_review", entityId: rev.id, actionRequired: true, createdAt: exc.end });
  }
  await tx.insert(schema.notifications).values({ orgId: refs.orgId, facilityId: F, targetRoles: ["OPERATIONS_MANAGER", "ORGANIZATION_ADMIN", "DOCK_SUPERVISOR", "SUPER_ADMIN"], type: "RESOURCE_SHORTAGE", severity: "LOW", title: "FL-03 in scheduled maintenance", titleAr: "الرافعة FL-03 في صيانة مجدولة", body: "Forklift capacity reduced to 2 units.", bodyAr: "انخفضت سعة الرافعات الشوكية إلى وحدتين.", entityType: "equipment", entityId: EQ["FL-03"].id, createdAt: at(-240) });

  return { facilityId: F, docks: D, trucks: created };
}

import { eq as eqOp } from "drizzle-orm";
const eqId = (id: string) => eqOp(schema.shipments.id, id);
