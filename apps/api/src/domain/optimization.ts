import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  addMinutes,
  optimizationRunSchema,
  VEHICLE_SIZE_RANK,
  type OptimizationWeights,
  type SolverStatus,
} from "@wasl/shared";
import type { z } from "zod";
import { db, schema } from "../db/client";
import type { Actor } from "../http/context";
import { conflict, notFound, unprocessable } from "../http/errors";
import { intel } from "../intel/client";
import { recordEvent } from "./audit";
import { notify, ROLE_GROUPS } from "./notify";
import { INSPECTION_MIN, YARD_TO_DOCK_MIN } from "./readiness/engine";
import { dockCompatibility, isDockDown, requiredEquipment, requiredSkills, teamHasSkills, teamShiftWindow } from "./requirements";
import { loadSnapshot, type FacilitySnapshot, type TruckWithShipment } from "./snapshot";
import { bumpState, withTx } from "./tx";

type RunParams = z.infer<typeof optimizationRunSchema>;
const PRIORITY_WEIGHT = { LOW: 0.8, NORMAL: 1, HIGH: 1.5, CRITICAL: 2.5 } as const;
/** Minutes a called truck may arrive before its appointment. */
const EARLY_ARRIVAL_TOLERANCE_MIN = 30;
/** Grace period before lateness counts as tardiness. */
const TARDINESS_GRACE_MIN = 15;

export function defaultWeights(snapWeights?: unknown): OptimizationWeights {
  return optimizationRunSchema.shape.weights.parse(snapWeights ?? {});
}

/** Build the solver input from the live facility snapshot. Business rules (compatibility, skills) are resolved here, once. */
export function buildSolverInput(snap: FacilitySnapshot, params: RunParams) {
  const t0 = new Date(Math.ceil(snap.takenAt.getTime() / 60_000) * 60_000);
  const rel = (d: Date) => Math.round((d.getTime() - t0.getTime()) / 60_000);
  const tz = snap.facility.timezone;
  const horizonEnd = addMinutes(t0, params.horizonMin);

  const docks = snap.docks.map((d) => ({ id: d.id, code: d.code, down: isDockDown(d) }));
  const teams = snap.teams.map((t) => {
    const w = teamShiftWindow(t, t0, tz);
    return { id: t.id, code: t.code, available: t.status === "AVAILABLE", shift_start: Math.max(0, rel(w.start)), shift_end: Math.max(0, rel(w.end)) };
  });
  const equipmentCapacity: Record<string, number> = {};
  for (const e of snap.equipment) if (e.status === "AVAILABLE") equipmentCapacity[e.type] = (equipmentCapacity[e.type] ?? 0) + 1;

  // Committed work = active reservations (released / in-service trucks). These are fixed in the model.
  const fixedByTruck = new Map<string, { truck_id: string; code: string; dock_id: string | null; team_id: string | null; equipment_type: string | null; start: number; end: number }>();
  for (const r of snap.reservations) {
    if (r.endAt <= t0) continue;
    const t = snap.trucks.find((x) => x.id === r.truckId);
    const f = fixedByTruck.get(r.truckId) ?? { truck_id: r.truckId, code: t?.code ?? "?", dock_id: null, team_id: null, equipment_type: null, start: Math.max(0, rel(r.startAt)), end: Math.max(1, rel(r.endAt)) };
    if (r.resourceType === "DOCK") f.dock_id = r.resourceId;
    if (r.resourceType === "TEAM") f.team_id = r.resourceId;
    if (r.resourceType === "EQUIPMENT") f.equipment_type = snap.equipment.find((e) => e.id === r.resourceId)?.type ?? null;
    fixedByTruck.set(r.truckId, f);
  }
  const fixed = [...fixedByTruck.values()];

  const excluded: { truck: TruckWithShipment; reason: { en: string; ar: string } }[] = [];
  const trucks = [];
  for (const t of snap.trucks) {
    if (!["REGISTERED", "SCHEDULED", "WAITING"].includes(t.status)) continue;
    if (fixedByTruck.has(t.id)) continue;
    const target = t.appointment?.confirmedStart ?? t.requestedArrival;
    if (target > horizonEnd && !t.actualArrival) continue;
    if (t.shipment.qualityStatus === "HOLD" || t.shipment.qualityStatus === "ESCALATED") {
      excluded.push({ truck: t, reason: { en: `Quality ${t.shipment.qualityStatus}: excluded until the quality officer resolves it`, ar: `الجودة ${t.shipment.qualityStatus}: مستبعدة حتى يعالجها مسؤول الجودة` } });
      continue;
    }
    const compatible = snap.docks.filter((d) => !isDockDown(d) && dockCompatibility(d, t.vehicleType, t.shipment.cargoType).ok).map((d) => d.id);
    const skills = requiredSkills(t.shipment.cargoType, t.shipment.handlingMethod);
    const eligibleTeams = snap.teams.filter((tm) => tm.status === "AVAILABLE" && teamHasSkills(tm, skills)).map((tm) => tm.id);
    const needsInspection = ["REVIEW_REQUIRED", "UNDER_REVIEW"].includes(t.shipment.qualityStatus) || t.shipment.inspectionRequired;
    const service = t.serviceEstimateMin + (needsInspection ? INSPECTION_MIN : 0);
    const onSite = t.actualArrival !== null;
    const ready = onSite ? YARD_TO_DOCK_MIN : Math.max(snap.facility.travelTimeMin, rel(target) - EARLY_ARRIVAL_TOLERANCE_MIN);
    trucks.push({
      id: t.id,
      code: t.code,
      service_min: service,
      ready_min: ready,
      target_min: onSite ? Math.min(rel(target), YARD_TO_DOCK_MIN) : Math.max(ready, rel(target)),
      on_site: onSite,
      compatible_docks: compatible,
      eligible_teams: eligibleTeams,
      equipment_type: requiredEquipment(t.shipment.handlingMethod),
      needs_inspection: needsInspection,
      priority_weight: PRIORITY_WEIGHT[t.priority],
      current_dock_id: t.assignedDockId,
      current_start: t.appointment?.confirmedStart ? rel(t.appointment.confirmedStart) : null,
      vehicle_rank: VEHICLE_SIZE_RANK[t.vehicleType],
    });
  }
  const yardOccupied = snap.trucks.filter((t) => t.status === "EXCEPTION").length;
  return {
    t0,
    excluded,
    payload: {
      horizon_min: params.horizonMin,
      time_limit_sec: params.timeLimitSec,
      allow_unassigned: params.allowUnassigned,
      weights: params.weights,
      tardiness_grace_min: TARDINESS_GRACE_MIN,
      inspection_min: INSPECTION_MIN,
      inspectors: snap.qualityOfficerCount,
      yard_capacity: Math.max(0, snap.facility.yardCapacity - yardOccupied),
      docks,
      teams,
      equipment_capacity: equipmentCapacity,
      fixed,
      trucks,
    },
  };
}

interface SolverAssignment {
  truck_id: string;
  assigned: boolean;
  dock_id: string | null;
  team_id: string | null;
  start: number | null;
  end: number | null;
  waiting: number | null;
  tardiness: number | null;
}
interface SolverResult {
  status: SolverStatus;
  objective: number | null;
  best_bound: number | null;
  runtime_ms: number;
  solver_version: string;
  assignments: SolverAssignment[];
  breakdown: Record<string, number>;
  current_breakdown: Record<string, number>;
  constraint_summary: Record<string, unknown>;
  message?: string;
}

export async function enqueueOptimization(actor: Actor, input: Partial<RunParams> & { trigger?: string; label?: string }) {
  const [facility] = await db.select().from(schema.facilities).where(eq(schema.facilities.id, actor.facilityId));
  const params = optimizationRunSchema.parse({ ...input, weights: input.weights ?? (facility.settings as { defaultWeights?: unknown }).defaultWeights ?? {} });
  return withTx(async ({ tx, live }) => {
    const [run] = await tx
      .insert(schema.optimizationRuns)
      .values({ facilityId: actor.facilityId, label: input.label ?? params.label ?? null, trigger: input.trigger ?? "MANUAL", params, createdBy: actor.userId, approvalStatus: "PENDING" })
      .returning();
    await tx.insert(schema.jobs).values({ facilityId: actor.facilityId, type: "OPTIMIZATION", refId: run.id, payload: { actor }, createdBy: actor.userId });
    await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "OPTIMIZATION_REQUESTED", entityType: "optimization_run", entityId: run.id, actor, source: "USER", payload: { trigger: run.trigger, params } });
    live({ facilityId: actor.facilityId, topics: ["optimization", "events"], entityType: "optimization_run", entityId: run.id });
    return run;
  });
}

const hhmm = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

/** Executed by the job worker. */
export async function executeOptimization(runId: string, actor: Actor) {
  const [run] = await db.select().from(schema.optimizationRuns).where(eq(schema.optimizationRuns.id, runId));
  if (!run) throw notFound("Optimization run");
  await db.update(schema.optimizationRuns).set({ jobStatus: "RUNNING" }).where(eq(schema.optimizationRuns.id, runId));
  const snap = await loadSnapshot(db, run.facilityId);
  const params = optimizationRunSchema.parse(run.params);
  const { t0, payload, excluded } = buildSolverInput(snap, params);
  const tz = snap.facility.timezone;
  let result: SolverResult;
  try {
    result = await intel<SolverResult>("/optimize", payload, { timeoutMs: (params.timeLimitSec + 20) * 1000, retries: 1 });
  } catch (err) {
    await withTx(async ({ tx, live }) => {
      await tx.update(schema.optimizationRuns).set({ jobStatus: "FAILED", error: (err as Error).message, approvalStatus: "NOT_APPLICABLE", inputSnapshot: payload, completedAt: new Date() }).where(eq(schema.optimizationRuns.id, runId));
      await recordEvent(tx, { orgId: snap.facility.orgId, facilityId: run.facilityId, eventType: "OPTIMIZATION_FAILED", entityType: "optimization_run", entityId: runId, actor, source: "OPTIMIZER", payload: { error: (err as Error).message } });
      await notify(tx, { orgId: snap.facility.orgId, facilityId: run.facilityId, type: "OPTIMIZATION_FAILED", severity: "HIGH", title: "Optimization failed", titleAr: "فشل تشغيل التحسين", body: (err as Error).message, bodyAr: (err as Error).message, roles: ROLE_GROUPS.managers, entityType: "optimization_run", entityId: runId, actionRequired: true });
      live({ facilityId: run.facilityId, topics: ["optimization", "notifications", "events"] });
    });
    throw err;
  }

  const abs = (m: number | null) => (m === null ? null : addMinutes(t0, m));
  const intervals = [
    ...payload.fixed.filter((f) => f.dock_id).map((f) => ({ dock: f.dock_id!, start: f.start, end: f.end, code: f.code })),
    ...result.assignments.filter((a) => a.assigned && a.dock_id).map((a) => ({ dock: a.dock_id!, start: a.start!, end: a.end!, code: snap.trucks.find((t) => t.id === a.truck_id)?.code ?? "?" })),
  ];
  const candidates = result.assignments.map((a) => {
    const t = snap.trucks.find((x) => x.id === a.truck_id)!;
    const input = payload.trucks.find((x) => x.id === a.truck_id)!;
    const reasons: { en: string; ar: string }[] = [];
    const dock = snap.docks.find((d) => d.id === a.dock_id);
    const team = snap.teams.find((x) => x.id === a.team_id);
    const prevDock = snap.docks.find((d) => d.id === t.assignedDockId);
    const alternatives: { dockId: string; dockCode: string; earliestStart: string }[] = [];
    if (a.assigned && dock && team) {
      if (prevDock && prevDock.id !== dock.id) {
        if (isDockDown(prevDock)) reasons.push({ en: `Previous dock ${prevDock.code} is ${prevDock.status}`, ar: `الرصيف السابق ${prevDock.code} بحالة ${prevDock.status}` });
        else if (!input.compatible_docks.includes(prevDock.id)) reasons.push({ en: `Previous dock ${prevDock.code} is not compatible`, ar: `الرصيف السابق ${prevDock.code} غير متوافق` });
        else reasons.push({ en: `Moved from ${prevDock.code} to ${dock.code}: lower total weighted cost (objective)`, ar: `نُقلت من ${prevDock.code} إلى ${dock.code}: تكلفة إجمالية موزونة أقل` });
      } else if (!prevDock) reasons.push({ en: `First assignment to ${dock.code}`, ar: `أول تخصيص للرصيف ${dock.code}` });
      reasons.push({ en: `${dock.code} is operational and compatible with ${t.vehicleType}/${t.shipment.cargoType}${dock.features.includes("REEFER") ? " (reefer)" : ""}`, ar: `الرصيف ${dock.code} يعمل ومتوافق مع ${t.vehicleType}/${t.shipment.cargoType}${dock.features.includes("REEFER") ? " (مبرد)" : ""}` });
      reasons.push({ en: `${team.name} holds required skills (${requiredSkills(t.shipment.cargoType, t.shipment.handlingMethod).join(", ")}) and is on shift`, ar: `${team.nameAr} يملك المهارات المطلوبة وفي الوردية` });
      const prior = intervals.filter((iv) => iv.dock === dock.id && iv.end <= a.start! && iv.end > a.start! - 2 && iv.code !== t.code);
      if (a.start! > input.ready_min) {
        if (prior.length) reasons.push({ en: `Starts ${hhmm(abs(a.start)!, tz)} right after ${prior[0].code} finishes on ${dock.code}`, ar: `يبدأ ${hhmm(abs(a.start)!, tz)} مباشرة بعد انتهاء ${prior[0].code} على ${dock.code}` });
        else reasons.push({ en: `Starts ${hhmm(abs(a.start)!, tz)}, ${a.start! - input.ready_min} min after earliest readiness (crew/equipment/inspection or appointment window)`, ar: `يبدأ ${hhmm(abs(a.start)!, tz)}، بعد ${a.start! - input.ready_min} دقيقة من أول جاهزية (فريق/معدات/فحص أو نافذة الموعد)` });
      } else reasons.push({ en: `Starts at earliest readiness (${hhmm(abs(a.start)!, tz)})`, ar: `يبدأ عند أول جاهزية (${hhmm(abs(a.start)!, tz)})` });
      if (input.needs_inspection) reasons.push({ en: `Includes ${INSPECTION_MIN} min quality inspection with inspector capacity reserved`, ar: `يتضمن ${INSPECTION_MIN} دقيقة فحص جودة مع حجز سعة المفتش` });
      // Alternatives: earliest gap on other compatible docks given the proposed plan
      for (const dId of input.compatible_docks.filter((x) => x !== dock.id)) {
        const busy = intervals.filter((iv) => iv.dock === dId).sort((x, y) => x.start - y.start);
        let s = input.ready_min;
        for (const iv of busy) if (iv.start < s + input.service_min && s < iv.end) s = iv.end;
        alternatives.push({ dockId: dId, dockCode: snap.docks.find((d) => d.id === dId)!.code, earliestStart: abs(s)!.toISOString() });
      }
    } else {
      const why = input.compatible_docks.length === 0 ? { en: "No operational compatible dock", ar: "لا يوجد رصيف متوافق عامل" } : input.eligible_teams.length === 0 ? { en: "No available team with required skills", ar: "لا يوجد فريق متاح بالمهارات المطلوبة" } : { en: "No feasible slot within the planning horizon given capacity", ar: "لا توجد نافذة ممكنة ضمن أفق التخطيط بسبب السعة" };
      reasons.push(why);
    }
    return {
      runId,
      truckId: a.truck_id,
      dockId: a.dock_id,
      teamId: a.team_id,
      equipmentType: (input.equipment_type ?? null) as never,
      startAt: abs(a.start),
      endAt: abs(a.end),
      previousDockId: t.assignedDockId,
      previousStartAt: t.appointment?.confirmedStart ?? null,
      dockChanged: a.assigned && !!t.assignedDockId && t.assignedDockId !== a.dock_id,
      startShiftMin: a.assigned && t.appointment?.confirmedStart ? Math.round((abs(a.start)!.getTime() - t.appointment.confirmedStart.getTime()) / 60_000) : null,
      waitingMin: a.waiting,
      tardinessMin: a.tardiness,
      assigned: a.assigned,
      reasons,
      alternatives: alternatives.sort((x, y) => x.earliestStart.localeCompare(y.earliestStart)),
    };
  });
  for (const ex of excluded) {
    candidates.push({ runId, truckId: ex.truck.id, dockId: null, teamId: null, equipmentType: null as never, startAt: null, endAt: null, previousDockId: ex.truck.assignedDockId, previousStartAt: ex.truck.appointment?.confirmedStart ?? null, dockChanged: false, startShiftMin: null, waitingMin: null, tardinessMin: null, assigned: false, reasons: [ex.reason], alternatives: [] });
  }
  const feasible = result.status === "OPTIMAL" || result.status === "FEASIBLE";
  await withTx(async ({ tx, live }) => {
    if (candidates.length) await tx.insert(schema.optimizationCandidates).values(candidates);
    await tx
      .update(schema.optimizationRuns)
      .set({
        jobStatus: "COMPLETED",
        solverStatus: result.status,
        approvalStatus: feasible && result.assignments.some((a) => a.assigned) ? "PENDING" : "NOT_APPLICABLE",
        inputSnapshot: { ...payload, t0: t0.toISOString() },
        objectiveValue: result.objective,
        bestBound: result.best_bound,
        objectiveBreakdown: result.breakdown,
        currentPlanBreakdown: result.current_breakdown,
        constraintSummary: { ...result.constraint_summary, excluded: excluded.length, message: result.message ?? null },
        runtimeMs: result.runtime_ms,
        solverVersion: result.solver_version,
        baseStateVersion: snap.facility.stateVersion,
        completedAt: new Date(),
      })
      .where(eq(schema.optimizationRuns.id, runId));
    await recordEvent(tx, { orgId: snap.facility.orgId, facilityId: run.facilityId, eventType: "OPTIMIZATION_COMPLETED", entityType: "optimization_run", entityId: runId, actor, source: "OPTIMIZER", payload: { status: result.status, objective: result.objective, runtimeMs: result.runtime_ms, assigned: result.assignments.filter((a) => a.assigned).length, unassigned: result.assignments.filter((a) => !a.assigned).length + excluded.length } });
    if (feasible) {
      await notify(tx, { orgId: snap.facility.orgId, facilityId: run.facilityId, type: "PLAN_APPROVAL_REQUIRED", severity: "MEDIUM", title: `Plan ready for approval (${result.status})`, titleAr: `خطة جاهزة للاعتماد (${result.status})`, body: `${result.assignments.filter((a) => a.assigned).length} assignments, objective ${result.objective?.toFixed(1)}`, bodyAr: `${result.assignments.filter((a) => a.assigned).length} تخصيصات، قيمة الهدف ${result.objective?.toFixed(1)}`, roles: ROLE_GROUPS.managers, entityType: "optimization_run", entityId: runId, actionRequired: true });
    } else {
      await notify(tx, { orgId: snap.facility.orgId, facilityId: run.facilityId, type: "OPTIMIZATION_FAILED", severity: "HIGH", title: `Optimization ${result.status}`, titleAr: `نتيجة التحسين ${result.status}`, body: result.message ?? "No feasible plan", bodyAr: result.message ?? "لا توجد خطة ممكنة", roles: ROLE_GROUPS.managers, entityType: "optimization_run", entityId: runId });
    }
    live({ facilityId: run.facilityId, topics: ["optimization", "decisions", "notifications", "events"], entityType: "optimization_run", entityId: runId });
  });
}

export async function getRun(actor: Actor, id: string) {
  const [run] = await db.select().from(schema.optimizationRuns).where(and(eq(schema.optimizationRuns.id, id), eq(schema.optimizationRuns.facilityId, actor.facilityId)));
  if (!run) throw notFound("Optimization run");
  const candidates = await db
    .select({ c: schema.optimizationCandidates, truckCode: schema.trucks.code, truckStatus: schema.trucks.status, dockCode: schema.docks.code, teamCode: schema.workforceTeams.code })
    .from(schema.optimizationCandidates)
    .innerJoin(schema.trucks, eq(schema.trucks.id, schema.optimizationCandidates.truckId))
    .leftJoin(schema.docks, eq(schema.docks.id, schema.optimizationCandidates.dockId))
    .leftJoin(schema.workforceTeams, eq(schema.workforceTeams.id, schema.optimizationCandidates.teamId))
    .where(eq(schema.optimizationCandidates.runId, id))
    .orderBy(schema.optimizationCandidates.startAt);
  const docks = await db.select({ id: schema.docks.id, code: schema.docks.code }).from(schema.docks).where(eq(schema.docks.facilityId, actor.facilityId));
  const [facility] = await db.select({ stateVersion: schema.facilities.stateVersion }).from(schema.facilities).where(eq(schema.facilities.id, actor.facilityId));
  return {
    ...run,
    isStale: run.baseStateVersion !== null && facility.stateVersion !== run.baseStateVersion,
    candidates: candidates.map((r) => ({ ...r.c, truckCode: r.truckCode, truckStatus: r.truckStatus, dockCode: r.dockCode, teamCode: r.teamCode, previousDockCode: docks.find((d) => d.id === r.c.previousDockId)?.code ?? null })),
  };
}

/** Preview → Approval → Commit. Approval converts the plan into confirmed appointments; releases still go through the readiness engine. */
export async function approveRun(actor: Actor, id: string, reason?: string) {
  return withTx(async ({ tx, live }) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${actor.facilityId}))`);
    const [run] = await tx.select().from(schema.optimizationRuns).where(and(eq(schema.optimizationRuns.id, id), eq(schema.optimizationRuns.facilityId, actor.facilityId))).for("update");
    if (!run) throw notFound("Optimization run");
    if (run.jobStatus !== "COMPLETED" || run.approvalStatus !== "PENDING") throw unprocessable("NOT_APPROVABLE", `Run is ${run.jobStatus}/${run.approvalStatus}`);
    const cands = await tx.select().from(schema.optimizationCandidates).where(and(eq(schema.optimizationCandidates.runId, id), eq(schema.optimizationCandidates.assigned, true)));
    const snap = await loadSnapshot(tx, actor.facilityId);
    // Re-validate every candidate against the CURRENT state (stale-plan protection).
    const problems: { truckId: string; code: string; problem: string }[] = [];
    for (const c of cands) {
      const t = snap.trucks.find((x) => x.id === c.truckId);
      const d = snap.docks.find((x) => x.id === c.dockId);
      if (!t || !["REGISTERED", "SCHEDULED", "WAITING"].includes(t.status)) problems.push({ truckId: c.truckId, code: t?.code ?? "?", problem: `truck status is now ${t?.status ?? "closed"}` });
      else if (!d || isDockDown(d)) problems.push({ truckId: c.truckId, code: t.code, problem: `dock ${d?.code} is not operational` });
      else if (snap.reservations.some((r) => r.resourceType === "DOCK" && r.resourceId === d.id && r.truckId !== t.id && r.startAt < c.endAt! && c.startAt! < r.endAt)) problems.push({ truckId: c.truckId, code: t.code, problem: `dock ${d.code} now has a conflicting reservation` });
    }
    if (problems.length) {
      await tx.update(schema.optimizationRuns).set({ approvalStatus: "STALE" }).where(eq(schema.optimizationRuns.id, id));
      throw conflict("PLAN_STALE", "Operational state changed since the plan was computed. Re-run optimisation.", problems);
    }
    const now = new Date();
    const [decision] = await tx
      .insert(schema.decisions)
      .values({ facilityId: actor.facilityId, optimizationRunId: id, type: "PLAN_APPROVAL", status: "EXECUTED", reasons: [{ en: `Approved plan with ${cands.length} assignments (${run.solverStatus})`, ar: `اعتماد خطة بـ ${cands.length} تخصيصات (${run.solverStatus})` }], impact: { objective: run.objectiveValue, breakdown: run.objectiveBreakdown, current: run.currentPlanBreakdown }, actorId: actor.userId, resolvedAt: now, executionResult: { applied: cands.length } })
      .returning();
    for (const c of cands) {
      const t = snap.trucks.find((x) => x.id === c.truckId)!;
      if (t.appointment) {
        await tx.update(schema.appointments).set({ status: "CONFIRMED", dockId: c.dockId, proposedStart: c.startAt, confirmedStart: c.startAt, durationMin: Math.round((c.endAt!.getTime() - c.startAt!.getTime()) / 60_000), source: "OPTIMIZATION", optimizationRunId: id, version: t.appointment.version + 1, updatedAt: now }).where(eq(schema.appointments.id, t.appointment.id));
      } else {
        await tx.insert(schema.appointments).values({ facilityId: actor.facilityId, truckId: t.id, dockId: c.dockId, status: "CONFIRMED", requestedStart: t.requestedArrival, proposedStart: c.startAt, confirmedStart: c.startAt, durationMin: Math.round((c.endAt!.getTime() - c.startAt!.getTime()) / 60_000), source: "OPTIMIZATION", optimizationRunId: id });
      }
      await tx.update(schema.trucks).set({ assignedDockId: c.dockId, reassignmentRequired: false, status: t.status === "REGISTERED" ? "SCHEDULED" : t.status, version: t.version + 1, updatedAt: now }).where(eq(schema.trucks.id, t.id));
      if (c.dockChanged || c.startShiftMin !== 0) {
        await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: t.appointment?.confirmedStart ? "APPOINTMENT_RESCHEDULED" : "APPOINTMENT_SCHEDULED", entityType: "truck", entityId: t.id, entityLabel: t.code, actor, source: "OPTIMIZER", payload: { runId: id, dockId: c.dockId, confirmedStart: c.startAt, previousDockId: t.assignedDockId, previousStart: t.appointment?.confirmedStart ?? null }, previousState: { status: t.status, assignedDockId: t.assignedDockId }, newState: { status: t.status === "REGISTERED" ? "SCHEDULED" : t.status, assignedDockId: c.dockId }, correlationId: decision.id });
      }
    }
    await tx.update(schema.decisions).set({ status: "SUPERSEDED", resolvedAt: now }).where(and(inArray(schema.decisions.truckId, cands.map((c) => c.truckId).concat(["00000000-0000-0000-0000-000000000000"])), eq(schema.decisions.status, "PENDING_REVIEW"), eq(schema.decisions.type, "REASSIGNMENT")));
    await tx.update(schema.optimizationRuns).set({ approvalStatus: "APPROVED", decidedBy: actor.userId, decidedAt: now, decisionReason: reason ?? null }).where(eq(schema.optimizationRuns.id, id));
    // Other pending runs computed on older state are now superseded.
    await tx.update(schema.optimizationRuns).set({ approvalStatus: "STALE" }).where(and(eq(schema.optimizationRuns.facilityId, actor.facilityId), eq(schema.optimizationRuns.approvalStatus, "PENDING"), sql`${schema.optimizationRuns.id} <> ${id}`));
    await tx.update(schema.notifications).set({ resolvedAt: now }).where(and(eq(schema.notifications.entityId, id), eq(schema.notifications.type, "PLAN_APPROVAL_REQUIRED")));
    await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "PLAN_APPROVED", entityType: "optimization_run", entityId: id, actor, source: "USER", payload: { applied: cands.length, reason: reason ?? null, decisionId: decision.id }, correlationId: decision.id });
    await bumpState(tx, actor.facilityId);
    live({ facilityId: actor.facilityId, topics: ["optimization", "appointments", "trucks", "docks", "twin", "dashboard", "events", "decisions", "notifications"], eventType: "PLAN_APPROVED", entityType: "optimization_run", entityId: id });
    return { approved: true, applied: cands.length, decisionId: decision.id };
  });
}

export async function rejectRun(actor: Actor, id: string, reason?: string) {
  return withTx(async ({ tx, live }) => {
    const [run] = await tx.select().from(schema.optimizationRuns).where(and(eq(schema.optimizationRuns.id, id), eq(schema.optimizationRuns.facilityId, actor.facilityId))).for("update");
    if (!run) throw notFound("Optimization run");
    if (run.approvalStatus !== "PENDING") throw unprocessable("NOT_REJECTABLE", `Run approval status is ${run.approvalStatus}`);
    await tx.update(schema.optimizationRuns).set({ approvalStatus: "REJECTED", decidedBy: actor.userId, decidedAt: new Date(), decisionReason: reason ?? null }).where(eq(schema.optimizationRuns.id, id));
    await tx.update(schema.notifications).set({ resolvedAt: new Date() }).where(and(eq(schema.notifications.entityId, id), eq(schema.notifications.type, "PLAN_APPROVAL_REQUIRED")));
    await recordEvent(tx, { orgId: actor.orgId, facilityId: actor.facilityId, eventType: "PLAN_REJECTED", entityType: "optimization_run", entityId: id, actor, source: "USER", payload: { reason: reason ?? null } });
    live({ facilityId: actor.facilityId, topics: ["optimization", "events", "decisions", "notifications"] });
    return { rejected: true };
  });
}

export async function listRuns(actor: Actor, limit = 30) {
  return db.select().from(schema.optimizationRuns).where(eq(schema.optimizationRuns.facilityId, actor.facilityId)).orderBy(desc(schema.optimizationRuns.createdAt)).limit(limit);
}
