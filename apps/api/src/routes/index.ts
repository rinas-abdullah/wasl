import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  appointmentScheduleSchema,
  appointmentValidateSchema,
  bulkTransitionSchema,
  dockStatusSchema,
  dockUpdateSchema,
  equipmentStatusSchema,
  eventListQuery,
  facilitySettingsSchema,
  handoverActionSchema,
  loginSchema,
  optimizationRunSchema,
  planDecisionSchema,
  qualityActionSchema,
  readinessEvaluateSchema,
  releaseSchema,
  reportQuery,
  ROLE_PERMISSIONS,
  sensorScenarioSchema,
  simulationRunSchema,
  teamStatusSchema,
  teamUpdateSchema,
  truckCreateSchema,
  truckListQuery,
  truckTransitionSchema,
  truckUpdateSchema,
  userCreateSchema,
  userRoleSchema,
} from "@wasl/shared";
import { db, schema } from "../db/client";
import { route } from "../http/route";
import { createSession, destroySession, verifyCredentials } from "../http/auth";
import { badRequest, notFound, unauthorized } from "../http/errors";
import { config } from "../config";
import { recordEvent } from "../domain/audit";
import * as trucks from "../domain/trucks";
import * as ops from "../domain/operations";
import * as readiness from "../domain/readiness/service";
import * as opt from "../domain/optimization";
import * as sim from "../domain/simulation";
import * as quality from "../domain/quality";
import * as sensors from "../domain/sensors/service";
import * as handover from "../domain/handover";
import * as analytics from "../domain/analytics";
import * as admin from "../domain/admin";
import { listModels } from "../domain/models";
import { intelHealthy } from "../intel/client";
import { pool } from "../db/client";

const idParam = z.object({ id: z.uuid() });

export function registerRoutes(app: FastifyInstance) {
  /* ---------------- health ---------------- */
  route(app, { method: "GET", url: "/api/health", summary: "Liveness & dependency health", tags: ["system"], permission: null, public: true }, async () => {
    let dbOk = true;
    try {
      await pool.query("select 1");
    } catch {
      dbOk = false;
    }
    const intel = await intelHealthy();
    return { status: dbOk ? (intel ? "ok" : "degraded") : "down", database: dbOk, intelligence: intel, demoMode: config.demoMode, time: new Date().toISOString() };
  });

  /* ---------------- auth ---------------- */
  route(app, { method: "POST", url: "/api/auth/login", summary: "Sign in (sets HttpOnly session cookie)", tags: ["auth"], permission: null, public: true, body: loginSchema, rateLimit: { max: config.rateLimitLogin, timeWindow: "1 minute" } }, async ({ body, req, reply }) => {
    const user = await verifyCredentials(body.email, body.password);
    if (!user) throw unauthorized("Invalid email or password");
    const { csrfToken, membership } = await createSession(req, reply, user.id, body.remember);
    await recordEvent(db, { orgId: membership.orgId, facilityId: null, eventType: "AUTH_LOGIN", entityType: "user", entityId: user.id, entityLabel: user.email, actor: { userId: user.id, name: user.name, role: membership.role }, source: "USER", payload: { ip: req.ip } });
    return { ok: true, csrfToken };
  });

  route(app, { method: "POST", url: "/api/auth/logout", summary: "Sign out", tags: ["auth"], permission: null }, async ({ req, reply }) => {
    await destroySession(req, reply);
    return { ok: true };
  });

  route(app, { method: "GET", url: "/api/auth/me", summary: "Current user, role, permissions, facility and CSRF token", tags: ["auth"], permission: null }, async ({ actor, req }) => {
    const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, actor.facilityId));
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, actor.orgId));
    return {
      user: { id: actor.userId, name: actor.name, email: actor.email, isDemo: actor.isDemo },
      role: actor.role,
      permissions: ROLE_PERMISSIONS[actor.role],
      organization: { id: org.id, name: org.name, nameAr: org.nameAr, isDemo: org.isDemo },
      facility: { id: facility.id, code: facility.code, name: facility.name, nameAr: facility.nameAr, timezone: facility.timezone },
      carrierId: actor.carrierId,
      driverId: actor.driverId,
      csrfToken: (req as unknown as { csrfToken: string }).csrfToken,
      demoMode: config.demoMode && org.isDemo,
    };
  });

  route(app, { method: "GET", url: "/api/facilities", summary: "Facilities of the current organisation", tags: ["organization"], permission: null }, async ({ actor }) => admin.listFacilities(actor));

  route(app, { method: "POST", url: "/api/session/facility", summary: "Switch the active facility (must belong to the organisation)", tags: ["organization"], permission: null, body: z.object({ facilityId: z.uuid() }) }, async ({ actor, body }) => {
    const [f] = await db.select().from(schema.facilities).where(and(eq(schema.facilities.id, body.facilityId), eq(schema.facilities.orgId, actor.orgId)));
    if (!f) throw notFound("Facility");
    await db.update(schema.sessions).set({ facilityId: f.id }).where(eq(schema.sessions.id, actor.sessionId));
    return { facilityId: f.id };
  });

  /* ---------------- reference data ---------------- */
  route(app, { method: "GET", url: "/api/carriers", summary: "Carriers (scoped for carrier roles)", tags: ["reference"], permission: "trucks:read" }, async ({ actor }) => {
    const rows = await db.select().from(schema.carriers).where(and(eq(schema.carriers.orgId, actor.orgId), actor.carrierId && (actor.role === "CARRIER_OPERATOR" || actor.role === "DRIVER") ? eq(schema.carriers.id, actor.carrierId) : undefined)).orderBy(schema.carriers.code);
    const drivers = await db.select().from(schema.drivers).where(eq(schema.drivers.orgId, actor.orgId));
    return rows.map((c) => ({ ...c, drivers: drivers.filter((d) => d.carrierId === c.id).map((d) => ({ id: d.id, reference: d.reference, displayName: d.displayName })) }));
  });

  route(app, { method: "GET", url: "/api/shipments", summary: "Shipments with quality status (for sensors/quality)", tags: ["reference"], permission: "quality:read" }, async ({ actor }) => {
    return db
      .select({ s: schema.shipments, truckId: schema.trucks.id, truckCode: schema.trucks.code, truckStatus: schema.trucks.status })
      .from(schema.shipments)
      .leftJoin(schema.trucks, eq(schema.trucks.shipmentId, schema.shipments.id))
      .where(eq(schema.shipments.facilityId, actor.facilityId))
      .orderBy(schema.shipments.reference)
      .then((r) => r.map((x) => ({ ...x.s, truckId: x.truckId, truckCode: x.truckCode, truckStatus: x.truckStatus })));
  });

  /* ---------------- dashboard / twin ---------------- */
  route(app, { method: "GET", url: "/api/dashboard/overview", summary: "Operational KPIs derived from stored records", tags: ["dashboard"], permission: "dashboard:read" }, async ({ actor }) => analytics.dashboardOverview(actor));
  route(app, { method: "GET", url: "/api/dashboard/congestion-risk", summary: "Congestion risk (Model 02) for the next 2 hours", tags: ["dashboard", "models"], permission: "dashboard:read" }, async ({ actor }) => analytics.congestionRisk(actor));
  route(app, { method: "GET", url: "/api/twin/state", summary: "Digital twin live state", tags: ["twin"], permission: "dashboard:read" }, async ({ actor }) => analytics.twinState(actor));
  route(app, { method: "GET", url: "/api/twin/replay", summary: "Event-sourced replay of the operations log", tags: ["twin"], permission: "events:read", query: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }) }, async ({ actor, query }) => analytics.twinReplay(actor, new Date(query.from), new Date(query.to)));

  /* ---------------- trucks ---------------- */
  route(app, { method: "GET", url: "/api/trucks", summary: "List trucks (server-side filter, sort, pagination)", tags: ["trucks"], permission: "trucks:read", query: truckListQuery }, async ({ actor, query }) => trucks.listTrucks(actor, query));
  route(app, { method: "POST", url: "/api/trucks", summary: "Register a truck with its shipment", tags: ["trucks"], permission: "trucks:create", body: truckCreateSchema, idempotency: "optional" }, async ({ actor, body, reply }) => {
    reply.code(201);
    return trucks.createTruck(actor, body);
  });
  route(app, { method: "GET", url: "/api/trucks/export.csv", summary: "Export trucks as CSV (current filters)", tags: ["trucks"], permission: "trucks:read", query: truckListQuery }, async ({ actor, query, reply }) => {
    const data = await trucks.listTrucks(actor, { ...query, page: 1, pageSize: 200 });
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="wasl-trucks.csv"`);
    return reply.send(
      analytics.toCsv(
        data.items.map((t) => ({ code: t.code, plate: t.plateNumber, carrier: t.carrier.name, status: t.status, priority: t.priority, vehicle: t.vehicleType, cargo: t.shipment.cargoType, pallets: t.shipment.palletCount, dock: t.dock?.code ?? "", requested: t.requestedArrival, confirmed: t.appointment?.confirmedStart ?? "", actualArrival: t.actualArrival ?? "", estimateMin: t.serviceEstimateMin, estimateSource: t.serviceEstimateSource, quality: t.shipment.qualityStatus })),
      ),
    );
  });
  route(app, { method: "GET", url: "/api/trucks/:id", summary: "Truck detail with shipment, appointments, reservations, readiness, events", tags: ["trucks"], permission: "trucks:read", params: idParam }, async ({ actor, params }) => trucks.getTruckDetail(actor, params.id));
  route(app, { method: "PATCH", url: "/api/trucks/:id", summary: "Edit truck/shipment (optimistic concurrency via version)", tags: ["trucks"], permission: "trucks:update", params: idParam, body: truckUpdateSchema }, async ({ actor, params, body }) => trucks.updateTruck(actor, params.id, body));
  route(app, { method: "POST", url: "/api/trucks/:id/transitions", summary: "Apply a lifecycle action (state machine enforced)", tags: ["trucks"], permission: "trucks:transition", params: idParam, body: truckTransitionSchema, idempotency: "optional" }, async ({ actor, params, body }) => {
    if (body.action === "CANCEL" && !actor.permissions.includes("trucks:cancel")) throw badRequest("FORBIDDEN_ACTION", "Permission 'trucks:cancel' is required");
    return trucks.transitionTruck(actor, params.id, body.action, { version: body.version, reason: body.reason });
  });
  route(app, { method: "POST", url: "/api/trucks/bulk-transitions", summary: "Bulk lifecycle action (each truck validated individually)", tags: ["trucks"], permission: "trucks:transition", body: bulkTransitionSchema }, async ({ actor, body }) => trucks.bulkTransition(actor, body.truckIds, body.action, body.reason ?? null));
  // Carrier operators can cancel their own requests without the generic transition permission.
  route(app, { method: "POST", url: "/api/trucks/:id/cancel", summary: "Cancel a truck request", tags: ["trucks"], permission: "trucks:cancel", params: idParam, body: z.object({ version: z.number().int(), reason: z.string().min(3).max(500) }) }, async ({ actor, params, body }) => trucks.transitionTruck(actor, params.id, "CANCEL", { version: body.version, reason: body.reason }));

  /* ---------------- appointments ---------------- */
  route(app, { method: "GET", url: "/api/appointments", summary: "Appointments in a time window (calendar / dock timeline)", tags: ["appointments"], permission: "trucks:read", query: z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }) }, async ({ actor, query }) => {
    const rows = await db
      .select({ a: schema.appointments, truck: schema.trucks, cargoType: schema.shipments.cargoType, qualityStatus: schema.shipments.qualityStatus, carrier: schema.carriers.name, carrierAr: schema.carriers.nameAr })
      .from(schema.appointments)
      .innerJoin(schema.trucks, eq(schema.trucks.id, schema.appointments.truckId))
      .innerJoin(schema.shipments, eq(schema.shipments.id, schema.trucks.shipmentId))
      .innerJoin(schema.carriers, eq(schema.carriers.id, schema.trucks.carrierId))
      .where(and(eq(schema.appointments.facilityId, actor.facilityId), isNull(schema.trucks.deletedAt), trucks.truckScope(actor), sql`coalesce(${schema.appointments.confirmedStart}, ${schema.appointments.proposedStart}, ${schema.appointments.requestedStart}) between ${new Date(query.from)} and ${new Date(query.to)}`, sql`${schema.appointments.status} <> 'CANCELLED'`));
    const resv = await db
      .select()
      .from(schema.resourceReservations)
      .where(and(eq(schema.resourceReservations.facilityId, actor.facilityId), eq(schema.resourceReservations.resourceType, "DOCK"), sql`${schema.resourceReservations.status} in ('ACTIVE','RELEASED')`, sql`${schema.resourceReservations.endAt} > ${new Date(query.from)} and ${schema.resourceReservations.startAt} < ${new Date(query.to)}`));
    return {
      appointments: rows.map((r) => ({ ...r.a, truck: { id: r.truck.id, code: r.truck.code, status: r.truck.status, version: r.truck.version, vehicleType: r.truck.vehicleType, priority: r.truck.priority, actualArrival: r.truck.actualArrival, serviceStartedAt: r.truck.serviceStartedAt, serviceCompletedAt: r.truck.serviceCompletedAt, assignedDockId: r.truck.assignedDockId, reassignmentRequired: r.truck.reassignmentRequired }, cargoType: r.cargoType, qualityStatus: r.qualityStatus, carrier: r.carrier, carrierAr: r.carrierAr })),
      reservations: resv,
    };
  });
  route(app, { method: "POST", url: "/api/appointments/validate", summary: "Validate a slot without saving (conflict detection)", tags: ["appointments"], permission: "appointments:manage", body: appointmentValidateSchema }, async ({ actor, body }) => {
    const { truck: _t, dock: _d, ...v } = await ops.validateSlot(db, actor, body);
    return v;
  });
  route(app, { method: "POST", url: "/api/appointments", summary: "Confirm or reschedule an appointment (server-validated)", tags: ["appointments"], permission: "appointments:manage", body: appointmentScheduleSchema }, async ({ actor, body }) => ops.scheduleAppointment(actor, body));

  /* ---------------- docks & resources ---------------- */
  route(app, { method: "GET", url: "/api/docks", summary: "Docks with effective status, workload and availability", tags: ["docks"], permission: "docks:read" }, async ({ actor }) => ops.listDocks(actor));
  route(app, { method: "PATCH", url: "/api/docks/:id/status", summary: "Disable / restore / maintenance (cascades to trucks, plans, alerts)", tags: ["docks"], permission: "docks:manage", params: idParam, body: dockStatusSchema }, async ({ actor, params, body }) => ops.setDockStatus(actor, params.id, body));
  route(app, { method: "PATCH", url: "/api/docks/:id", summary: "Edit dock capabilities", tags: ["docks"], permission: "resources:manage", params: idParam, body: dockUpdateSchema }, async ({ actor, params, body }) => {
    const [d] = await db.update(schema.docks).set({ ...body, updatedAt: new Date() }).where(and(eq(schema.docks.id, params.id), eq(schema.docks.facilityId, actor.facilityId))).returning();
    if (!d) throw notFound("Dock");
    await recordEvent(db, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "SETTINGS_UPDATED", entityType: "dock", entityId: d.id, entityLabel: d.code, actor, source: "USER", payload: body });
    return d;
  });
  route(app, { method: "GET", url: "/api/resources", summary: "Teams, equipment and time-bounded reservations (with conflicts)", tags: ["resources"], permission: "resources:read" }, async ({ actor }) => {
    const [teams, equipment, reservations] = await Promise.all([
      db.select().from(schema.workforceTeams).where(eq(schema.workforceTeams.facilityId, actor.facilityId)).orderBy(schema.workforceTeams.code),
      db.select().from(schema.equipment).where(eq(schema.equipment.facilityId, actor.facilityId)).orderBy(schema.equipment.code),
      db
        .select({ r: schema.resourceReservations, truckCode: schema.trucks.code, truckStatus: schema.trucks.status })
        .from(schema.resourceReservations)
        .innerJoin(schema.trucks, eq(schema.trucks.id, schema.resourceReservations.truckId))
        .where(and(eq(schema.resourceReservations.facilityId, actor.facilityId), sql`${schema.resourceReservations.endAt} > now() - interval '12 hours'`))
        .orderBy(schema.resourceReservations.startAt),
    ]);
    const list = reservations.map((x) => ({ ...x.r, truckCode: x.truckCode, truckStatus: x.truckStatus }));
    // Conflicts: overlapping ACTIVE reservations on one resource (should be impossible thanks to the EXCLUDE constraint) and
    // ACTIVE reservations on resources that are currently unavailable.
    const conflicts = list
      .filter((r) => r.status === "ACTIVE")
      .flatMap((r) => {
        const out: { reservationId: string; truckCode: string; type: string; message: string }[] = [];
        if (r.resourceType === "TEAM" && teams.find((t) => t.id === r.resourceId)?.status !== "AVAILABLE") out.push({ reservationId: r.id, truckCode: r.truckCode, type: "RESOURCE_UNAVAILABLE", message: "Team is unavailable" });
        if (r.resourceType === "EQUIPMENT" && equipment.find((e) => e.id === r.resourceId)?.status !== "AVAILABLE") out.push({ reservationId: r.id, truckCode: r.truckCode, type: "RESOURCE_UNAVAILABLE", message: "Equipment is unavailable" });
        return out;
      });
    return { teams, equipment, reservations: list, conflicts };
  });
  route(app, { method: "PATCH", url: "/api/resources/teams/:id/status", summary: "Set team availability (revokes affected releases)", tags: ["resources"], permission: "resources:manage", params: idParam, body: teamStatusSchema }, async ({ actor, params, body }) => ops.setResourceStatus(actor, "TEAM", params.id, body.status, body.reason));
  route(app, { method: "PATCH", url: "/api/resources/teams/:id", summary: "Edit team shift/skills/size", tags: ["resources"], permission: "resources:manage", params: idParam, body: teamUpdateSchema }, async ({ actor, params, body }) => {
    const [t] = await db.update(schema.workforceTeams).set(body).where(and(eq(schema.workforceTeams.id, params.id), eq(schema.workforceTeams.facilityId, actor.facilityId))).returning();
    if (!t) throw notFound("Team");
    await recordEvent(db, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "SETTINGS_UPDATED", entityType: "team", entityId: t.id, entityLabel: t.code, actor, source: "USER", payload: body });
    return t;
  });
  route(app, { method: "PATCH", url: "/api/resources/equipment/:id/status", summary: "Set equipment status (revokes affected releases)", tags: ["resources"], permission: "resources:manage", params: idParam, body: equipmentStatusSchema }, async ({ actor, params, body }) => ops.setResourceStatus(actor, "EQUIPMENT", params.id, body.status, body.reason));

  /* ---------------- readiness ---------------- */
  route(app, { method: "POST", url: "/api/readiness/evaluate", summary: "Evaluate Readiness-to-Release (persisted, explainable)", tags: ["readiness"], permission: "readiness:evaluate", body: readinessEvaluateSchema }, async ({ actor, body }) => readiness.evaluateAndRecord(actor, body.truckId, body.proposedCallTime ? new Date(body.proposedCallTime) : undefined));
  route(app, { method: "POST", url: "/api/readiness/release", summary: "Release (call) a truck — atomic re-evaluation + resource reservation", tags: ["readiness"], permission: "release:execute", body: releaseSchema, idempotency: "optional" }, async ({ actor, body, reply }) => {
    const res = await readiness.releaseTruck(actor, { truckId: body.truckId, proposedCallTime: body.proposedCallTime ? new Date(body.proposedCallTime) : undefined, override: body.override });
    if (!res.released) reply.code(409);
    return res;
  });
  route(app, { method: "GET", url: "/api/readiness/evaluations", summary: "Recent readiness evaluations", tags: ["readiness"], permission: "readiness:evaluate", query: z.object({ truckId: z.uuid().optional() }) }, async ({ actor, query }) => {
    return db
      .select({ e: schema.readinessEvaluations, code: schema.trucks.code })
      .from(schema.readinessEvaluations)
      .innerJoin(schema.trucks, eq(schema.trucks.id, schema.readinessEvaluations.truckId))
      .where(and(eq(schema.readinessEvaluations.facilityId, actor.facilityId), query.truckId ? eq(schema.readinessEvaluations.truckId, query.truckId) : undefined))
      .orderBy(sql`${schema.readinessEvaluations.evaluatedAt} desc`)
      .limit(50)
      .then((r) => r.map((x) => ({ ...x.e, truckCode: x.code })));
  });

  /* ---------------- decisions ---------------- */
  route(app, { method: "GET", url: "/api/decisions", summary: "Decision log (holds, releases, overrides, plan approvals)", tags: ["decisions"], permission: "dashboard:read", query: z.object({ status: z.string().optional(), truckId: z.uuid().optional() }) }, async ({ actor, query }) => admin.listDecisions(actor, query));
  route(app, { method: "GET", url: "/api/decisions/:id", summary: "Explainable decision detail (inputs, checks, alternatives, execution)", tags: ["decisions"], permission: "dashboard:read", params: idParam }, async ({ actor, params }) => admin.getDecision(actor, params.id));

  /* ---------------- optimization ---------------- */
  route(app, { method: "POST", url: "/api/optimization/runs", summary: "Queue a CP-SAT optimisation run (preview only)", tags: ["optimization"], permission: "optimization:run", body: optimizationRunSchema, idempotency: "optional" }, async ({ actor, body, reply }) => {
    reply.code(202);
    return opt.enqueueOptimization(actor, { ...body, trigger: "MANUAL" });
  });
  route(app, { method: "GET", url: "/api/optimization/runs", summary: "Optimisation run history", tags: ["optimization"], permission: "optimization:read" }, async ({ actor }) => opt.listRuns(actor));
  route(app, { method: "GET", url: "/api/optimization/runs/:id", summary: "Run detail with candidates and reasons", tags: ["optimization"], permission: "optimization:read", params: idParam }, async ({ actor, params }) => opt.getRun(actor, params.id));
  route(app, { method: "POST", url: "/api/optimization/runs/:id/approve", summary: "Approve and commit a plan (re-validated against current state)", tags: ["optimization"], permission: "optimization:approve", params: idParam, body: planDecisionSchema, idempotency: "optional" }, async ({ actor, params, body }) => opt.approveRun(actor, params.id, body.reason));
  route(app, { method: "POST", url: "/api/optimization/runs/:id/reject", summary: "Reject a plan", tags: ["optimization"], permission: "optimization:approve", params: idParam, body: planDecisionSchema }, async ({ actor, params, body }) => opt.rejectRun(actor, params.id, body.reason));

  /* ---------------- simulation ---------------- */
  route(app, { method: "POST", url: "/api/simulations/runs", summary: "Queue a SimPy experiment (scenario × policies × replications)", tags: ["simulation"], permission: "simulation:run", body: simulationRunSchema }, async ({ actor, body, reply }) => {
    reply.code(202);
    return sim.createSimulation(actor, body);
  });
  route(app, { method: "GET", url: "/api/simulations/scenarios", summary: "Experiment history", tags: ["simulation"], permission: "simulation:read" }, async ({ actor }) => sim.listScenarios(actor));
  route(app, { method: "GET", url: "/api/simulations/scenarios/:id", summary: "Experiment with runs, metrics and policy summary (mean ± 95% CI)", tags: ["simulation"], permission: "simulation:read", params: idParam }, async ({ actor, params }) => sim.getScenario(actor, params.id));
  route(app, { method: "POST", url: "/api/simulations/scenarios/:id/rerun", summary: "Re-run with identical inputs and seed (reproducibility check)", tags: ["simulation"], permission: "simulation:run", params: idParam }, async ({ actor, params, reply }) => {
    reply.code(202);
    return sim.rerunScenario(actor, params.id);
  });
  route(app, { method: "POST", url: "/api/simulations/scenarios/:id/cancel", summary: "Cancel a queued/running experiment", tags: ["simulation"], permission: "simulation:run", params: idParam }, async ({ actor, params }) => sim.cancelSimulation(actor, params.id));
  route(app, { method: "GET", url: "/api/simulations/runs/:id/events", summary: "Event log of one simulation run (for replay)", tags: ["simulation"], permission: "simulation:read", params: idParam }, async ({ actor, params }) => sim.getRunEvents(actor, params.id));

  /* ---------------- quality & sensors ---------------- */
  route(app, { method: "GET", url: "/api/quality/reviews", summary: "Quality reviews", tags: ["quality"], permission: "quality:read", query: z.object({ status: z.string().optional() }) }, async ({ actor, query }) => quality.listReviews(actor, query.status));
  route(app, { method: "POST", url: "/api/quality/reviews", summary: "Request a manual quality review", tags: ["quality"], permission: "readiness:evaluate", body: z.object({ shipmentId: z.uuid(), notes: z.string().trim().min(5).max(1000) }) }, async ({ actor, body, reply }) => {
    reply.code(201);
    return quality.createManualReview(actor, body.shipmentId, body.notes);
  });
  route(app, { method: "GET", url: "/api/quality/reviews/:id", summary: "Quality review detail with sensor evidence and audit trail", tags: ["quality"], permission: "quality:read", params: idParam }, async ({ actor, params }) => quality.getReview(actor, params.id));
  route(app, { method: "POST", url: "/api/quality/reviews/:id/actions", summary: "Quality workflow action (role + state enforced)", tags: ["quality"], permission: "quality:review", params: idParam, body: qualityActionSchema }, async ({ actor, params, body }) => quality.actOnReview(actor, params.id, body));
  route(app, { method: "POST", url: "/api/virtual-sensors/scenarios", summary: "Generate a seeded synthetic sensor journey and run detection rules", tags: ["sensors"], permission: "sensors:generate", body: sensorScenarioSchema }, async ({ actor, body, reply }) => {
    reply.code(201);
    return sensors.generateScenario(actor, body);
  });
  route(app, { method: "GET", url: "/api/virtual-sensors/shipments/:id/streams", summary: "Sensor streams of a shipment", tags: ["sensors"], permission: "quality:read", params: idParam }, async ({ actor, params }) => sensors.getStreams(actor, params.id));
  route(app, { method: "GET", url: "/api/virtual-sensors/streams/:id", summary: "Readings and detected events of a stream", tags: ["sensors"], permission: "quality:read", params: idParam }, async ({ actor, params }) => sensors.getStream(actor, params.id));
  route(app, { method: "POST", url: "/api/virtual-sensors/shipments/:id/reset", summary: "Archive active streams (quality reviews are kept)", tags: ["sensors"], permission: "sensors:generate", params: idParam }, async ({ actor, params }) => sensors.resetShipmentSensors(actor, params.id));

  /* ---------------- handover ---------------- */
  route(app, { method: "GET", url: "/api/handover", summary: "Handover records", tags: ["handover"], permission: "handover:read" }, async ({ actor }) => handover.listHandovers(actor));
  route(app, { method: "GET", url: "/api/handover/scan/:token", summary: "Resolve a scanned QR token (auth + scope enforced)", tags: ["handover"], permission: "handover:read", params: z.object({ token: z.string().min(16).max(128) }) }, async ({ actor, params }) => handover.getByToken(actor, params.token));
  route(app, { method: "GET", url: "/api/handover/:id/qr.svg", summary: "QR code (SVG) encoding the opaque scan URL", tags: ["handover"], permission: "handover:act", params: idParam }, async ({ actor, params, reply }) => {
    const svg = await handover.qrSvg(actor, params.id);
    reply.header("content-type", "image/svg+xml").header("cache-control", "private, max-age=300");
    return reply.send(svg);
  });
  route(app, { method: "POST", url: "/api/handover/actions", summary: "Record a handover action (Idempotency-Key required)", tags: ["handover"], permission: "handover:act", body: handoverActionSchema, idempotency: "required" }, async ({ actor, body, req }) => handover.performHandoverAction(actor, body, String(req.headers["idempotency-key"])));

  /* ---------------- events / notifications ---------------- */
  route(app, { method: "GET", url: "/api/events", summary: "Audit/event timeline (append-only)", tags: ["events"], permission: "events:read", query: eventListQuery }, async ({ actor, query }) => admin.listEvents(actor, query));
  route(app, { method: "GET", url: "/api/events/export", summary: "Export events (CSV or JSON)", tags: ["events"], permission: "events:read", query: eventListQuery.extend({ format: z.enum(["csv", "json"]).default("csv") }) }, async ({ actor, query, reply }) => {
    const data = await admin.listEvents(actor, { ...query, page: 1, pageSize: 200 });
    const rows = data.items.map((e) => ({ eventId: e.id, occurredAt: e.occurredAt, eventType: e.eventType, entityType: e.entityType, entityId: e.entityId, entity: e.entityLabel, actor: e.actorLabel, source: e.source, correlationId: e.correlationId, previousState: e.previousState, newState: e.newState, payload: e.payload }));
    if (query.format === "json") {
      reply.header("content-disposition", `attachment; filename="wasl-events.json"`);
      return { exportedAt: new Date().toISOString(), synthetic: true, total: data.total, items: rows };
    }
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="wasl-events.csv"`);
    return reply.send(analytics.toCsv(rows));
  });
  route(app, { method: "GET", url: "/api/notifications", summary: "In-app notifications visible to the current user", tags: ["notifications"], permission: "notifications:read", query: z.object({ unreadOnly: z.coerce.boolean().optional() }) }, async ({ actor, query }) => admin.listNotifications(actor, { unreadOnly: query.unreadOnly }));
  route(app, { method: "POST", url: "/api/notifications/read", summary: "Mark notifications as read", tags: ["notifications"], permission: "notifications:read", body: z.object({ ids: z.union([z.array(z.uuid()).max(500), z.literal("all")]) }) }, async ({ actor, body }) => admin.markNotificationsRead(actor, body.ids));

  /* ---------------- reports ---------------- */
  route(app, { method: "GET", url: "/api/reports/operations", summary: "Operations report (KPIs, dock/team utilisation, bottlenecks, trucks)", tags: ["reports"], permission: "reports:read", query: reportQuery.extend({ format: z.enum(["json", "csv"]).default("json") }) }, async ({ actor, query, reply }) => {
    const r = await analytics.operationsReport(actor, query);
    if (query.format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="wasl-operations-report.csv"`);
      return reply.send(analytics.toCsv(r.trucks as unknown as Record<string, unknown>[]));
    }
    return r;
  });

  /* ---------------- models ---------------- */
  route(app, { method: "GET", url: "/api/models", summary: "Model registry (synced from the intelligence service)", tags: ["models"], permission: "models:read" }, async () => listModels());

  /* ---------------- organisation ---------------- */
  route(app, { method: "GET", url: "/api/users", summary: "Organisation users and roles", tags: ["organization"], permission: "users:read" }, async ({ actor }) => admin.listUsers(actor));
  route(app, { method: "POST", url: "/api/users", summary: "Create a user in this organisation", tags: ["organization"], permission: "users:manage", body: userCreateSchema }, async ({ actor, body, reply }) => {
    reply.code(201);
    return admin.createUser(actor, body);
  });
  route(app, { method: "PATCH", url: "/api/users/:id/role", summary: "Change a user's role", tags: ["organization"], permission: "users:manage", params: idParam, body: userRoleSchema }, async ({ actor, params, body }) => admin.changeUserRole(actor, params.id, body.role));
  route(app, { method: "GET", url: "/api/settings", summary: "Facility operational settings", tags: ["organization"], permission: "dashboard:read" }, async ({ actor }) => {
    const [f] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, actor.facilityId));
    return { ...f, defaultWeights: opt.defaultWeights((f.settings as { defaultWeights?: unknown }).defaultWeights) };
  });
  route(app, { method: "PATCH", url: "/api/settings", summary: "Update facility operational settings", tags: ["organization"], permission: "settings:manage", body: facilitySettingsSchema }, async ({ actor, body }) => admin.updateSettings(actor, body));
  route(app, { method: "POST", url: "/api/demo/reset", summary: "Reset the demo facility (DEMO_MODE + demo organisation only)", tags: ["demo"], permission: "demo:reset" }, async ({ actor }) => admin.resetDemo(actor));
}
