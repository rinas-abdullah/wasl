import { z } from "zod";
import {
  CARGO_TYPES,
  DOCK_FEATURES,
  DOCK_STATUSES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_TYPES,
  HANDLING_METHODS,
  HANDOVER_ACTIONS,
  PRIORITIES,
  RESOURCE_STATUSES,
  ROLES,
  SENSOR_SCENARIOS,
  SIMULATION_POLICIES,
  SIMULATION_PRESETS,
  SKILLS,
  TRUCK_STATUSES,
  VEHICLE_TYPES,
} from "./enums";
import { TRUCK_ACTIONS } from "./truck-state";
import { QUALITY_ACTIONS } from "./workflows";

const isoDate = z.iso.datetime({ offset: true });
const uuid = z.uuid();

export const loginSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional().default(false),
});

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const requiredConditionsSchema = z
  .object({
    tempMinC: z.number().min(-40).max(40).optional(),
    tempMaxC: z.number().min(-40).max(60).optional(),
    humidityMaxPct: z.number().min(0).max(100).optional(),
    shockMaxG: z.number().min(0).max(50).optional(),
  })
  .refine((v) => v.tempMinC === undefined || v.tempMaxC === undefined || v.tempMinC < v.tempMaxC, {
    message: "tempMinC must be lower than tempMaxC",
  });
export type RequiredConditions = z.infer<typeof requiredConditionsSchema>;

export const shipmentInputSchema = z.object({
  reference: z.string().trim().min(3).max(40).optional(),
  cargoType: z.enum(CARGO_TYPES),
  palletCount: z.number().int().min(1).max(60),
  weightKg: z.number().int().min(1).max(40000),
  handlingMethod: z.enum(HANDLING_METHODS),
  documentsComplete: z.boolean().default(true),
  inspectionRequired: z.boolean().default(false),
  requiredConditions: requiredConditionsSchema.default({}),
});

export const truckCreateSchema = z.object({
  plateNumber: z.string().trim().min(3).max(20),
  carrierId: uuid,
  driverId: uuid.nullable().optional(),
  vehicleType: z.enum(VEHICLE_TYPES),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  requestedArrival: isoDate,
  notes: z.string().max(1000).optional().nullable(),
  shipment: shipmentInputSchema,
});
export type TruckCreateInput = z.infer<typeof truckCreateSchema>;

export const truckUpdateSchema = z.object({
  version: z.number().int().min(1),
  plateNumber: z.string().trim().min(3).max(20).optional(),
  driverId: uuid.nullable().optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  notes: z.string().max(1000).nullable().optional(),
  shipment: shipmentInputSchema.partial().optional(),
});

export const truckListQuery = paginationQuery.extend({
  q: z.string().max(100).optional(),
  status: z.union([z.enum(TRUCK_STATUSES), z.array(z.enum(TRUCK_STATUSES))]).optional(),
  carrierId: uuid.optional(),
  dockId: uuid.optional(),
  cargoType: z.enum(CARGO_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  sort: z.enum(["code", "plannedArrival", "requestedArrival", "status", "priority", "createdAt"]).default("plannedArrival"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const truckTransitionSchema = z.object({
  action: z.enum(TRUCK_ACTIONS).exclude(["RELEASE", "SCHEDULE"]),
  version: z.number().int().min(1),
  reason: z.string().max(500).optional().nullable(),
});

export const bulkTransitionSchema = z.object({
  action: z.enum(TRUCK_ACTIONS).exclude(["RELEASE", "SCHEDULE"]),
  truckIds: z.array(uuid).min(1).max(100),
  reason: z.string().max(500).optional().nullable(),
});

export const appointmentScheduleSchema = z.object({
  truckId: uuid,
  dockId: uuid,
  start: isoDate,
  /** If omitted the server uses the current service-time estimate. */
  durationMin: z.number().int().min(10).max(600).optional(),
  version: z.number().int().min(1),
  reason: z.string().max(500).optional().nullable(),
});

export const appointmentValidateSchema = appointmentScheduleSchema.omit({ version: true, reason: true });

export const dockStatusSchema = z.object({
  status: z.enum(DOCK_STATUSES).extract(["AVAILABLE", "OUT_OF_SERVICE", "MAINTENANCE"]),
  reason: z.string().trim().min(3).max(500),
  /** For MAINTENANCE: planned window. */
  until: isoDate.optional().nullable(),
});

export const dockUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  maxVehicleType: z.enum(VEHICLE_TYPES).optional(),
  compatibleCargo: z.array(z.enum(CARGO_TYPES)).min(1).optional(),
  features: z.array(z.enum(DOCK_FEATURES)).optional(),
  restrictions: z.string().max(500).nullable().optional(),
});

export const teamStatusSchema = z.object({ status: z.enum(RESOURCE_STATUSES), reason: z.string().trim().min(3).max(500) });
export const equipmentStatusSchema = z.object({ status: z.enum(EQUIPMENT_STATUSES), reason: z.string().trim().min(3).max(500) });
export const teamUpdateSchema = z.object({
  size: z.number().int().min(1).max(30).optional(),
  skills: z.array(z.enum(SKILLS)).min(1).optional(),
  shiftStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  shiftEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
export const equipmentTypeEnum = z.enum(EQUIPMENT_TYPES);

export const readinessEvaluateSchema = z.object({
  truckId: uuid,
  proposedCallTime: isoDate.optional(),
});

export const releaseSchema = z.object({
  truckId: uuid,
  proposedCallTime: isoDate.optional(),
  override: z
    .object({
      checkIds: z.array(z.string()).min(1),
      reason: z.string().trim().min(10).max(500),
    })
    .optional(),
});

export const optimizationWeightsSchema = z.object({
  waitingPerMin: z.number().min(0).max(100).default(1),
  tardinessPerMin: z.number().min(0).max(100).default(3),
  disruptionPerMin: z.number().min(0).max(100).default(0.2),
  reassignment: z.number().min(0).max(1000).default(15),
  makespanPerMin: z.number().min(0).max(100).default(0.5),
  unassigned: z.number().min(0).max(100000).default(1000),
});
export type OptimizationWeights = z.infer<typeof optimizationWeightsSchema>;

export const optimizationRunSchema = z.object({
  horizonMin: z.number().int().min(60).max(1440).default(600),
  timeLimitSec: z.number().min(0.5).max(60).default(10),
  allowUnassigned: z.boolean().default(true),
  weights: optimizationWeightsSchema.default(optimizationWeightsSchema.parse({})),
  label: z.string().max(120).optional(),
});

export const planDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const simulationParamsSchema = z.object({
  durationMin: z.number().int().min(60).max(1440).default(600),
  nTrucks: z.number().int().min(4).max(200).default(36),
  nDocks: z.number().int().min(1).max(20).default(4),
  nReeferDocks: z.number().int().min(0).max(20).default(2),
  nTeams: z.number().int().min(1).max(20).default(4),
  nInspectors: z.number().int().min(0).max(10).default(1),
  yardCapacity: z.number().int().min(1).max(200).default(8),
  arrival: z.object({
    pattern: z.enum(["UNIFORM_APPOINTMENTS", "PEAKED_APPOINTMENTS"]).default("UNIFORM_APPOINTMENTS"),
    latenessMeanMin: z.number().min(-60).max(240).default(0),
    latenessSdMin: z.number().min(0).max(240).default(15),
  }),
  service: z.object({
    distribution: z.enum(["LOGNORMAL", "TRIANGULAR"]).default("LOGNORMAL"),
    cv: z.number().min(0.05).max(1.5).default(0.3),
  }),
  coldShare: z.number().min(0).max(1).default(0.25),
  qualityProbability: z.number().min(0).max(1).default(0.1),
  inspectionMin: z.number().int().min(5).max(180).default(25),
  travelMin: z.number().int().min(0).max(120).default(15),
  failures: z
    .array(
      z.object({
        kind: z.enum(["DOCK", "TEAM"]),
        index: z.number().int().min(0).max(19),
        atMin: z.number().min(0).max(1440),
        durationMin: z.number().min(1).max(1440),
      }),
    )
    .max(20)
    .default([]),
});
export type SimulationParams = z.infer<typeof simulationParamsSchema>;

export const simulationRunSchema = z.object({
  scenarioName: z.string().trim().min(2).max(120),
  preset: z.enum(SIMULATION_PRESETS).optional(),
  seed: z.number().int().min(0).max(2_147_483_647),
  replications: z.number().int().min(1).max(10).default(3),
  policies: z.array(z.enum(SIMULATION_POLICIES)).min(1).max(4),
  params: simulationParamsSchema,
});

export const sensorScenarioSchema = z.object({
  shipmentId: uuid,
  scenario: z.enum(SENSOR_SCENARIOS),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  journeyMinutes: z.number().int().min(60).max(1440).default(360),
});

export const qualityActionSchema = z.object({
  action: z.enum(QUALITY_ACTIONS),
  version: z.number().int().min(1),
  notes: z.string().max(1000).optional().nullable(),
});

export const handoverActionSchema = z.object({
  token: z.string().min(16).max(128),
  action: z.enum(HANDOVER_ACTIONS),
  notes: z.string().max(1000).optional().nullable(),
});

export const eventListQuery = paginationQuery.extend({
  q: z.string().max(100).optional(),
  eventType: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: uuid.optional(),
  source: z.string().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const userCreateSchema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(200),
  role: z.enum(ROLES),
  carrierId: uuid.nullable().optional(),
});
export const userRoleSchema = z.object({ role: z.enum(ROLES) });

export const facilitySettingsSchema = z.object({
  yardCapacity: z.number().int().min(1).max(500).optional(),
  gateCapacityPerHour: z.number().int().min(1).max(500).optional(),
  travelTimeMin: z.number().int().min(0).max(240).optional(),
  congestionThreshold: z.number().int().min(1).max(500).optional(),
  defaultWeights: optimizationWeightsSchema.optional(),
});

export const reportQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  dockId: uuid.optional(),
  carrierId: uuid.optional(),
  cargoType: z.enum(CARGO_TYPES).optional(),
});
