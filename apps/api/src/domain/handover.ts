import { and, asc, desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { evaluateHandoverAction, type HandoverAction, type HandoverStatus } from "@wasl/shared";
import { db, schema } from "../db/client";
import { config } from "../config";
import type { Actor } from "../http/context";
import { conflict, forbidden, isUniqueViolation, notFound, unprocessable } from "../http/errors";
import { recordEvent } from "./audit";
import { applyTransition, truckScope } from "./trucks";
import { bumpState, withTx } from "./tx";

const H = schema.handoverRecords;

export async function listHandovers(actor: Actor) {
  const rows = await db
    .select({ h: H, truck: { id: schema.trucks.id, code: schema.trucks.code, status: schema.trucks.status, carrierId: schema.trucks.carrierId, driverId: schema.trucks.driverId }, shipment: { id: schema.shipments.id, reference: schema.shipments.reference, cargoType: schema.shipments.cargoType, qualityStatus: schema.shipments.qualityStatus, inspectionRequired: schema.shipments.inspectionRequired } })
    .from(H)
    .innerJoin(schema.trucks, eq(schema.trucks.id, H.truckId))
    .innerJoin(schema.shipments, eq(schema.shipments.id, H.shipmentId))
    .where(and(eq(H.facilityId, actor.facilityId), truckScope(actor)))
    .orderBy(desc(H.updatedAt));
  const scoped = actor.role === "CARRIER_OPERATOR" || actor.role === "DRIVER";
  return rows.map((r) => ({ ...r.h, qrToken: scoped ? undefined : r.h.qrToken, truck: r.truck, shipment: r.shipment }));
}

async function loadByToken(actor: Actor, token: string) {
  const [row] = await db
    .select({ h: H, truck: schema.trucks, shipment: schema.shipments })
    .from(H)
    .innerJoin(schema.trucks, eq(schema.trucks.id, H.truckId))
    .innerJoin(schema.shipments, eq(schema.shipments.id, H.shipmentId))
    .where(and(eq(H.qrToken, token), eq(H.facilityId, actor.facilityId), truckScope(actor)));
  // Same 404 for "does not exist" and "not yours": never confirm a token belongs to another tenant.
  if (!row) throw notFound("Handover");
  return row;
}

function authorizedActions(actor: Actor, status: HandoverStatus, inspectionRequired: boolean, inspectionRecorded: boolean): HandoverAction[] {
  if (!actor.permissions.includes("handover:act")) return [];
  const all: HandoverAction[] = ["CONFIRM_ARRIVAL", "START_UNLOADING", "RECORD_INSPECTION", "APPROVE_HANDOVER", "CLOSE_OPERATION"];
  return all.filter((a) => {
    if (a === "RECORD_INSPECTION" && !actor.permissions.includes("handover:inspect")) return false;
    return evaluateHandoverAction(status, a, { inspectionRequired, inspectionRecorded }).ok;
  });
}

export async function getByToken(actor: Actor, token: string) {
  const row = await loadByToken(actor, token);
  const actions = await db.select({ a: schema.handoverActions, actor: schema.users.name }).from(schema.handoverActions).leftJoin(schema.users, eq(schema.users.id, schema.handoverActions.actorId)).where(eq(schema.handoverActions.handoverId, row.h.id)).orderBy(asc(schema.handoverActions.at));
  const scoped = actor.role === "CARRIER_OPERATOR" || actor.role === "DRIVER";
  return {
    id: row.h.id,
    reference: row.h.reference,
    status: row.h.status,
    inspectionRecorded: row.h.inspectionRecorded,
    shipment: { id: row.shipment.id, reference: row.shipment.reference, cargoType: row.shipment.cargoType, palletCount: row.shipment.palletCount, qualityStatus: scoped ? undefined : row.shipment.qualityStatus, inspectionRequired: row.shipment.inspectionRequired },
    truck: { id: row.truck.id, code: row.truck.code, status: row.truck.status, plateNumber: row.truck.plateNumber },
    requiredInspections: row.shipment.inspectionRequired ? ["QUALITY_INSPECTION"] : [],
    authorizedActions: authorizedActions(actor, row.h.status, row.shipment.inspectionRequired, row.h.inspectionRecorded),
    history: actions.map((x) => ({ action: x.a.action, from: x.a.previousStatus, to: x.a.newStatus, at: x.a.at, actor: x.actor ?? "system", notes: x.a.notes })),
  };
}

export async function qrSvg(actor: Actor, handoverId: string) {
  const [h] = await db.select().from(H).where(and(eq(H.id, handoverId), eq(H.facilityId, actor.facilityId)));
  if (!h) throw notFound("Handover");
  const url = `${config.appPublicUrl}/handover/scan/${h.qrToken}`;
  // The QR encodes only an opaque random token in a URL; no shipment or personal data.
  return QRCode.toString(url, { type: "svg", margin: 1, width: 240, errorCorrectionLevel: "M", color: { dark: "#082B4C", light: "#FFFFFF" } });
}

export async function performHandoverAction(actor: Actor, input: { token: string; action: HandoverAction; notes?: string | null }, idempotencyKey: string) {
  if (input.action === "RECORD_INSPECTION" && !actor.permissions.includes("handover:inspect")) throw forbidden("Only quality officers can record inspections");
  try {
    return await withTx(async ({ tx, live }) => {
      const row = await loadByToken(actor, input.token);
      const [h] = await tx.select().from(H).where(eq(H.id, row.h.id)).for("update");
      const [truck] = await tx.select().from(schema.trucks).where(eq(schema.trucks.id, h.truckId)).for("update");
      const [shipment] = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, h.shipmentId));
      const check = evaluateHandoverAction(h.status, input.action, { inspectionRequired: shipment.inspectionRequired, inspectionRecorded: h.inspectionRecorded });
      if (!check.ok) throw unprocessable(check.code, check.message);

      // Keep the truck lifecycle as the single source of truth.
      switch (input.action) {
        case "CONFIRM_ARRIVAL":
          if (!truck.actualArrival) {
            if (!["SCHEDULED", "CALLED"].includes(truck.status)) throw unprocessable("TRUCK_STATE", `Truck is ${truck.status}`);
            await applyTransition(tx, actor, truck, "MARK_ARRIVAL", null, { skipHandoverSync: true });
          }
          break;
        case "START_UNLOADING":
          if (truck.status !== "IN_SERVICE") await applyTransition(tx, actor, (await tx.select().from(schema.trucks).where(eq(schema.trucks.id, truck.id)))[0], "START_SERVICE", null, { skipHandoverSync: true });
          break;
        case "RECORD_INSPECTION":
          if (!["RELEASED_BY_AUTHORIZED_USER", "NO_ISSUE_OBSERVED"].includes(shipment.qualityStatus)) {
            throw unprocessable("QUALITY_OPEN", `Quality review is ${shipment.qualityStatus}; it must be released by an authorised quality officer before recording the inspection`);
          }
          break;
        case "APPROVE_HANDOVER": {
          const [cur] = await tx.select().from(schema.trucks).where(eq(schema.trucks.id, truck.id));
          if (cur.status === "IN_SERVICE") await applyTransition(tx, actor, cur, "COMPLETE_SERVICE", null, { skipHandoverSync: true });
          else if (cur.status !== "COMPLETED") throw unprocessable("TRUCK_STATE", `Unloading must be in progress or completed (truck is ${cur.status})`);
          break;
        }
        case "CLOSE_OPERATION":
          break;
      }
      const to = check.to;
      const [updated] = await tx
        .update(H)
        .set({ status: to, inspectionRecorded: h.inspectionRecorded || input.action === "RECORD_INSPECTION", version: h.version + 1, updatedAt: new Date() })
        .where(eq(H.id, h.id))
        .returning();
      await tx.insert(schema.handoverActions).values({ handoverId: h.id, action: input.action, previousStatus: h.status, newStatus: to, actorId: actor.userId, idempotencyKey, notes: input.notes ?? null });
      if (input.action === "CLOSE_OPERATION") {
        const [cur] = await tx.select().from(schema.trucks).where(eq(schema.trucks.id, truck.id));
        if (cur.status === "COMPLETED") await applyTransition(tx, actor, cur, "REGISTER_DEPARTURE", null, { skipHandoverSync: true });
      }
      await recordEvent(tx, {
        orgId: actor.orgId,
        facilityId: actor.facilityId,
        eventType: input.action === "APPROVE_HANDOVER" ? "HANDOVER_APPROVED" : "HANDOVER_ACTION_RECORDED",
        entityType: "handover",
        entityId: h.id,
        entityLabel: h.reference,
        actor,
        source: "USER",
        payload: { action: input.action, truckId: truck.id, truckCode: truck.code, notes: input.notes ?? null, idempotencyKey },
        previousState: { status: h.status },
        newState: { status: to },
      });
      await bumpState(tx, actor.facilityId);
      live({ facilityId: actor.facilityId, topics: ["handover", "trucks", "docks", "twin", "dashboard", "events", "resources"], entityType: "handover", entityId: h.id });
      return { handoverId: h.id, status: updated.status, action: input.action };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("DUPLICATE_HANDOVER_ACTION", "This handover action was already recorded");
    throw err;
  }
}
