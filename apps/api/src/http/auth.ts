import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS, type Role } from "@wasl/shared";
import { db, schema } from "../db/client";
import { config } from "../config";
import { unauthorized } from "./errors";

export const SESSION_COOKIE = "wasl_session";
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Pre-computed hash used to equalise timing when the email is unknown. */
const DUMMY_HASH = bcrypt.hashSync("wasl-timing-equaliser", 10);

export async function verifyCredentials(email: string, password: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase().trim()));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.isActive) return null;
  return user;
}

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string, remember: boolean) {
  const [membership] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, userId)).limit(1);
  if (!membership) throw unauthorized("User has no organisation membership");
  const [facility] = await db.select({ id: schema.facilities.id }).from(schema.facilities).where(eq(schema.facilities.orgId, membership.orgId)).orderBy(schema.facilities.code).limit(1);
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const ttlMs = remember ? config.rememberTtlDays * 86400_000 : config.sessionTtlHours * 3600_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(schema.sessions).values({
    userId,
    membershipId: membership.id,
    facilityId: facility?.id ?? null,
    tokenHash: sha256(token),
    csrfToken,
    expiresAt,
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
  });
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    ...(remember ? { expires: expiresAt } : {}),
  });
  return { csrfToken, membership };
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Resolves the session cookie into `req.actor` for every request. */
export function registerAuth(app: FastifyInstance) {
  app.addHook("onRequest", async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return;
    const rows = await db
      .select({ session: schema.sessions, user: schema.users, membership: schema.memberships })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
      .innerJoin(schema.memberships, eq(schema.memberships.id, schema.sessions.membershipId))
      .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (!row || !row.user.isActive || !row.session.facilityId) return;
    const role = row.membership.role as Role;
    req.actor = {
      sessionId: row.session.id,
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role,
      orgId: row.membership.orgId,
      facilityId: row.session.facilityId,
      carrierId: row.membership.carrierId,
      driverId: row.membership.driverId,
      permissions: ROLE_PERMISSIONS[role],
      isDemo: row.user.isDemo,
    };
    (req as FastifyRequest & { csrfToken?: string }).csrfToken = row.session.csrfToken;
  });
}
