import {
  DOCK_DOWN_STATUSES,
  TEMPERATURE_CONTROLLED,
  VEHICLE_SIZE_RANK,
  localTimeOn,
  type CargoType,
  type EquipmentType,
  type HandlingMethod,
  type Skill,
  type VehicleType,
} from "@wasl/shared";
import type { Dock, Reservation, Team } from "./snapshot";

/** Skills a crew must hold to service a shipment. */
export function requiredSkills(cargo: CargoType, handling: HandlingMethod): Skill[] {
  const s = new Set<Skill>(["GENERAL_UNLOADING"]);
  if (cargo === "CHILLED" || cargo === "FROZEN") s.add("COLD_CHAIN");
  if (cargo === "PHARMA") {
    s.add("COLD_CHAIN");
    s.add("PHARMA_GDP");
  }
  if (cargo === "FRAGILE") s.add("FRAGILE_HANDLING");
  if (handling === "FORKLIFT_PALLET") s.add("FORKLIFT_LICENSED");
  return [...s];
}

/** Handling equipment needed for the handling method (null → manual handling). */
export function requiredEquipment(handling: HandlingMethod): EquipmentType | null {
  switch (handling) {
    case "FORKLIFT_PALLET":
      return "FORKLIFT";
    case "PALLET_JACK":
      return "PALLET_JACK";
    case "CLAMP":
      return "CLAMP_TRUCK";
    default:
      return null;
  }
}

export interface CompatibilityResult {
  ok: boolean;
  problems: { en: string; ar: string }[];
}

export function dockCompatibility(dock: Dock, vehicle: VehicleType, cargo: CargoType): CompatibilityResult {
  const problems: { en: string; ar: string }[] = [];
  if (VEHICLE_SIZE_RANK[vehicle] > VEHICLE_SIZE_RANK[dock.maxVehicleType]) {
    problems.push({ en: `Vehicle ${vehicle} exceeds dock maximum ${dock.maxVehicleType}`, ar: `نوع المركبة ${vehicle} يتجاوز الحد الأقصى للرصيف ${dock.maxVehicleType}` });
  }
  if (!dock.compatibleCargo.includes(cargo)) {
    problems.push({ en: `Dock is not certified for ${cargo} cargo`, ar: `الرصيف غير معتمد لحمولة ${cargo}` });
  }
  if (TEMPERATURE_CONTROLLED.includes(cargo) && !dock.features.includes("REEFER")) {
    problems.push({ en: "Temperature-controlled cargo requires a reefer dock", ar: "الحمولة المبردة تتطلب رصيفًا مبردًا" });
  }
  if (vehicle === "REEFER_TRAILER" && !dock.features.includes("REEFER")) {
    problems.push({ en: "Reefer trailer requires a dock with reefer plug-in", ar: "المقطورة المبردة تتطلب رصيفًا مزودًا بتوصيل تبريد" });
  }
  return { ok: problems.length === 0, problems };
}

export const isDockDown = (d: Dock) => DOCK_DOWN_STATUSES.includes(d.status);

export function teamHasSkills(team: Team, skills: readonly string[]) {
  return skills.every((s) => team.skills.includes(s));
}

/**
 * The shift window relevant to instant `at`: the one containing it, otherwise the next one.
 * Handles overnight shifts (end <= start ⇒ ends the following day), including instants after
 * midnight that belong to a shift which started the previous evening.
 */
export function teamShiftWindow(team: Team, at: Date, tz: string) {
  const windowFor = (day: Date) => {
    const start = localTimeOn(day, team.shiftStart, tz);
    let end = localTimeOn(day, team.shiftEnd, tz);
    if (end <= start) end = new Date(end.getTime() + 86400_000);
    return { start, end };
  };
  const today = windowFor(at);
  const yesterday = windowFor(new Date(at.getTime() - 86400_000));
  if (at >= yesterday.start && at < yesterday.end) return yesterday;
  if (at < today.end) return today;
  return windowFor(new Date(at.getTime() + 86400_000));
}

/**
 * Earliest start >= `from` such that [start, start+dur) does not overlap any of
 * the given busy intervals (and, optionally, ends before `latestEnd`).
 */
export function earliestFreeStart(busy: { startAt: Date; endAt: Date }[], from: Date, durMin: number, latestEnd?: Date): Date | null {
  const sorted = [...busy].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  let t = from.getTime();
  const dur = durMin * 60_000;
  for (const b of sorted) {
    if (b.endAt.getTime() <= t) continue;
    if (b.startAt.getTime() >= t + dur) break;
    t = Math.max(t, b.endAt.getTime());
  }
  if (latestEnd && t + dur > latestEnd.getTime()) return null;
  return new Date(t);
}

export function busyFor(reservations: Reservation[], type: Reservation["resourceType"], id: string, excludeTruckId?: string) {
  return reservations.filter((r) => r.resourceType === type && r.resourceId === id && r.status === "ACTIVE" && r.truckId !== excludeTruckId);
}
