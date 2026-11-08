import { eq, sql } from "drizzle-orm";
import { db, pool, schema } from "../db/client";
import type { Actor } from "../http/context";
import { bus } from "../http/bus";
import { executeOptimization } from "../domain/optimization";
import { executeSimulation } from "../domain/simulation";
import type { FastifyBaseLogger } from "fastify";

/**
 * Postgres-backed job queue (no Redis needed at this scale). Jobs are claimed
 * with FOR UPDATE SKIP LOCKED so several API instances could share the queue.
 * Heavy work (CP-SAT, SimPy) runs in the intelligence service; the worker only
 * orchestrates, so HTTP requests are never blocked by long computations.
 */
export function startWorker(log: FastifyBaseLogger) {
  let stopped = false;
  let running = 0;
  const MAX_CONCURRENT = 2;

  // Recover jobs left RUNNING by a crashed process.
  void pool.query(`update jobs set status='QUEUED', attempts = attempts + 1 where status='RUNNING' and started_at < now() - interval '10 minutes'`);

  async function claim() {
    const r = await pool.query(
      `update jobs set status='RUNNING', started_at=now(), attempts=attempts+1
        where id = (select id from jobs where status='QUEUED' order by created_at for update skip locked limit 1)
        returning id, type, ref_id, payload, facility_id`,
    );
    return r.rows[0] as { id: string; type: string; ref_id: string; payload: { actor: Actor }; facility_id: string } | undefined;
  }

  async function runJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>) {
    running++;
    const started = Date.now();
    try {
      if (job.type === "OPTIMIZATION") await executeOptimization(job.ref_id, job.payload.actor);
      else if (job.type === "SIMULATION") await executeSimulation(job.id, job.ref_id, job.payload.actor);
      else throw new Error(`unknown job type ${job.type}`);
      await db.update(schema.jobs).set({ status: sql`case when status = 'CANCELLED' then status else 'COMPLETED'::job_status end`, progress: 1, finishedAt: new Date() }).where(eq(schema.jobs.id, job.id));
      log.info({ jobId: job.id, type: job.type, ms: Date.now() - started }, "job completed");
    } catch (err) {
      await db.update(schema.jobs).set({ status: "FAILED", error: (err as Error).message, finishedAt: new Date() }).where(eq(schema.jobs.id, job.id));
      if (job.type === "SIMULATION") await pool.query(`update simulation_runs set job_status='FAILED', error=$2 where scenario_id=$1 and job_status in ('QUEUED','RUNNING')`, [job.ref_id, (err as Error).message]);
      log.error({ jobId: job.id, type: job.type, err: (err as Error).message }, "job failed");
    } finally {
      running--;
      bus.publish({ facilityId: job.facility_id, topics: job.type === "OPTIMIZATION" ? ["optimization"] : ["simulation"] });
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        if (running < MAX_CONCURRENT) {
          const job = await claim();
          if (job) {
            void runJob(job);
            continue;
          }
        }
      } catch (err) {
        log.error({ err: (err as Error).message }, "worker loop error");
      }
      await new Promise((r) => setTimeout(r, 750));
    }
  }
  void loop();
  return () => {
    stopped = true;
  };
}
