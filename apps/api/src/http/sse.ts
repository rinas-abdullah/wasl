import type { FastifyInstance } from "fastify";
import { bus, type LiveMessage } from "./bus";

/**
 * Server-Sent Events stream of invalidation messages for the actor's facility.
 * Clients re-fetch the affected queries; the stream never carries business data,
 * so authorisation stays on the regular REST endpoints.
 */
export function registerSse(app: FastifyInstance) {
  app.get("/api/stream", async (req, reply) => {
    const actor = req.actor;
    if (!actor) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Authentication required" } });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ facilityId: actor.facilityId, at: new Date().toISOString() })}\n\n`);
    const onMsg = (m: LiveMessage) => {
      if (m.facilityId !== actor.facilityId) return;
      res.write(`event: change\ndata: ${JSON.stringify(m)}\n\n`);
    };
    bus.on("message", onMsg);
    const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 20_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      bus.off("message", onMsg);
    });
  });
}
