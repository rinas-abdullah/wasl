import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { simulationRunSchema, type SimulationPolicy } from "@wasl/shared";
import type { z } from "zod";
import { db, schema } from "../db/client";
import type { Actor } from "../http/context";
import { notFound, unprocessable } from "../http/errors";
import { bus } from "../http/bus";
import { intel } from "../intel/client";
import { recordEvent } from "./audit";
import { notify, ROLE_GROUPS } from "./notify";
import { withTx } from "./tx";

type RunInput = z.infer<typeof simulationRunSchema>;

export async function createSimulation(actor: Actor, input: RunInput) {
  return withTx(async ({ tx, live }) => {
    const [scenario] = await tx
      .insert(schema.simulationScenarios)
      .values({ orgId: actor.orgId, facilityId: actor.facilityId, name: input.scenarioName, preset: input.preset ?? null, params: input.params, seed: input.seed, replications: input.replications, policies: input.policies, createdBy: actor.userId })
      .returning();
    const runs = [];
    for (let r = 0; r < input.replications; r++) {
      for (const policy of input.policies) {
        // Common random numbers: every policy in replication r sees the same world (seed + r).
        runs.push({ scenarioId: scenario.id, policy, replication: r, seed: input.seed + r });
      }
    }
    await tx.insert(schema.simulationRuns).values(runs);
    const [job] = await tx.insert(schema.jobs).values({ facilityId: actor.facilityId, type: "SIMULATION", refId: scenario.id, payload: { actor }, createdBy: actor.userId }).returning();
    live({ facilityId: actor.facilityId, topics: ["simulation"], entityType: "simulation_scenario", entityId: scenario.id });
    return { scenario, jobId: job.id, runs: runs.length };
  });
}

export async function executeSimulation(jobId: string, scenarioId: string, actor: Actor) {
  const [scenario] = await db.select().from(schema.simulationScenarios).where(eq(schema.simulationScenarios.id, scenarioId));
  if (!scenario) throw notFound("Scenario");
  const runs = await db.select().from(schema.simulationRuns).where(eq(schema.simulationRuns.scenarioId, scenarioId)).orderBy(asc(schema.simulationRuns.replication), asc(schema.simulationRuns.policy));
  let done = 0;
  for (const run of runs) {
    const [job] = await db.select({ status: schema.jobs.status }).from(schema.jobs).where(eq(schema.jobs.id, jobId));
    if (job?.status === "CANCELLED") {
      await db.update(schema.simulationRuns).set({ jobStatus: "CANCELLED" }).where(and(eq(schema.simulationRuns.scenarioId, scenarioId), eq(schema.simulationRuns.jobStatus, "QUEUED")));
      return;
    }
    await db.update(schema.simulationRuns).set({ jobStatus: "RUNNING" }).where(eq(schema.simulationRuns.id, run.id));
    try {
      const res = await intel<{ metrics: Record<string, number>; timeseries: Record<string, unknown>; events: { t: number; type: string; truck: string | null; dock: string | null; payload?: Record<string, unknown> }[]; runtime_ms: number; sim_version: string; model_used: string }>(
        "/simulate",
        { params: scenario.params, policy: run.policy, seed: run.seed },
        { timeoutMs: 180_000, retries: 1 },
      );
      await db.transaction(async (tx) => {
        await tx.delete(schema.simulationEvents).where(eq(schema.simulationEvents.runId, run.id));
        for (let i = 0; i < res.events.length; i += 1000) {
          await tx.insert(schema.simulationEvents).values(res.events.slice(i, i + 1000).map((e, k) => ({ runId: run.id, seq: i + k, tMin: e.t, eventType: e.type, truckRef: e.truck, dockRef: e.dock, payload: e.payload ?? {} })));
        }
        await tx
          .update(schema.simulationRuns)
          .set({ jobStatus: "COMPLETED", metrics: res.metrics, timeseries: { ...res.timeseries, modelUsed: res.model_used }, eventCount: res.events.length, runtimeMs: res.runtime_ms, simVersion: res.sim_version, completedAt: new Date() })
          .where(eq(schema.simulationRuns.id, run.id));
      });
    } catch (err) {
      await db.update(schema.simulationRuns).set({ jobStatus: "FAILED", error: (err as Error).message }).where(eq(schema.simulationRuns.id, run.id));
    }
    done++;
    await db.update(schema.jobs).set({ progress: done / runs.length }).where(eq(schema.jobs.id, jobId));
    bus.publish({ facilityId: scenario.facilityId, topics: ["simulation"], entityType: "simulation_scenario", entityId: scenarioId });
  }
  await withTx(async ({ tx, live }) => {
    await recordEvent(tx, { orgId: scenario.orgId, facilityId: scenario.facilityId, eventType: "SIMULATION_COMPLETED", entityType: "simulation_scenario", entityId: scenarioId, entityLabel: scenario.name, actor, source: "SIMULATOR", payload: { runs: runs.length, policies: scenario.policies, seed: scenario.seed, replications: scenario.replications } });
    await notify(tx, { orgId: scenario.orgId, facilityId: scenario.facilityId, type: "SIMULATION_COMPLETED", severity: "INFO", title: `Simulation completed: ${scenario.name}`, titleAr: `اكتملت المحاكاة: ${scenario.name}`, body: `${runs.length} runs (${scenario.policies.join(", ")})`, bodyAr: `${runs.length} تشغيلات (${scenario.policies.join("، ")})`, userId: actor.userId, entityType: "simulation_scenario", entityId: scenarioId });
    live({ facilityId: scenario.facilityId, topics: ["simulation", "notifications", "events"] });
  });
}

const METRICS = ["avg_wait_min", "median_wait_min", "p95_wait_min", "avg_total_delay_min", "avg_turnaround_min", "avg_queue_length", "max_queue_length", "dock_utilization", "team_utilization", "avg_quality_response_min", "schedule_changes", "makespan_min", "served_within_duration"];
// two-sided 95% t critical values for df = n-1
const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262 };

export function summarise(runs: { policy: string; metrics: Record<string, number> | null; jobStatus: string }[]) {
  const policies = [...new Set(runs.map((r) => r.policy))];
  return policies.map((p) => {
    const ok = runs.filter((r) => r.policy === p && r.jobStatus === "COMPLETED" && r.metrics);
    const stats: Record<string, { mean: number; ci95: number | null; n: number }> = {};
    for (const m of METRICS) {
      const xs = ok.map((r) => Number(r.metrics![m] ?? 0));
      if (!xs.length) continue;
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : 0;
      stats[m] = { mean, ci95: xs.length > 1 ? (T95[xs.length - 1] ?? 1.96) * (sd / Math.sqrt(xs.length)) : null, n: xs.length };
    }
    return { policy: p as SimulationPolicy, completed: ok.length, stats };
  });
}

export async function getScenario(actor: Actor, id: string) {
  const [scenario] = await db.select().from(schema.simulationScenarios).where(and(eq(schema.simulationScenarios.id, id), eq(schema.simulationScenarios.facilityId, actor.facilityId)));
  if (!scenario) throw notFound("Scenario");
  const runs = await db.select().from(schema.simulationRuns).where(eq(schema.simulationRuns.scenarioId, id)).orderBy(asc(schema.simulationRuns.replication), asc(schema.simulationRuns.policy));
  const [job] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.refId, id), eq(schema.jobs.type, "SIMULATION"))).orderBy(desc(schema.jobs.createdAt)).limit(1);
  return { ...scenario, job: job ?? null, runs, summary: summarise(runs) };
}

export async function listScenarios(actor: Actor) {
  const rows = await db
    .select({ s: schema.simulationScenarios, completed: sql<number>`count(${schema.simulationRuns.id}) filter (where ${schema.simulationRuns.jobStatus} = 'COMPLETED')::int`, total: sql<number>`count(${schema.simulationRuns.id})::int` })
    .from(schema.simulationScenarios)
    .leftJoin(schema.simulationRuns, eq(schema.simulationRuns.scenarioId, schema.simulationScenarios.id))
    .where(eq(schema.simulationScenarios.facilityId, actor.facilityId))
    .groupBy(schema.simulationScenarios.id)
    .orderBy(desc(schema.simulationScenarios.createdAt))
    .limit(50);
  return rows.map((r) => ({ ...r.s, completedRuns: r.completed, totalRuns: r.total }));
}

export async function getRunEvents(actor: Actor, runId: string) {
  const [run] = await db
    .select({ r: schema.simulationRuns, facilityId: schema.simulationScenarios.facilityId, params: schema.simulationScenarios.params })
    .from(schema.simulationRuns)
    .innerJoin(schema.simulationScenarios, eq(schema.simulationScenarios.id, schema.simulationRuns.scenarioId))
    .where(eq(schema.simulationRuns.id, runId));
  if (!run || run.facilityId !== actor.facilityId) throw notFound("Simulation run");
  const events = await db.select().from(schema.simulationEvents).where(eq(schema.simulationEvents.runId, runId)).orderBy(asc(schema.simulationEvents.seq));
  return { run: run.r, params: run.params, events };
}

export async function rerunScenario(actor: Actor, id: string) {
  const s = await getScenario(actor, id);
  return createSimulation(actor, { scenarioName: `${s.name} (re-run)`, preset: (s.preset ?? undefined) as RunInput["preset"], seed: s.seed, replications: s.replications, policies: s.policies as SimulationPolicy[], params: s.params as RunInput["params"] });
}

export async function cancelSimulation(actor: Actor, id: string) {
  const [job] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.refId, id), eq(schema.jobs.type, "SIMULATION"), eq(schema.jobs.facilityId, actor.facilityId), inArray(schema.jobs.status, ["QUEUED", "RUNNING"])));
  if (!job) throw unprocessable("NOT_CANCELLABLE", "No queued or running job for this scenario");
  await db.update(schema.jobs).set({ status: "CANCELLED", finishedAt: new Date() }).where(eq(schema.jobs.id, job.id));
  await db.update(schema.simulationRuns).set({ jobStatus: "CANCELLED" }).where(and(eq(schema.simulationRuns.scenarioId, id), eq(schema.simulationRuns.jobStatus, "QUEUED")));
  bus.publish({ facilityId: actor.facilityId, topics: ["simulation"] });
  return { cancelled: true };
}
