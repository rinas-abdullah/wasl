import type { FacilitySnapshot, TruckWithShipment } from "../src/domain/snapshot";

export const NOW = new Date("2026-11-08T07:00:00Z"); // 10:00 Riyadh
const id = (s: string) => `00000000-0000-4000-8000-${s.padStart(12, "0")}`;

export function snapshot(over: Partial<FacilitySnapshot> = {}): FacilitySnapshot {
  const base: FacilitySnapshot = {
    takenAt: NOW,
    facility: { id: id("f1"), orgId: id("o1"), code: "F", name: "F", nameAr: "F", city: "R", timezone: "Asia/Riyadh", yardCapacity: 4, gateCapacityPerHour: 10, travelTimeMin: 15, congestionThreshold: 5, settings: {}, stateVersion: 1, createdAt: NOW },
    docks: [
      { id: id("d1"), facilityId: id("f1"), code: "D1", name: "D1", position: 1, status: "AVAILABLE", statusReason: null, statusUntil: null, maxVehicleType: "REEFER_TRAILER", compatibleCargo: ["GENERAL", "CHILLED", "PHARMA"], features: ["REEFER", "LEVELER"], restrictions: null, version: 1, createdAt: NOW, updatedAt: NOW },
      { id: id("d2"), facilityId: id("f1"), code: "D2", name: "D2", position: 2, status: "AVAILABLE", statusReason: null, statusUntil: null, maxVehicleType: "RIGID", compatibleCargo: ["GENERAL"], features: ["LEVELER"], restrictions: null, version: 1, createdAt: NOW, updatedAt: NOW },
    ],
    gates: [{ id: id("g1"), facilityId: id("f1"), code: "G", type: "ENTRY", status: "OPEN", capacityPerHour: 10, createdAt: NOW }],
    teams: [{ id: id("t1"), facilityId: id("f1"), code: "T-A", name: "A", nameAr: "أ", shiftStart: "06:00", shiftEnd: "18:00", size: 4, skills: ["GENERAL_UNLOADING", "FORKLIFT_LICENSED", "COLD_CHAIN", "PHARMA_GDP"], status: "AVAILABLE", statusReason: null, createdAt: NOW }],
    equipment: [{ id: id("e1"), facilityId: id("f1"), code: "FL-01", type: "FORKLIFT", status: "AVAILABLE", statusReason: null, compatibleOperations: [], createdAt: NOW }],
    trucks: [],
    reservations: [],
    openQualityReviews: [],
    qualityOfficerCount: 1,
  };
  return { ...base, ...over };
}

export function truck(over: Partial<TruckWithShipment> = {}, ship: Partial<TruckWithShipment["shipment"]> = {}): TruckWithShipment {
  const shipment = { id: id("s1"), orgId: id("o1"), facilityId: id("f1"), reference: "S1", cargoType: "GENERAL", palletCount: 10, weightKg: 1000, handlingMethod: "FORKLIFT_PALLET", documentsComplete: true, inspectionRequired: false, requiredConditions: {}, qualityStatus: "NO_ISSUE_OBSERVED", createdAt: NOW, updatedAt: NOW, ...ship } as TruckWithShipment["shipment"];
  return {
    id: id("tr1"), orgId: id("o1"), facilityId: id("f1"), code: "WSL-1", plateNumber: "P", carrierId: id("c1"), driverId: null, shipmentId: shipment.id, vehicleType: "RIGID", status: "SCHEDULED", priority: "NORMAL", notes: null,
    requestedArrival: NOW, actualArrival: null, assignedDockId: id("d1"), reassignmentRequired: false, serviceEstimateMin: 40, serviceEstimateLowMin: null, serviceEstimateHighMin: null, serviceEstimateSource: "PLANNING_TABLE",
    calledAt: null, serviceStartedAt: null, serviceCompletedAt: null, departedAt: null, statusReason: null, version: 1, deletedAt: null, createdAt: NOW, updatedAt: NOW,
    shipment, appointment: { id: id("a1"), facilityId: id("f1"), truckId: id("tr1"), dockId: id("d1"), status: "CONFIRMED", requestedStart: NOW, proposedStart: NOW, confirmedStart: NOW, durationMin: 40, source: "MANUAL", optimizationRunId: null, version: 1, createdAt: NOW, updatedAt: NOW },
    carrierName: "C",
    ...over,
  } as TruckWithShipment;
}
export { id };
