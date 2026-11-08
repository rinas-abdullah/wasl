import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { registerAuth } from "./http/auth";
import { errorEnvelope, buildOpenApi } from "./http/route";
import { registerSse } from "./http/sse";
import { registerRoutes } from "./routes";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : { level: config.logLevel, redact: ["req.headers.cookie", "req.headers.authorization", "req.headers['x-csrf-token']", "req.body.password"] },
    genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
    trustProxy: true,
    bodyLimit: 512 * 1024,
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute", keyGenerator: (req) => req.actor?.userId ?? req.ip });
  registerAuth(app);

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    reply.header("x-frame-options", "DENY");
    return payload;
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const env = errorEnvelope(err);
    if (env) {
      if (env.status >= 500) req.log.error({ err }, "app error");
      return reply.code(env.status).send(env.body);
    }
    if (err.statusCode === 429) return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: { code: "BAD_REQUEST", message: err.message } });
    if (err.statusCode === 415) return reply.code(415).send({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json" } });
    req.log.error({ err }, "unhandled error");
    // Never leak internals (SQL, stack traces) to clients.
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error", requestId: req.id } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` } }));

  registerRoutes(app);
  registerSse(app);

  await app.register(swagger, { mode: "static", specification: { document: buildOpenApi() as never } });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });
  app.get("/api/openapi.json", async () => buildOpenApi());
  return app;
}
