import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { schema } from "../db/client";
import { notFound } from "../http/errors";

export type Facility = typeof schema.facilities.$inferSelect;
export type Dock = typeof schema.docks.$inferSelect;
export type Gate = typeof schema.gates.$inferSelect;
export type Team = typeof schema.workforceTeams.$inferSelect;
export type Equipment = typeof schema.equipment.$inferSelect;
export type Truck = typeof schema.trucks.$inferSelect;
export type Shipment = typeof schema.shipments.$inferSelect;
export type Appointment = typeof schema.appointments.$inferSelect;
export type Reservation = typeof schema.resourceReservations.$inferSelect;
export type QualityReview = typeof schema.qualityReviews.$inferSelect;

export interface TruckWithShipment extends Truck {
  shipment: Shipment;
  appointment: Appointment | null;
  carrierName: string;
}

export interface FacilitySnapshot {
  takenAt: Date;
  facility: Facility;
  docks: Dock[];
  gates: Gate[];
  teams: Team[];
  equipment: Equipment[];
  /** Trucks that are not terminal (DEPARTED/CANCELLED/NO_SHOW). */
  trucks: TruckWithShipment[];
  /** ACTIVE reservations ending after `takenAt - 1h`. */
  reservations: Reservation[];
  openQualityReviews: QualityReview[];
  qualityOfficerCount: number;
}

export async function loadSnapshot(tx: DbOrTx, facilityId: string, at = new Date()): Promise<FacilitySnapshot> {
  const [facility] = await tx.select().from(schema.facilities).where(eq(schema.facilities.id, facilityId));
  if (!facility) throw notFound("Facility");
  const [docks, gates, teams, equipment, truckRows, reservations, openQualityReviews, qo] = await Promise.all([
    tx.select().from(schema.docks).where(eq(schema.docks.facilityId, facilityId)).orderBy(schema.docks.position),
    tx.select().from(schema.gates).where(eq(schema.gates.facilityId, facilityId)).orderBy(schema.gates.code),
    tx.select().from(schema.workforceTeams).where(eq(schema.workforceTeams.facilityId, facilityId)).orderBy(schema.workforceTeams.code),
    tx.select().from(schema.equipment).where(eq(schema.equipment.facilityId, facilityId)).orderBy(schema.equipment.code),
    tx
      .select({ truck: schema.trucks, shipment: schema.shipments, appointment: schema.appointments, carrierName: schema.carriers.name })
      .from(schema.trucks)
      .innerJoin(schema.shipments, eq(schema.shipments.id, schema.trucks.shipmentId))
      .innerJoin(schema.carriers, eq(schema.carriers.id, schema.trucks.carrierId))
      .leftJoin(
        schema.appointments,
        and(eq(schema.appointments.truckId, schema.trucks.id), inArray(schema.appointments.status, ["REQUESTED", "PROPOSED", "CONFIRMED"])),
      )
      .where(and(eq(schema.trucks.facilityId, facilityId), isNull(schema.trucks.deletedAt), notInArray(schema.trucks.status, ["DEPARTED", "CANCELLED", "NO_SHOW"])))
      .orderBy(schema.trucks.code),
    tx
      .select()
      .from(schema.resourceReservations)
      .where(
        and(
          eq(schema.resourceReservations.facilityId, facilityId),
          eq(schema.resourceReservations.status, "ACTIVE"),
          gt(schema.resourceReservations.endAt, new Date(at.getTime() - 3600_000)),
        ),
      ),
    tx
      .select()
      .from(schema.qualityReviews)
      .where(and(eq(schema.qualityReviews.facilityId, facilityId), inArray(schema.qualityReviews.status, ["REVIEW_REQUIRED", "UNDER_REVIEW", "ESCALATED", "HOLD"]))),
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, facility.orgId), eq(schema.memberships.role, "QUALITY_OFFICER"))),
  ]);
  return {
    takenAt: at,
    facility,
    docks,
    gates,
    teams,
    equipment,
    trucks: truckRows.map((r) => ({ ...r.truck, shipment: r.shipment, appointment: r.appointment, carrierName: r.carrierName })),
    reservations,
    openQualityReviews,
    qualityOfficerCount: qo[0]?.n ?? 0,
  };
}
