import bcrypt from "bcryptjs";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ASSIGNABLE_ROLES, type Role } from "@wasl/shared";
import { db, schema } from "../db/client";
import { config } from "../config";
import type { Actor } from "../http/context";
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from "../http/errors";
import { bus } from "../http/bus";
import { recordEvent } from "./audit";
import { purgeAuditForOrg } from "../db/seed/base";
import { seedFacility } from "../db/seed/facility";
import { withTx } from "./tx";

/* ------------------------------------------------------------------ */
/* Events (audit log)                                                   */
/* ------------------------------------------------------------------ */

export async function listEvents(actor: Actor, q: { page: number; pageSize: number; q?: string; eventType?: string; entityType?: string; entityId?: string; source?: string; from?: string; to?: string }) {
  const A = schema.auditEvents;
  const where = and(
    eq(A.orgId, actor.orgId),
    eq(A.facilityId, actor.facilityId),
    q.eventType ? eq(A.eventType, q.eventType) : undefined,
    q.entityType ? eq(A.entityType, q.entityType) : undefined,
    q.entityId ? eq(A.entityId, q.entityId) : undefined,
    q.source ? eq(A.source, q.source) : undefined,
    q.from ? gte(A.occurredAt, new Date(q.from)) : undefined,
    q.to ? lte(A.occurredAt, new Date(q.to)) : undefined,
    q.q ? or(ilike(A.entityLabel, `%${q.q}%`), ilike(A.actorLabel, `%${q.q}%`), ilike(A.eventType, `%${q.q}%`)) : undefined,
  );
  const [items, [{ total }]] = await Promise.all([
    db.select().from(A).where(where).orderBy(desc(A.occurredAt), desc(A.seq)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(A).where(where),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                        */
/* ------------------------------------------------------------------ */

function notificationVisibility(actor: Actor) {
  const N = schema.notifications;
  const scoped = actor.role === "CARRIER_OPERATOR" || actor.role === "DRIVER";
  return and(
    eq(N.orgId, actor.orgId),
    or(isNull(N.facilityId), eq(N.facilityId, actor.facilityId)),
    or(eq(N.userId, actor.userId), and(isNull(N.userId), sql`${actor.role} = any(${N.targetRoles})`)),
    scoped ? (actor.carrierId ? eq(N.carrierId, actor.carrierId) : sql`false`) : undefined,
  );
}

export async function listNotifications(actor: Actor, opts: { unreadOnly?: boolean; limit?: number }) {
  const N = schema.notifications;
  const rows = await db
    .select({ n: N, readAt: schema.notificationReads.readAt })
    .from(N)
    .leftJoin(schema.notificationReads, and(eq(schema.notificationReads.notificationId, N.id), eq(schema.notificationReads.userId, actor.userId)))
    .where(and(notificationVisibility(actor), opts.unreadOnly ? isNull(schema.notificationReads.readAt) : undefined))
    .orderBy(desc(N.createdAt))
    .limit(opts.limit ?? 100);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(N)
    .leftJoin(schema.notificationReads, and(eq(schema.notificationReads.notificationId, N.id), eq(schema.notificationReads.userId, actor.userId)))
    .where(and(notificationVisibility(actor), isNull(schema.notificationReads.readAt)));
  return { items: rows.map((r) => ({ ...r.n, read: !!r.readAt, readAt: r.readAt })), unread };
}

export async function markNotificationsRead(actor: Actor, ids: string[] | "all") {
  const N = schema.notifications;
  const visible = await db
    .select({ id: N.id })
    .from(N)
    .where(and(notificationVisibility(actor), ids === "all" ? undefined : inArray(N.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])));
  if (visible.length) await db.insert(schema.notificationReads).values(visible.map((v) => ({ notificationId: v.id, userId: actor.userId }))).onConflictDoNothing();
  bus.publish({ facilityId: actor.facilityId, topics: ["notifications"] });
  return { marked: visible.length };
}

/* ------------------------------------------------------------------ */
/* Decisions (Explainable Decision Center)                              */
/* ------------------------------------------------------------------ */

export async function listDecisions(actor: Actor, opts: { status?: string; truckId?: string; limit?: number }) {
  const Dc = schema.decisions;
  const rows = await db
    .select({ d: Dc, truckCode: schema.trucks.code, actorName: schema.users.name })
    .from(Dc)
    .leftJoin(schema.trucks, eq(schema.trucks.id, Dc.truckId))
    .leftJoin(schema.users, eq(schema.users.id, Dc.actorId))
    .where(and(eq(Dc.facilityId, actor.facilityId), opts.status ? eq(Dc.status, opts.status as never) : undefined, opts.truckId ? eq(Dc.truckId, opts.truckId) : undefined))
    .orderBy(desc(Dc.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map((r) => ({ ...r.d, truckCode: r.truckCode, actorName: r.actorName }));
}

export async function getDecision(actor: Actor, id: string) {
  const [row] = await db
    .select({ d: schema.decisions, truckCode: schema.trucks.code, actorName: schema.users.name })
    .from(schema.decisions)
    .leftJoin(schema.trucks, eq(schema.trucks.id, schema.decisions.truckId))
    .leftJoin(schema.users, eq(schema.users.id, schema.decisions.actorId))
    .where(and(eq(schema.decisions.id, id), eq(schema.decisions.facilityId, actor.facilityId)));
  if (!row) throw notFound("Decision");
  const [evaluation] = row.d.readinessEvaluationId ? await db.select().from(schema.readinessEvaluations).where(eq(schema.readinessEvaluations.id, row.d.readinessEvaluationId)) : [null];
  const [run] = row.d.optimizationRunId ? await db.select().from(schema.optimizationRuns).where(eq(schema.optimizationRuns.id, row.d.optimizationRunId)) : [null];
  const events = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.facilityId, actor.facilityId), eq(schema.auditEvents.correlationId, id))).orderBy(schema.auditEvents.occurredAt);
  return { ...row.d, truckCode: row.truckCode, actorName: row.actorName, evaluation, optimizationRun: run ? { id: run.id, solverStatus: run.solverStatus, objectiveValue: run.objectiveValue, objectiveBreakdown: run.objectiveBreakdown, currentPlanBreakdown: run.currentPlanBreakdown, params: run.params } : null, relatedEvents: events };
}

/* ------------------------------------------------------------------ */
/* Users & memberships                                                  */
/* ------------------------------------------------------------------ */

export async function listUsers(actor: Actor) {
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, isActive: schema.users.isActive, isDemo: schema.users.isDemo, lastLoginAt: schema.users.lastLoginAt, role: schema.memberships.role, carrierId: schema.memberships.carrierId, carrierName: schema.carriers.name, membershipId: schema.memberships.id })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.memberships.carrierId))
    .where(eq(schema.memberships.orgId, actor.orgId))
    .orderBy(schema.memberships.role, schema.users.email);
  return { users: rows, assignableRoles: ASSIGNABLE_ROLES[actor.role] };
}

export async function createUser(actor: Actor, input: { email: string; name: string; password: string; role: Role; carrierId?: string | null }) {
  if (!ASSIGNABLE_ROLES[actor.role].includes(input.role)) throw forbidden(`Role ${actor.role} cannot grant ${input.role}`);
  if ((input.role === "CARRIER_OPERATOR" || input.role === "DRIVER") && !input.carrierId) throw badRequest("CARRIER_REQUIRED", "Carrier-scoped roles require a carrier");
  if (input.carrierId) {
    const [c] = await db.select().from(schema.carriers).where(and(eq(schema.carriers.id, input.carrierId), eq(schema.carriers.orgId, actor.orgId)));
    if (!c) throw badRequest("INVALID_CARRIER", "Carrier does not belong to this organisation");
  }
  try {
    return await withTx(async ({ tx }) => {
      const [user] = await tx.insert(schema.users).values({ email: input.email.toLowerCase(), name: input.name, passwordHash: await bcrypt.hash(input.password, 12), isDemo: false }).returning({ id: schema.users.id, email: schema.users.email, name: schema.users.name });
      await tx.insert(schema.memberships).values({ userId: user.id, orgId: actor.orgId, role: input.role, carrierId: input.carrierId ?? null });
      await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "USER_CREATED", entityType: "user", entityId: user.id, entityLabel: user.email, actor, source: "USER", payload: { role: input.role } });
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("EMAIL_TAKEN", "A user with this email already exists");
    throw err;
  }
}

export async function changeUserRole(actor: Actor, userId: string, role: Role) {
  return withTx(async ({ tx }) => {
    const [m] = await tx
      .select({ m: schema.memberships, isDemo: schema.users.isDemo })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.orgId, actor.orgId)));
    if (!m) throw notFound("User");
    if (userId === actor.userId) throw forbidden("You cannot change your own role");
    if (config.demoMode && m.isDemo) throw forbidden("Seeded demo accounts are protected in demo mode");
    if (!ASSIGNABLE_ROLES[actor.role].includes(role) || !ASSIGNABLE_ROLES[actor.role].includes(m.m.role)) throw forbidden(`Role ${actor.role} cannot change ${m.m.role} to ${role}`);
    await tx.update(schema.memberships).set({ role }).where(eq(schema.memberships.id, m.m.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId)); // force re-login with new permissions
    await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "USER_ROLE_CHANGED", entityType: "user", entityId: userId, actor, source: "USER", payload: { from: m.m.role, to: role } });
    return { userId, role };
  });
}

/* ------------------------------------------------------------------ */
/* Facility settings                                                    */
/* ------------------------------------------------------------------ */

export async function updateSettings(actor: Actor, input: { yardCapacity?: number; gateCapacityPerHour?: number; travelTimeMin?: number; congestionThreshold?: number; defaultWeights?: Record<string, number> }) {
  return withTx(async ({ tx, live }) => {
    const [f] = await tx.select().from(schema.facilities).where(eq(schema.facilities.id, actor.facilityId)).for("update");
    const { defaultWeights, ...cols } = input;
    const [updated] = await tx
      .update(schema.facilities)
      .set({ ...cols, settings: defaultWeights ? { ...f.settings, defaultWeights } : f.settings, stateVersion: f.stateVersion + 1 })
      .where(eq(schema.facilities.id, actor.facilityId))
      .returning();
    await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "SETTINGS_UPDATED", entityType: "facility", entityId: f.id, entityLabel: f.code, actor, source: "USER", payload: input, previousState: { yardCapacity: f.yardCapacity, gateCapacityPerHour: f.gateCapacityPerHour, travelTimeMin: f.travelTimeMin, congestionThreshold: f.congestionThreshold }, newState: { yardCapacity: updated.yardCapacity, gateCapacityPerHour: updated.gateCapacityPerHour, travelTimeMin: updated.travelTimeMin, congestionThreshold: updated.congestionThreshold } });
    live({ facilityId: actor.facilityId, topics: ["settings", "dashboard", "readiness", "twin"] });
    return updated;
  });
}

/* ------------------------------------------------------------------ */
/* Demo reset                                                           */
/* ------------------------------------------------------------------ */

/**
 * Restores the demo facility to its initial scenario. Guard rails:
 *  - only when DEMO_MODE=true
 *  - only for organisations flagged is_demo
 *  - users, carriers and drivers are kept; facility-scoped operational data is recreated.
 */
export async function resetDemo(actor: Actor) {
  if (!config.demoMode) throw forbidden("Demo reset is disabled (DEMO_MODE is not enabled)");
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, actor.orgId));
  if (!org?.isDemo) throw forbidden("Demo reset is only allowed for demo organisations");
  const res = await withTx(async ({ tx }) => {
    await purgeAuditForOrg(tx, org.id);
    await tx.delete(schema.notifications).where(eq(schema.notifications.orgId, org.id));
    await tx.delete(schema.facilities).where(eq(schema.facilities.orgId, org.id));
    const members = await tx
      .select({ userId: schema.memberships.userId, role: schema.memberships.role, isDemo: schema.users.isDemo, email: schema.users.email, name: schema.users.name })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.orgId, org.id));
    const byKey: Record<string, { id: string; name: string; role: string }> = {};
    for (const m of members) byKey[m.email.split("@")[0]] = { id: m.userId, name: m.name, role: m.role };
    const carriers = await tx.select().from(schema.carriers).where(eq(schema.carriers.orgId, org.id));
    const drivers = await tx.select().from(schema.drivers).where(eq(schema.drivers.orgId, org.id));
    const fallback = { id: actor.userId, name: actor.name, role: actor.role };
    const fac = await seedFacility(tx, {
      orgId: org.id,
      carriers: Object.fromEntries(carriers.map((c) => [c.code, c.id])),
      drivers: Object.fromEntries(drivers.map((d) => [d.reference, d.id])),
      users: { ops: byKey.ops ?? fallback, dock: byKey.dock ?? fallback, quality: byKey.quality ?? fallback, carrier: byKey.carrier ?? fallback },
    });
    await tx.update(schema.sessions).set({ facilityId: fac.facilityId }).where(inArray(schema.sessions.userId, members.map((m) => m.userId)));
    await recordEvent(tx, { orgId: org.id, facilityId: fac.facilityId, eventType: "DEMO_RESET", entityType: "facility", entityId: fac.facilityId, actor, source: "USER", payload: { note: "Demo facility restored to its initial scenario" } });
    return fac;
  });
  bus.publish({ facilityId: res.facilityId, topics: ["*"] });
  bus.publish({ facilityId: actor.facilityId, topics: ["*"] });
  return { reset: true, facilityId: res.facilityId };
}

export async function listFacilities(actor: Actor) {
  return db.select().from(schema.facilities).where(eq(schema.facilities.orgId, actor.orgId)).orderBy(schema.facilities.code);
}
