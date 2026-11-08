import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { READINESS_CHECKS, type ReadinessCheckId } from "@wasl/shared";
import { schema, type Tx } from "../../db/client";
import type { Actor } from "../../http/context";
import { AppError, conflict, forbidden, isExclusionViolation, notFound, unprocessable } from "../../http/errors";
import { recordEvent } from "../audit";
import { notify, ROLE_GROUPS } from "../notify";
import { loadSnapshot } from "../snapshot";
import { bumpState, withTx } from "../tx";
import { evaluateReadiness, type EngineOutput } from "./engine";

async function lockFacility(tx: Tx, facilityId: string) {
  // Serialise release decisions per facility so capacity counts (yard, gate)
  // cannot be raced. Resource double-booking is additionally prevented by the
  // reservations EXCLUDE constraint.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${facilityId}))`);
}

async function persistEvaluation(tx: Tx, actor: Actor | null, facilityId: string, out: EngineOutput) {
  const { plan, inputSnapshot, ...result } = out;
  const [row] = await tx
    .insert(schema.readinessEvaluations)
    .values({
      facilityId,
      truckId: out.truckId,
      outcome: out.outcome,
      proposedCallTime: new Date(out.proposedCallTime),
      checks: out.checks,
      inputSnapshot,
      result: { ...result, plan: { ...plan, windowStart: plan.windowStart.toISOString(), windowEnd: plan.windowEnd.toISOString() } },
      nextReevaluationAt: out.nextReevaluationAt ? new Date(out.nextReevaluationAt) : null,
      engineVersion: out.engineVersion,
      evaluatedBy: actor?.userId ?? null,
    })
    .returning();
  return row;
}

function failingReasons(out: EngineOutput, overridden: readonly string[] = []) {
  return out.checks.filter((c) => c.result === "FAIL" && c.blocking && !overridden.includes(c.checkId)).map((c) => ({ en: c.reason, ar: c.reasonAr, checkId: c.checkId }));
}

/** Evaluate readiness, persist the evaluation and (for non-READY) a decision awaiting supervisor review. */
export async function evaluateAndRecord(actor: Actor, truckId: string, proposedCallTime?: Date) {
  return withTx(async ({ tx, live }) => {
    const snap = await loadSnapshot(tx, actor.facilityId);
    const truck = snap.trucks.find((t) => t.id === truckId);
    if (!truck) throw notFound("Active truck");
    const out = evaluateReadiness(snap, truck, proposedCallTime ?? new Date());
    const evaluation = await persistEvaluation(tx, actor, actor.facilityId, out);

    const [prev] = await tx
      .select()
      .from(schema.decisions)
      .where(and(eq(schema.decisions.truckId, truckId), eq(schema.decisions.status, "PENDING_REVIEW")))
      .orderBy(desc(schema.decisions.createdAt))
      .limit(1);
    await tx
      .update(schema.decisions)
      .set({ status: "SUPERSEDED", resolvedAt: new Date() })
      .where(and(eq(schema.decisions.truckId, truckId), eq(schema.decisions.status, "PENDING_REVIEW")));

    let decisionId: string | null = null;
    if (out.outcome !== "READY") {
      const firstFail = out.checks.find((c) => c.result === "FAIL" && c.blocking);
      const [d] = await tx
        .insert(schema.decisions)
        .values({
          facilityId: actor.facilityId,
          truckId,
          readinessEvaluationId: evaluation.id,
          type: out.outcome === "REASSIGNMENT_REQUIRED" ? "REASSIGNMENT" : "HOLD",
          status: "PENDING_REVIEW",
          outcome: out.outcome,
          reasons: failingReasons(out),
          suggestedAction: firstFail?.suggestedAction ? { en: firstFail.suggestedAction, ar: firstFail.suggestedActionAr ?? firstFail.suggestedAction } : null,
          alternatives: out.alternatives,
          impact: { nextReevaluationAt: out.nextReevaluationAt, affectedResources: out.affectedResources },
          actorId: actor.userId,
        })
        .returning({ id: schema.decisions.id });
      decisionId = d.id;
      if (!prev || prev.outcome !== out.outcome) {
        await notify(tx, {
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          type: "READINESS_HOLD",
          severity: out.outcome === "HOLD" ? "MEDIUM" : "HIGH",
          title: `${truck.code}: ${out.outcome}`,
          titleAr: `${truck.code}: ${out.outcome}`,
          body: out.summary,
          bodyAr: out.summaryAr,
          roles: ROLE_GROUPS.ops,
          entityType: "truck",
          entityId: truckId,
          actionRequired: true,
        });
      }
    }
    await recordEvent(tx, {
      orgId: actor.orgId,
      facilityId: actor.facilityId,
      eventType: "READINESS_EVALUATED",
      entityType: "truck",
      entityId: truckId,
      entityLabel: truck.code,
      actor,
      source: "READINESS_ENGINE",
      payload: { outcome: out.outcome, evaluationId: evaluation.id, failing: failingReasons(out).map((r) => r.checkId), proposedCallTime: out.proposedCallTime },
    });
    live({ facilityId: actor.facilityId, topics: ["readiness", "decisions", "notifications"], entityType: "truck", entityId: truckId });
    const { plan: _plan, inputSnapshot, ...result } = out;
    return { evaluationId: evaluation.id, decisionId, ...result, inputSnapshot };
  });
}

/**
 * Release (call) a truck. Re-evaluates readiness inside the transaction under a
 * facility lock, validates overrides against policy, then reserves dock, crew
 * and equipment. The EXCLUDE constraint rejects any concurrent double booking.
 */
export async function releaseTruck(actor: Actor, input: { truckId: string; proposedCallTime?: Date; override?: { checkIds: string[]; reason: string } }) {
  if (input.override && !actor.permissions.includes("release:override")) throw forbidden("Permission 'release:override' is required to override readiness checks");
  try {
    return await withTx(async ({ tx, live }) => {
      await lockFacility(tx, actor.facilityId);
      await tx.execute(sql`select id from trucks where id = ${input.truckId} for update`);
      const snap = await loadSnapshot(tx, actor.facilityId);
      const truck = snap.trucks.find((t) => t.id === input.truckId);
      if (!truck) throw notFound("Active truck");
      const callTime = input.proposedCallTime ?? new Date();
      const out = evaluateReadiness(snap, truck, callTime);
      const failing = out.checks.filter((c) => c.result === "FAIL" && c.blocking);

      let overridden: string[] = [];
      if (input.override && failing.length) {
        const notOverridable = failing.filter((c) => !READINESS_CHECKS[c.checkId as ReadinessCheckId].overridable);
        if (notOverridable.length) {
          throw unprocessable("NON_OVERRIDABLE_CHECKS", "These checks are safety/capacity constraints and cannot be overridden", notOverridable.map((c) => ({ checkId: c.checkId, reason: c.reason })));
        }
        const missing = failing.filter((c) => !input.override!.checkIds.includes(c.checkId));
        if (missing.length) throw unprocessable("OVERRIDE_INCOMPLETE", "Override must explicitly list every failing check", missing.map((c) => c.checkId));
        overridden = failing.map((c) => c.checkId);
      }
      const evaluation = await persistEvaluation(tx, actor, actor.facilityId, out);
      const blocked = failing.filter((c) => !overridden.includes(c.checkId));
      if (blocked.length) {
        return { released: false as const, outcome: out.outcome, evaluationId: evaluation.id, checks: out.checks, summary: out.summary, summaryAr: out.summaryAr, alternatives: out.alternatives, nextReevaluationAt: out.nextReevaluationAt };
      }
      if (!out.plan.dockId || !out.plan.teamId) throw conflict("PLAN_INCOMPLETE", "Readiness plan is missing dock or team");

      await tx
        .update(schema.decisions)
        .set({ status: "SUPERSEDED", resolvedAt: new Date() })
        .where(and(eq(schema.decisions.truckId, truck.id), eq(schema.decisions.status, "PENDING_REVIEW")));
      const [decision] = await tx
        .insert(schema.decisions)
        .values({
          facilityId: actor.facilityId,
          truckId: truck.id,
          readinessEvaluationId: evaluation.id,
          type: overridden.length ? "OVERRIDE_RELEASE" : "RELEASE",
          status: "EXECUTED",
          outcome: out.outcome,
          reasons: out.checks.filter((c) => c.result === "PASS" || c.result === "WARN").map((c) => ({ en: c.reason, ar: c.reasonAr })),
          overriddenChecks: overridden,
          overrideReason: input.override?.reason ?? null,
          actorId: actor.userId,
          resolvedAt: new Date(),
          executionResult: { windowStart: out.plan.windowStart.toISOString(), windowEnd: out.plan.windowEnd.toISOString(), dockId: out.plan.dockId, teamId: out.plan.teamId, equipmentId: out.plan.equipmentId },
        })
        .returning();

      const resv = [
        { resourceType: "DOCK" as const, resourceId: out.plan.dockId },
        { resourceType: "TEAM" as const, resourceId: out.plan.teamId },
        ...(out.plan.equipmentId ? [{ resourceType: "EQUIPMENT" as const, resourceId: out.plan.equipmentId }] : []),
      ];
      // Release any stale reservations of this truck (e.g. suspended after a dock failure).
      await tx.update(schema.resourceReservations).set({ status: "CANCELLED", updatedAt: new Date() }).where(and(eq(schema.resourceReservations.truckId, truck.id), sql`status in ('ACTIVE','SUSPENDED')`));
      await tx.insert(schema.resourceReservations).values(
        resv.map((r) => ({ ...r, facilityId: actor.facilityId, truckId: truck.id, decisionId: decision.id, startAt: out.plan.windowStart, endAt: out.plan.windowEnd, status: "ACTIVE" as const })),
      );
      const now = new Date();
      await tx
        .update(schema.trucks)
        .set({ status: "CALLED", calledAt: now, reassignmentRequired: false, version: truck.version + 1, updatedAt: now })
        .where(eq(schema.trucks.id, truck.id));

      // Ensure a handover record exists for the shipment.
      await tx
        .insert(schema.handoverRecords)
        .values({ facilityId: actor.facilityId, shipmentId: truck.shipmentId, truckId: truck.id, reference: `HO-${truck.code.replace(/\D/g, "")}-${randomBytes(2).toString("hex").toUpperCase()}`, qrToken: randomBytes(24).toString("base64url"), status: truck.actualArrival ? "ARRIVAL_CONFIRMED" : "PENDING_ARRIVAL" })
        .onConflictDoNothing();

      await recordEvent(tx, {
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        eventType: "TRUCK_RELEASED",
        entityType: "truck",
        entityId: truck.id,
        entityLabel: truck.code,
        actor,
        source: "READINESS_ENGINE",
        payload: { decisionId: decision.id, evaluationId: evaluation.id, dockId: out.plan.dockId, teamId: out.plan.teamId, equipmentId: out.plan.equipmentId, windowStart: out.plan.windowStart, windowEnd: out.plan.windowEnd, overridden },
        previousState: { status: truck.status, assignedDockId: truck.assignedDockId },
        newState: { status: "CALLED", assignedDockId: out.plan.dockId },
        correlationId: decision.id,
      });
      if (overridden.length) {
        await recordEvent(tx, {
          orgId: actor.orgId,
          facilityId: actor.facilityId,
          eventType: "RELEASE_OVERRIDDEN",
          entityType: "truck",
          entityId: truck.id,
          entityLabel: truck.code,
          actor,
          source: "USER",
          payload: { overridden, reason: input.override?.reason },
          correlationId: decision.id,
        });
      }
      const dockCode = snap.docks.find((d) => d.id === out.plan.dockId)?.code;
      const hh = new Intl.DateTimeFormat("en-GB", { timeZone: snap.facility.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(out.plan.windowStart);
      await notify(tx, {
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        type: "TRUCK_CALLED",
        severity: "INFO",
        title: `${truck.code} called to ${dockCode} (${hh})`,
        titleAr: `استدعاء ${truck.code} إلى ${dockCode} (${hh})`,
        body: `Proceed to ${dockCode}. Expected at dock ${hh}.`,
        bodyAr: `توجه إلى ${dockCode}. الوصول المتوقع للرصيف ${hh}.`,
        roles: ["CARRIER_OPERATOR", "DRIVER", ...ROLE_GROUPS.ops],
        carrierId: truck.carrierId,
        entityType: "truck",
        entityId: truck.id,
      });
      await bumpState(tx, actor.facilityId);
      live({ facilityId: actor.facilityId, topics: ["trucks", "docks", "resources", "readiness", "decisions", "twin", "dashboard", "events", "notifications", "handover"], eventType: "TRUCK_RELEASED", entityType: "truck", entityId: truck.id });
      return { released: true as const, outcome: out.outcome, decisionId: decision.id, evaluationId: evaluation.id, overridden, windowStart: out.plan.windowStart.toISOString(), windowEnd: out.plan.windowEnd.toISOString(), dockId: out.plan.dockId, teamId: out.plan.teamId, equipmentId: out.plan.equipmentId };
    });
  } catch (err) {
    if (isExclusionViolation(err)) throw conflict("RESOURCE_CONFLICT", "A dock, crew or equipment unit was claimed by a concurrent release. Re-evaluate readiness.");
    if (err instanceof AppError) throw err;
    throw err;
  }
}
