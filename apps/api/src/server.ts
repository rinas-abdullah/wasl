import { buildApp } from "./app";
import { config } from "./config";
import { pool } from "./db/client";
import { startWorker } from "./jobs/worker";
import { syncModelRegistry } from "./domain/models";

const app = await buildApp();
const stopWorker = config.disableWorker ? () => {} : startWorker(app.log);
syncModelRegistry().then((n) => app.log.info({ models: n }, "model registry synced")).catch((e) => app.log.warn({ err: (e as Error).message }, "model registry not synced (intelligence service unreachable)"));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  stopWorker();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.port, host: config.host });
