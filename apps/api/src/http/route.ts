import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, type ZodType } from "zod";
import { and, eq } from "drizzle-orm";
import type { Permission } from "@wasl/shared";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";
import type { Actor } from "./context";
import { db, schema } from "../db/client";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface RouteDef<B extends ZodType | undefined, Q extends ZodType | undefined, P extends ZodType | undefined> {
  method: Method;
  url: string;
  summary: string;
  tags: string[];
  /** Required permission. `null` → any authenticated user. */
  permission: Permission | null;
  /** Public routes skip authentication entirely (login, health). */
  public?: boolean;
  body?: B;
  query?: Q;
  params?: P;
  /** Honour (or require) an Idempotency-Key header and replay stored responses. */
  idempotency?: "optional" | "required";
  rateLimit?: { max: number; timeWindow: string };
  responseDescription?: string;
}

type Infer<T> = T extends ZodType ? z.infer<T> : undefined;

export interface HandlerCtx<B, Q, P> {
  body: B;
  query: Q;
  params: P;
  actor: Actor;
  req: FastifyRequest;
  reply: FastifyReply;
}

/* ---------------- OpenAPI registry ---------------- */
const openapiPaths: Record<string, Record<string, unknown>> = {};

function toJsonSchema(s: ZodType) {
  try {
    return z.toJSONSchema(s, { io: "input", unrepresentable: "any" });
  } catch {
    return { type: "object" };
  }
}

function register(def: RouteDef<ZodType | undefined, ZodType | undefined, ZodType | undefined>) {
  const path = def.url.replace(/:([A-Za-z]+)/g, "{$1}");
  const params: unknown[] = [];
  for (const m of def.url.matchAll(/:([A-Za-z]+)/g)) params.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
  if (def.query) {
    const js = toJsonSchema(def.query) as { properties?: Record<string, unknown>; required?: string[] };
    for (const [name, schemaObj] of Object.entries(js.properties ?? {})) params.push({ name, in: "query", required: js.required?.includes(name) ?? false, schema: schemaObj });
  }
  if (def.idempotency) params.push({ name: "Idempotency-Key", in: "header", required: def.idempotency === "required", schema: { type: "string" } });
  const op: Record<string, unknown> = {
    summary: def.summary,
    tags: def.tags,
    parameters: params,
    responses: {
      "200": { description: def.responseDescription ?? "Success" },
      "400": { $ref: "#/components/responses/Error" },
      "401": { $ref: "#/components/responses/Error" },
      "403": { $ref: "#/components/responses/Error" },
      "404": { $ref: "#/components/responses/Error" },
      "409": { $ref: "#/components/responses/Error" },
    },
    "x-permission": def.permission ?? (def.public ? "public" : "authenticated"),
  };
  if (!def.public) op.security = [{ cookieAuth: [] }];
  if (def.body) op.requestBody = { required: true, content: { "application/json": { schema: toJsonSchema(def.body) } } };
  openapiPaths[path] ??= {};
  openapiPaths[path][def.method.toLowerCase()] = op;
}

export function buildOpenApi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "WASL | وَصل API",
      version: "0.1.0",
      description:
        "Operational decision-intelligence API for truck reception. All mutating endpoints require the session cookie and the X-CSRF-Token header returned by /api/auth/me. Data in the demo organisation is synthetic.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: { cookieAuth: { type: "apiKey", in: "cookie", name: "wasl_session" } },
      responses: {
        Error: {
          description: "Error envelope",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } },
              },
            },
          },
        },
      },
    },
    paths: openapiPaths,
  };
}

/* ---------------- Route helper ---------------- */

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function route<B extends ZodType | undefined = undefined, Q extends ZodType | undefined = undefined, P extends ZodType | undefined = undefined>(
  app: FastifyInstance,
  def: RouteDef<B, Q, P>,
  handler: (ctx: HandlerCtx<Infer<B>, Infer<Q>, Infer<P>>) => Promise<unknown>,
) {
  register(def as RouteDef<ZodType | undefined, ZodType | undefined, ZodType | undefined>);
  app.route({
    method: def.method,
    url: def.url,
    config: def.rateLimit ? { rateLimit: def.rateLimit } : {},
    handler: async (req, reply) => {
      let actor = req.actor;
      if (!def.public) {
        if (!actor) throw unauthorized();
        if (MUTATING.has(def.method)) {
          const token = req.headers["x-csrf-token"];
          const session = (req as FastifyRequest & { csrfToken?: string }).csrfToken;
          if (!token || token !== session) throw forbidden("Missing or invalid CSRF token");
        }
        if (def.permission && !actor.permissions.includes(def.permission)) {
          throw forbidden(`Permission '${def.permission}' is required`);
        }
      }
      const parse = <T extends ZodType | undefined>(s: T, v: unknown, where: string) => {
        if (!s) return undefined;
        const r = s.safeParse(v ?? {});
        if (!r.success) throw badRequest("VALIDATION_ERROR", `Invalid ${where}`, z.flattenError(r.error));
        return r.data;
      };
      const body = parse(def.body, req.body, "request body");
      const query = parse(def.query, req.query, "query parameters");
      const params = parse(def.params, req.params, "path parameters");

      // Idempotency replay
      let idemKey: string | undefined;
      if (def.idempotency && actor) {
        const raw = req.headers["idempotency-key"];
        idemKey = typeof raw === "string" && raw.length >= 8 && raw.length <= 128 ? raw : undefined;
        if (!idemKey && def.idempotency === "required") throw badRequest("IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header (8-128 chars) is required");
        if (idemKey) {
          const [prev] = await db
            .select()
            .from(schema.idempotencyKeys)
            .where(and(eq(schema.idempotencyKeys.userId, actor.userId), eq(schema.idempotencyKeys.route, def.url), eq(schema.idempotencyKeys.key, idemKey)));
          if (prev) {
            reply.header("Idempotent-Replay", "true");
            return reply.code(prev.statusCode).send(prev.response);
          }
        }
      }

      const result = await handler({ body, query, params, actor: actor as Actor, req, reply } as HandlerCtx<Infer<B>, Infer<Q>, Infer<P>>);
      if (reply.sent) return reply;
      const status = reply.statusCode || 200;
      if (idemKey && actor) {
        await db
          .insert(schema.idempotencyKeys)
          .values({ key: idemKey, userId: actor.userId, route: def.url, statusCode: status, response: result ?? null })
          .onConflictDoNothing();
      }
      return result ?? { ok: true };
    },
  });
}

export function errorEnvelope(err: unknown) {
  if (err instanceof AppError) return { status: err.statusCode, body: { error: { code: err.code, message: err.message, details: err.details } } };
  return null;
}
