import { and, eq } from "drizzle-orm";
import type { CargoType, HandlingMethod, VehicleType } from "@wasl/shared";
import { db, schema } from "../db/client";
import { intel } from "../intel/client";

export interface ServiceEstimate {
  minutes: number;
  low: number | null;
  high: number | null;
  /** e.g. "MODEL:service_time@2026.11.08-1", "BASELINE:cargo_mean@...", "PLANNING_TABLE". */
  source: string;
}

export interface EstimateInput {
  cargoType: CargoType;
  palletCount: number;
  handlingMethod: HandlingMethod;
  vehicleType: VehicleType;
  teamSize: number;
  dockHasLeveler: boolean;
  inspectionRequired: boolean;
}

/**
 * Static planning table used ONLY when neither the trained model nor the
 * cargo-mean baseline is reachable. Values are planning assumptions (minutes
 * per pallet + fixed setup) and are labelled as such wherever shown.
 */
const PLANNING_TABLE: Record<CargoType, { setup: number; perPallet: number }> = {
  GENERAL: { setup: 12, perPallet: 1.6 },
  CHILLED: { setup: 15, perPallet: 1.9 },
  FROZEN: { setup: 18, perPallet: 2.1 },
  PHARMA: { setup: 20, perPallet: 2.2 },
  FRAGILE: { setup: 14, perPallet: 2.4 },
  BULK: { setup: 10, perPallet: 1.4 },
};

export function planningTableEstimate(i: EstimateInput): ServiceEstimate {
  const p = PLANNING_TABLE[i.cargoType];
  const minutes = Math.round(p.setup + p.perPallet * i.palletCount + (i.inspectionRequired ? 20 : 0));
  return { minutes, low: null, high: null, source: "PLANNING_TABLE" };
}

/** Asks the intelligence service for a prediction; falls back transparently. */
export async function estimateServiceTime(i: EstimateInput): Promise<ServiceEstimate> {
  try {
    const r = await intel<{ minutes: number; low: number; high: number; source: string }>(
      "/predict/service-time",
      {
        cargo_type: i.cargoType,
        pallet_count: i.palletCount,
        handling_method: i.handlingMethod,
        vehicle_type: i.vehicleType,
        team_size: i.teamSize,
        dock_has_leveler: i.dockHasLeveler,
        inspection_required: i.inspectionRequired,
      },
      { timeoutMs: 3000, retries: 0 },
    );
    return { minutes: Math.max(5, Math.round(r.minutes)), low: Math.round(r.low), high: Math.round(r.high), source: r.source };
  } catch {
    return planningTableEstimate(i);
  }
}

export async function activeModel(name: string) {
  const [m] = await db.select().from(schema.modelVersions).where(and(eq(schema.modelVersions.modelName, name), eq(schema.modelVersions.isActive, true))).limit(1);
  return m ?? null;
}
