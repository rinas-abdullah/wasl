import type { SimulationParams } from "./schemas";
import type { SimulationPreset } from "./enums";

/** Mirrors services/intelligence/wasl_intel/presets.py (kept in sync by tests). */
export const BASE_SIM_PARAMS: SimulationParams = {
  durationMin: 600,
  nTrucks: 36,
  nDocks: 4,
  nReeferDocks: 2,
  nTeams: 4,
  nInspectors: 1,
  yardCapacity: 8,
  arrival: { pattern: "UNIFORM_APPOINTMENTS", latenessMeanMin: 0, latenessSdMin: 15 },
  service: { distribution: "LOGNORMAL", cv: 0.3 },
  coldShare: 0.25,
  qualityProbability: 0.1,
  inspectionMin: 25,
  travelMin: 15,
  failures: [],
};

export function presetParams(name: SimulationPreset): SimulationParams {
  const p: SimulationParams = { ...BASE_SIM_PARAMS, arrival: { ...BASE_SIM_PARAMS.arrival }, service: { ...BASE_SIM_PARAMS.service }, failures: [] };
  switch (name) {
    case "PEAK_ARRIVALS":
      p.arrival.pattern = "PEAKED_APPOINTMENTS";
      p.nTrucks = 44;
      break;
    case "DOCK_FAILURE":
      p.failures = [{ kind: "DOCK", index: 2, atMin: 120, durationMin: 180 }];
      break;
    case "WORKFORCE_SHORTAGE":
      p.failures = [
        { kind: "TEAM", index: 0, atMin: 90, durationMin: 240 },
        { kind: "TEAM", index: 1, atMin: 180, durationMin: 120 },
      ];
      break;
    case "DELAYED_TRUCKS":
      p.arrival.latenessMeanMin = 25;
      p.arrival.latenessSdMin = 35;
      break;
    case "QUALITY_SURGE":
      p.qualityProbability = 0.35;
      break;
    case "MIXED_DISRUPTION":
      p.arrival = { pattern: "PEAKED_APPOINTMENTS", latenessMeanMin: 15, latenessSdMin: 30 };
      p.qualityProbability = 0.2;
      p.failures = [
        { kind: "DOCK", index: 2, atMin: 150, durationMin: 150 },
        { kind: "TEAM", index: 0, atMin: 200, durationMin: 180 },
      ];
      break;
  }
  return p;
}
