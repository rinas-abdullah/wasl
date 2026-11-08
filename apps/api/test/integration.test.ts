import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app";
import { db, pool, schema } from "../src/db/client";
import { executeOptimization } from "../src/domain/optimization";
import { executeSimulation } from "../src/domain/simulation";
import { intelHealthy } from "../src/intel/client";

let app: FastifyInstance;
let intelUp = false;

interface Session { cookie: string; csrf: string; email: string }
async function login(user: string, password = "Wasl@Demo2026"): Promise<Session> {
  const email = user.includes("@") ? user : `${user}@demo.wasl.sa`;
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = String(res.headers["set-cookie"]).split(";")[0];
  return { cookie, csrf: res.json().csrfToken, email };
}
function call(s: Session | null, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method, url, payload: payload as never, headers: { ...(s ? { cookie: s.cookie, "x-csrf-token": s.csrf } : {}), ...headers } });
}
async function truckId(s: Session, code: string) {
  const r = await call(s, "GET", `/api/trucks?q=${code}`);
  return r.json().items.find((t: { code: string }) => t.code === code).id as string;
}
async function dockId(s: Session, code: string) {
  return (await call(s, "GET", "/api/docks")).json().find((d: { code: string }) => d.code === code).id as string;
}
async function actorFor(s: Session) {
  // Build the actor the worker would receive, from the session.
  const me = (await call(s, "GET", "/api/auth/me")).json();
  return { sessionId: "test", userId: me.user.id, name: me.user.name, email: me.user.email, role: me.role, orgId: me.organization.id, facilityId: me.facility.id, carrierId: me.carrierId, driverId: me.driverId, permissions: me.permissions, isDemo: true };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  intelUp = await intelHealthy();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("authentication", () => {
  it("rejects wrong passwords with a generic error and no session", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ops@demo.wasl.sa", password: "nope" } });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toBe("Invalid email or password");
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it("requires authentication for protected routes", async () => {
    expect((await call(null, "GET", "/api/trucks")).statusCode).toBe(401);
  });
  it("sets an HttpOnly, SameSite session cookie", async () => {
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "ops@demo.wasl.sa", password: "Wasl@Demo2026" } });
    const c = String(r.headers["set-cookie"]);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
  });
  it("one-click demo sign-in works only for seeded demo accounts", async () => {
    const list = (await app.inject({ method: "GET", url: "/api/auth/demo-accounts" })).json();
    expect(list.map((x: { email: string }) => x.email)).toContain("ops@demo.wasl.sa");
    const ok = await app.inject({ method: "POST", url: "/api/auth/demo-login", payload: { email: "ops@demo.wasl.sa" } });
    expect(ok.statusCode).toBe(200);
    expect(String(ok.headers["set-cookie"])).toMatch(/HttpOnly/);
    const [u] = await db.insert(schema.users).values({ email: "real-user@example.test", name: "Real", passwordHash: "x", isDemo: false }).returning();
    const bad = await app.inject({ method: "POST", url: "/api/auth/demo-login", payload: { email: "real-user@example.test" } });
    expect(bad.statusCode).toBe(401);
    await db.delete(schema.users).where(eq(schema.users.id, u.id));
  });
  it("rejects mutations without a CSRF token", async () => {
    const s = await login("ops");
    const r = await app.inject({ method: "POST", url: "/api/optimization/runs", payload: {}, headers: { cookie: s.cookie } });
    expect(r.statusCode).toBe(403);
  });
});

describe("authorization & isolation", () => {
  it("auditor cannot create trucks; carrier cannot approve plans", async () => {
    const auditor = await login("auditor");
    expect((await call(auditor, "POST", "/api/trucks", {})).statusCode).toBe(403);
    const carrier = await login("carrier");
    expect((await call(carrier, "POST", "/api/optimization/runs/00000000-0000-4000-8000-000000000000/approve", {})).statusCode).toBe(403);
  });
  it("driver only sees own trucks; other trucks are 404 (no IDOR)", async () => {
    const ops = await login("ops");
    const other = await truckId(ops, "WSL-1003");
    const driver = await login("driver");
    const list = (await call(driver, "GET", "/api/trucks")).json();
    expect(list.items.map((t: { code: string }) => t.code)).toEqual(["WSL-1006"]);
    expect((await call(driver, "GET", `/api/trucks/${other}`)).statusCode).toBe(404);
  });
  it("tenant B cannot read tenant A records", async () => {
    const ops = await login("ops");
    const a = await truckId(ops, "WSL-1001");
    const b = await login("admin@tenant-b.demo.wasl.sa");
    expect((await call(b, "GET", "/api/trucks")).json().items.map((t: { code: string }) => t.code)).toEqual(["TB-0001"]);
    expect((await call(b, "GET", `/api/trucks/${a}`)).statusCode).toBe(404);
    expect((await call(b, "GET", `/api/docks`)).json().map((d: { code: string }) => d.code)).toEqual(["B-D1"]);
  });
  it("carrier operator cannot register a truck for another carrier", async () => {
    const carrier = await login("carrier");
    const carriers = (await call(carrier, "GET", "/api/carriers")).json();
    expect(carriers).toHaveLength(1);
    const ops = await login("ops");
    const all = (await call(ops, "GET", "/api/carriers")).json();
    const otherCarrier = all.find((c: { code: string }) => c.code !== "NAJD").id;
    const r = await call(carrier, "POST", "/api/trucks", { plateNumber: "X 1", carrierId: otherCarrier, vehicleType: "RIGID", requestedArrival: new Date(Date.now() + 3600_000).toISOString(), shipment: { cargoType: "GENERAL", palletCount: 5, weightKg: 1000, handlingMethod: "MANUAL" } });
    expect(r.statusCode).toBe(403);
  });
});

describe("truck lifecycle & appointments", () => {
  let created: string;
  it("creates a truck with a service estimate and a REQUESTED appointment", async () => {
    const ops = await login("ops");
    const carrierId = (await call(ops, "GET", "/api/carriers")).json()[0].id;
    const r = await call(ops, "POST", "/api/trucks", { plateNumber: "TST 001", carrierId, vehicleType: "RIGID", requestedArrival: new Date(Date.now() + 2 * 3600_000).toISOString(), shipment: { cargoType: "GENERAL", palletCount: 12, weightKg: 4000, handlingMethod: "FORKLIFT_PALLET" } });
    expect(r.statusCode, r.body).toBe(201);
    created = r.json().id;
    expect(r.json().serviceEstimateMin).toBeGreaterThan(0);
    expect(r.json().serviceEstimateSource).toMatch(/MODEL|BASELINE|PLANNING_TABLE/);
    const d = (await call(ops, "GET", `/api/trucks/${created}`)).json();
    expect(d.appointments[0].status).toBe("REQUESTED");
    expect(d.events[0].eventType).toBe("TRUCK_CREATED");
  });
  it("rejects an illogical transition", async () => {
    const ops = await login("ops");
    const r = await call(ops, "POST", `/api/trucks/${created}/transitions`, { action: "COMPLETE_SERVICE", version: 1 });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("INVALID_TRANSITION");
  });
  it("detects appointment conflicts and confirms a free slot", async () => {
    const ops = await login("ops");
    const d4 = await dockId(ops, "D4");
    const start = new Date(Date.now() + 5 * 3600_000).toISOString();
    const ok = await call(ops, "POST", "/api/appointments", { truckId: created, dockId: d4, start, version: 1 });
    expect(ok.statusCode, ok.body).toBe(200);
    const t9 = await truckId(ops, "WSL-1009");
    const v = (await call(ops, "POST", "/api/appointments/validate", { truckId: t9, dockId: d4, start })).json();
    expect(v.ok).toBe(false);
    expect(v.errors.map((e: { code: string }) => e.code)).toContain("APPOINTMENT_CONFLICT");
  });
  it("optimistic concurrency: stale version is rejected", async () => {
    const ops = await login("ops");
    const r = await call(ops, "PATCH", `/api/trucks/${created}`, { version: 1, notes: "late edit" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("STALE_VERSION");
  });
});

describe("readiness & release", () => {
  it("WSL-1005 is on HOLD because the only fragile-skilled crew is busy", async () => {
    const ops = await login("ops");
    const id = await truckId(ops, "WSL-1005");
    const r = (await call(ops, "POST", "/api/readiness/evaluate", { truckId: id })).json();
    expect(r.outcome).toBe("HOLD");
    expect(r.checks.find((c: { checkId: string }) => c.checkId === "WORKFORCE_AVAILABLE").result).toBe("FAIL");
  });
  it("refuses to override non-overridable safety/capacity checks", async () => {
    const ops = await login("ops");
    const id = await truckId(ops, "WSL-1005");
    const r = await call(ops, "POST", "/api/readiness/release", { truckId: id, override: { checkIds: ["WORKFORCE_AVAILABLE"], reason: "trying to push it through" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.code).toBe("NON_OVERRIDABLE_CHECKS");
  });
  it("two concurrent releases cannot claim the same dock/crew window", async () => {
    const ops = await login("ops");
    const a = await truckId(ops, "WSL-1006");
    const b = await truckId(ops, "WSL-1008");
    // Both assigned to D3 in the seed. Release both at the same call time concurrently.
    const callTime = new Date(Date.now() + 30 * 60_000).toISOString();
    const [r1, r2] = await Promise.all([call(ops, "POST", "/api/readiness/release", { truckId: a, proposedCallTime: callTime }), call(ops, "POST", "/api/readiness/release", { truckId: b, proposedCallTime: callTime })]);
    const released = [r1, r2].filter((r) => r.statusCode === 200 && r.json().released);
    expect(released.length).toBeLessThanOrEqual(1);
    const active = await db.execute(sql`select count(*)::int as n from resource_reservations r join docks d on d.id = r.resource_id where d.code='D3' and r.status='ACTIVE' and r.start_at > now()`);
    expect((active.rows[0] as { n: number }).n).toBeLessThanOrEqual(1);
  });
  it("the database itself rejects overlapping ACTIVE reservations (EXCLUDE constraint)", async () => {
    const [d] = await db.select().from(schema.docks).limit(1);
    const [t] = await db.select().from(schema.trucks).limit(2);
    const start = new Date(Date.now() + 20 * 3600_000);
    const end = new Date(start.getTime() + 3600_000);
    await db.insert(schema.resourceReservations).values({ facilityId: d.facilityId, resourceType: "DOCK", resourceId: d.id, truckId: t.id, startAt: start, endAt: end });
    await expect(db.insert(schema.resourceReservations).values({ facilityId: d.facilityId, resourceType: "DOCK", resourceId: d.id, truckId: t.id, startAt: new Date(start.getTime() + 600_000), endAt: end })).rejects.toThrow();
    await db.delete(schema.resourceReservations).where(eq(schema.resourceReservations.startAt, start));
  });
});

describe("dock failure cascade", () => {
  it("disabling a dock revokes affected releases, flags trucks, alerts and queues a re-plan", async () => {
    const ops = await login("ops");
    const d3 = await dockId(ops, "D3");
    const r = await call(ops, "PATCH", `/api/docks/${d3}/status`, { status: "OUT_OF_SERVICE", reason: "Hydraulic leveler failure" });
    expect(r.statusCode, r.body).toBe(200);
    const affected = r.json().affectedTrucks.map((t: { code: string }) => t.code);
    expect(affected).toEqual(expect.arrayContaining(["WSL-1008"]));
    expect(r.json().inServiceTrucks.map((t: { code: string }) => t.code)).toEqual(["WSL-1003"]);
    const t8 = (await call(ops, "GET", `/api/trucks/${await truckId(ops, "WSL-1008")}`)).json();
    expect(t8.reassignmentRequired).toBe(true);
    const notes = (await call(ops, "GET", "/api/notifications")).json().items;
    expect(notes.some((n: { type: string }) => n.type === "DOCK_FAILURE")).toBe(true);
    await new Promise((res) => setTimeout(res, 300));
    const runs = (await call(ops, "GET", "/api/optimization/runs")).json();
    expect(runs.some((x: { trigger: string }) => x.trigger === "DOCK_FAILURE")).toBe(true);
    const dash = (await call(ops, "GET", "/api/dashboard/overview")).json();
    expect(dash.kpis.outOfServiceDocks).toBe(1);
    const twin = (await call(ops, "GET", "/api/twin/state")).json();
    expect(twin.docks.find((x: { code: string }) => x.code === "D3").status).toBe("OUT_OF_SERVICE");
  });
  it("blocks new assignments on the failed dock", async () => {
    const ops = await login("ops");
    const v = (await call(ops, "POST", "/api/appointments/validate", { truckId: await truckId(ops, "WSL-1009"), dockId: await dockId(ops, "D3"), start: new Date(Date.now() + 6 * 3600_000).toISOString() })).json();
    expect(v.errors.map((e: { code: string }) => e.code)).toContain("DOCK_DOWN");
  });
});

describe("optimization (OR-Tools)", () => {
  it("solves, explains, and commits only after approval", async (ctx) => {
    if (!intelUp) ctx.skip();
    const ops = await login("ops");
    const run = (await call(ops, "POST", "/api/optimization/runs", { horizonMin: 600, timeLimitSec: 5 })).json();
    await executeOptimization(run.id, await actorFor(ops));
    const detail = (await call(ops, "GET", `/api/optimization/runs/${run.id}`)).json();
    expect(["OPTIMAL", "FEASIBLE"]).toContain(detail.solverStatus);
    expect(detail.approvalStatus).toBe("PENDING");
    const d3 = await dockId(ops, "D3");
    for (const c of detail.candidates.filter((x: { assigned: boolean }) => x.assigned)) {
      expect(c.dockId).not.toBe(d3);
      expect(c.reasons.length).toBeGreaterThan(0);
    }
    const before = (await call(ops, "GET", `/api/trucks/${await truckId(ops, "WSL-1008")}`)).json();
    expect(before.assignedDockId).toBe(d3); // preview did not change anything
    const approved = await call(ops, "POST", `/api/optimization/runs/${run.id}/approve`, { reason: "test" });
    expect(approved.statusCode, approved.body).toBe(200);
    const after = (await call(ops, "GET", `/api/trucks/${await truckId(ops, "WSL-1008")}`)).json();
    expect(after.assignedDockId).not.toBe(d3);
    expect(after.reassignmentRequired).toBe(false);
  });
  it("reports INFEASIBLE when every truck must be placed but one cannot be", async (ctx) => {
    if (!intelUp) ctx.skip();
    const ops = await login("ops");
    // Make the pharma truck impossible: take the only pharma-capable team offline.
    const res = (await call(ops, "GET", "/api/resources")).json();
    const teamA = res.teams.find((t: { code: string }) => t.code === "T-A");
    await call(ops, "PATCH", `/api/resources/teams/${teamA.id}/status`, { status: "UNAVAILABLE", reason: "test infeasibility" });
    const run = (await call(ops, "POST", "/api/optimization/runs", { horizonMin: 600, timeLimitSec: 5, allowUnassigned: false })).json();
    await executeOptimization(run.id, await actorFor(ops));
    const detail = (await call(ops, "GET", `/api/optimization/runs/${run.id}`)).json();
    expect(detail.solverStatus).toBe("INFEASIBLE");
    expect(detail.approvalStatus).toBe("NOT_APPLICABLE");
    await call(ops, "PATCH", `/api/resources/teams/${teamA.id}/status`, { status: "AVAILABLE", reason: "restore after test" });
  });
  it("a plan computed before a conflicting change is rejected as stale", async (ctx) => {
    if (!intelUp) ctx.skip();
    const ops = await login("ops");
    const run = (await call(ops, "POST", "/api/optimization/runs", { horizonMin: 600, timeLimitSec: 5 })).json();
    await executeOptimization(run.id, await actorFor(ops));
    const detail = (await call(ops, "GET", `/api/optimization/runs/${run.id}`)).json();
    const cand = detail.candidates.find((c: { assigned: boolean }) => c.assigned);
    await call(ops, "PATCH", `/api/docks/${cand.dockId}/status`, { status: "MAINTENANCE", reason: "stale plan test" });
    const r = await call(ops, "POST", `/api/optimization/runs/${run.id}/approve`, {});
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("PLAN_STALE");
    await call(ops, "PATCH", `/api/docks/${cand.dockId}/status`, { status: "AVAILABLE", reason: "restore after test" });
  });
});

describe("virtual sensors → quality → readiness", () => {
  it("a temperature excursion creates a review that blocks release until a quality officer acts", async () => {
    const ops = await login("ops");
    const t7 = await truckId(ops, "WSL-1007");
    const shipmentId = (await call(ops, "GET", `/api/trucks/${t7}`)).json().shipment.id;
    const q = await login("quality");
    const gen = await call(q, "POST", "/api/virtual-sensors/scenarios", { shipmentId, scenario: "TEMP_EXCURSION", seed: 777 });
    expect(gen.statusCode, gen.body).toBe(201);
    expect(gen.json().events.some((e: { ruleId: string }) => e.ruleId === "R-TEMP-01")).toBe(true);
    const reviewId = gen.json().reviewId;
    expect(reviewId).toBeTruthy();
    const ev = (await call(ops, "POST", "/api/readiness/evaluate", { truckId: t7 })).json();
    expect(ev.outcome).toBe("MANUAL_REVIEW_REQUIRED");
    expect((await call(ops, "POST", `/api/quality/reviews/${reviewId}/actions`, { action: "START_REVIEW", version: 1 })).statusCode).toBe(403);
    const started = await call(q, "POST", `/api/quality/reviews/${reviewId}/actions`, { action: "START_REVIEW", version: 1 });
    expect(started.json().status).toBe("UNDER_REVIEW");
    const missingNotes = await call(q, "POST", `/api/quality/reviews/${reviewId}/actions`, { action: "RELEASE", version: 2 });
    expect(missingNotes.statusCode).toBe(422);
    const ev2 = (await call(ops, "POST", "/api/readiness/evaluate", { truckId: t7 })).json();
    expect(ev2.checks.find((c: { checkId: string }) => c.checkId === "QUALITY_REQUIREMENTS").result).toBe("WARN");
  });
  it("the same seed reproduces the same readings", async () => {
    const q = await login("quality");
    const ops = await login("ops");
    const shipmentId = (await call(ops, "GET", `/api/trucks/${await truckId(ops, "WSL-1009")}`)).json().shipment.id;
    const a = (await call(q, "POST", "/api/virtual-sensors/scenarios", { shipmentId, scenario: "MISSING_DATA", seed: 5 })).json();
    const b = (await call(q, "POST", "/api/virtual-sensors/scenarios", { shipmentId, scenario: "MISSING_DATA", seed: 5 })).json();
    expect(a.injected).toEqual(b.injected);
    expect(a.events.map((e: { ruleId: string }) => e.ruleId)).toEqual(b.events.map((e: { ruleId: string }) => e.ruleId));
  });
});

describe("handover", () => {
  it("requires an Idempotency-Key, replays duplicates and rejects repeated actions", async () => {
    const dock = await login("dock");
    const list = (await call(dock, "GET", "/api/handover")).json();
    const h = list.find((x: { status: string }) => x.status === "UNLOADING");
    expect(h).toBeTruthy();
    const noKey = await call(dock, "POST", "/api/handover/actions", { token: h.qrToken, action: "APPROVE_HANDOVER" });
    expect(noKey.statusCode).toBe(400);
    const r1 = await call(dock, "POST", "/api/handover/actions", { token: h.qrToken, action: "APPROVE_HANDOVER" }, { "idempotency-key": "test-key-0001" });
    expect(r1.statusCode, r1.body).toBe(200);
    const r2 = await call(dock, "POST", "/api/handover/actions", { token: h.qrToken, action: "APPROVE_HANDOVER" }, { "idempotency-key": "test-key-0001" });
    expect(r2.headers["idempotent-replay"]).toBe("true");
    const r3 = await call(dock, "POST", "/api/handover/actions", { token: h.qrToken, action: "APPROVE_HANDOVER" }, { "idempotency-key": "test-key-0002" });
    expect(r3.statusCode).toBe(422);
    const truck = (await call(dock, "GET", `/api/trucks/${h.truck.id}`)).json();
    expect(truck.status).toBe("COMPLETED");
  });
  it("a token from another tenant is not found", async () => {
    const dock = await login("dock");
    const h = (await call(dock, "GET", "/api/handover")).json()[0];
    const b = await login("admin@tenant-b.demo.wasl.sa");
    expect((await call(b, "GET", `/api/handover/scan/${h.qrToken}`)).statusCode).toBe(404);
  });
});

describe("simulation (SimPy)", () => {
  it("runs a reproducible experiment and stores runs, metrics and events", async (ctx) => {
    if (!intelUp) ctx.skip();
    const ops = await login("ops");
    const params = { durationMin: 240, nTrucks: 10, nDocks: 3, nReeferDocks: 1, nTeams: 3, nInspectors: 1, yardCapacity: 6, arrival: { pattern: "UNIFORM_APPOINTMENTS", latenessMeanMin: 0, latenessSdMin: 10 }, service: { distribution: "LOGNORMAL", cv: 0.3 }, coldShare: 0.2, qualityProbability: 0.1, inspectionMin: 20, travelMin: 15, failures: [{ kind: "DOCK", index: 1, atMin: 60, durationMin: 60 }] };
    const r = (await call(ops, "POST", "/api/simulations/runs", { scenarioName: "test", seed: 11, replications: 1, policies: ["FCFS", "FULL_WASL"], params })).json();
    await executeSimulation(r.jobId, r.scenario.id, await actorFor(ops));
    const s = (await call(ops, "GET", `/api/simulations/scenarios/${r.scenario.id}`)).json();
    expect(s.runs.every((x: { jobStatus: string }) => x.jobStatus === "COMPLETED")).toBe(true);
    expect(s.summary).toHaveLength(2);
    const r2 = (await call(ops, "POST", `/api/simulations/scenarios/${r.scenario.id}/rerun`)).json();
    await executeSimulation(r2.jobId, r2.scenario.id, await actorFor(ops));
    const s2 = (await call(ops, "GET", `/api/simulations/scenarios/${r2.scenario.id}`)).json();
    const key = (x: { runs: { policy: string; metrics: unknown }[] }) => JSON.stringify(x.runs.map((y) => [y.policy, y.metrics]).sort());
    expect(key(s2)).toBe(key(s));
    const events = (await call(ops, "GET", `/api/simulations/runs/${s.runs[0].id}/events`)).json();
    expect(events.events.some((e: { eventType: string }) => e.eventType === "DOCK_FAILURE")).toBe(true);
  });
});

describe("audit integrity & reports", () => {
  it("audit events cannot be updated or deleted", async () => {
    await expect(pool.query("update audit_events set event_type = 'TAMPERED' where seq = (select min(seq) from audit_events)")).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from audit_events where seq = (select min(seq) from audit_events)")).rejects.toThrow(/append-only/);
  });
  it("reports are consistent with recorded operations", async () => {
    const ops = await login("ops");
    const rep = (await call(ops, "GET", `/api/reports/operations?from=${new Date(Date.now() - 24 * 3600_000).toISOString()}`)).json();
    expect(rep.summary.dockFailures).toBeGreaterThanOrEqual(1);
    expect(rep.summary.plansApproved).toBeGreaterThanOrEqual(intelUp ? 1 : 0);
    const events = (await call(ops, "GET", "/api/events?eventType=DOCK_FAILED")).json();
    expect(events.total).toBe(rep.summary.dockFailures);
  });
  it("demo reset restores the initial scenario for the demo organisation only", async () => {
    const admin = await login("admin");
    const r = await call(admin, "POST", "/api/demo/reset");
    expect(r.statusCode, r.body).toBe(200);
    const dash = (await call(admin, "GET", "/api/dashboard/overview")).json();
    expect(dash.kpis.outOfServiceDocks).toBe(0);
    const b = await login("admin@tenant-b.demo.wasl.sa");
    expect((await call(b, "GET", "/api/trucks")).json().total).toBe(1);
  });
});
