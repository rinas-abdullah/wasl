/**
 * Canonical domain enumerations shared by the API (persisted as Postgres enums)
 * and the web client. Changing a value here requires a database migration.
 */

export const ROLES = [
  "SUPER_ADMIN",
  "ORGANIZATION_ADMIN",
  "OPERATIONS_MANAGER",
  "DOCK_SUPERVISOR",
  "QUALITY_OFFICER",
  "CARRIER_OPERATOR",
  "DRIVER",
  "AUDITOR",
] as const;
export type Role = (typeof ROLES)[number];

export const TRUCK_STATUSES = [
  "REGISTERED",
  "SCHEDULED",
  "CALLED",
  "ARRIVED",
  "WAITING",
  "IN_SERVICE",
  "COMPLETED",
  "DEPARTED",
  "CANCELLED",
  "NO_SHOW",
  "EXCEPTION",
] as const;
export type TruckStatus = (typeof TRUCK_STATUSES)[number];

export const VEHICLE_TYPES = ["VAN", "RIGID", "ARTICULATED", "REEFER_TRAILER"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
/** Physical size rank used for dock "maximum vehicle type" checks. */
export const VEHICLE_SIZE_RANK: Record<VehicleType, number> = {
  VAN: 1,
  RIGID: 2,
  ARTICULATED: 3,
  REEFER_TRAILER: 3,
};

export const CARGO_TYPES = ["GENERAL", "CHILLED", "FROZEN", "PHARMA", "FRAGILE", "BULK"] as const;
export type CargoType = (typeof CARGO_TYPES)[number];
/** Cargo types that require a temperature-controlled (reefer) dock. */
export const TEMPERATURE_CONTROLLED: readonly CargoType[] = ["CHILLED", "FROZEN", "PHARMA"];

export const HANDLING_METHODS = ["FORKLIFT_PALLET", "PALLET_JACK", "MANUAL", "CLAMP"] as const;
export type HandlingMethod = (typeof HANDLING_METHODS)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DOCK_STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "OUT_OF_SERVICE", "MAINTENANCE"] as const;
export type DockStatus = (typeof DOCK_STATUSES)[number];
export const DOCK_DOWN_STATUSES: readonly DockStatus[] = ["OUT_OF_SERVICE", "MAINTENANCE"];

export const DOCK_FEATURES = ["REEFER", "LEVELER", "SIDE_LOADING", "INSPECTION_BAY"] as const;
export type DockFeature = (typeof DOCK_FEATURES)[number];

export const GATE_TYPES = ["ENTRY", "EXIT"] as const;
export type GateType = (typeof GATE_TYPES)[number];
export const GATE_STATUSES = ["OPEN", "CLOSED"] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export const SKILLS = ["GENERAL_UNLOADING", "COLD_CHAIN", "FORKLIFT_LICENSED", "FRAGILE_HANDLING", "PHARMA_GDP"] as const;
export type Skill = (typeof SKILLS)[number];

export const RESOURCE_STATUSES = ["AVAILABLE", "UNAVAILABLE"] as const;
export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export const EQUIPMENT_TYPES = ["FORKLIFT", "PALLET_JACK", "REACH_TRUCK", "CLAMP_TRUCK"] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];
export const EQUIPMENT_STATUSES = ["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const APPOINTMENT_STATUSES = ["REQUESTED", "PROPOSED", "CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const RESERVATION_RESOURCE_TYPES = ["DOCK", "TEAM", "EQUIPMENT"] as const;
export type ReservationResourceType = (typeof RESERVATION_RESOURCE_TYPES)[number];
export const RESERVATION_STATUSES = ["ACTIVE", "SUSPENDED", "RELEASED", "CANCELLED"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const READINESS_OUTCOMES = ["READY", "HOLD", "REASSIGNMENT_REQUIRED", "MANUAL_REVIEW_REQUIRED"] as const;
export type ReadinessOutcome = (typeof READINESS_OUTCOMES)[number];

export const DECISION_TYPES = ["RELEASE", "HOLD", "REASSIGNMENT", "OVERRIDE_RELEASE", "PLAN_APPROVAL"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];
export const DECISION_STATUSES = ["PENDING_REVIEW", "EXECUTED", "REJECTED", "SUPERSEDED", "FAILED"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const JOB_STATUSES = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const SOLVER_STATUSES = ["OPTIMAL", "FEASIBLE", "INFEASIBLE", "MODEL_INVALID", "UNKNOWN"] as const;
export type SolverStatus = (typeof SOLVER_STATUSES)[number];

export const PLAN_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "STALE", "NOT_APPLICABLE"] as const;
export type PlanApprovalStatus = (typeof PLAN_APPROVAL_STATUSES)[number];

export const SIMULATION_POLICIES = ["FCFS", "FIXED_APPOINTMENTS", "OR_ONLY", "FULL_WASL"] as const;
export type SimulationPolicy = (typeof SIMULATION_POLICIES)[number];

export const SIMULATION_PRESETS = [
  "NORMAL",
  "PEAK_ARRIVALS",
  "DOCK_FAILURE",
  "WORKFORCE_SHORTAGE",
  "DELAYED_TRUCKS",
  "QUALITY_SURGE",
  "MIXED_DISRUPTION",
] as const;
export type SimulationPreset = (typeof SIMULATION_PRESETS)[number];

export const SENSOR_SCENARIOS = ["NORMAL", "TEMP_EXCURSION", "SHOCK", "MISSING_DATA"] as const;
export type SensorScenario = (typeof SENSOR_SCENARIOS)[number];
export const SENSOR_EVENT_TYPES = ["TEMP_EXCURSION", "HUMIDITY_EXCURSION", "SHOCK", "MISSING_DATA"] as const;
export type SensorEventType = (typeof SENSOR_EVENT_TYPES)[number];

export const QUALITY_STATUSES = [
  "NO_ISSUE_OBSERVED",
  "REVIEW_REQUIRED",
  "UNDER_REVIEW",
  "RELEASED_BY_AUTHORIZED_USER",
  "ESCALATED",
  "HOLD",
] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];
/** Quality states in which the shipment must not be released to a dock without inspection coordination. */
export const QUALITY_OPEN_STATUSES: readonly QualityStatus[] = ["REVIEW_REQUIRED", "UNDER_REVIEW"];
export const QUALITY_BLOCKING_STATUSES: readonly QualityStatus[] = ["HOLD", "ESCALATED"];

export const HANDOVER_STATUSES = [
  "PENDING_ARRIVAL",
  "ARRIVAL_CONFIRMED",
  "UNLOADING",
  "INSPECTION_RECORDED",
  "APPROVED",
  "CLOSED",
] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];
export const HANDOVER_ACTIONS = [
  "CONFIRM_ARRIVAL",
  "START_UNLOADING",
  "RECORD_INSPECTION",
  "APPROVE_HANDOVER",
  "CLOSE_OPERATION",
] as const;
export type HandoverAction = (typeof HANDOVER_ACTIONS)[number];

export const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const NOTIFICATION_TYPES = [
  "DOCK_FAILURE",
  "APPOINTMENT_CONFLICT",
  "TRUCK_CALLED",
  "READINESS_HOLD",
  "QUALITY_REVIEW_REQUIRED",
  "RESOURCE_SHORTAGE",
  "PLAN_APPROVAL_REQUIRED",
  "OPTIMIZATION_FAILED",
  "SIMULATION_COMPLETED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EVENT_SOURCES = [
  "USER",
  "SYSTEM",
  "READINESS_ENGINE",
  "OPTIMIZER",
  "SIMULATOR",
  "SENSOR_ENGINE",
  "SEED",
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const EVENT_TYPES = [
  "TRUCK_CREATED",
  "TRUCK_UPDATED",
  "TRUCK_CANCELLED",
  "TRUCK_STATUS_CHANGED",
  "APPOINTMENT_SCHEDULED",
  "APPOINTMENT_RESCHEDULED",
  "DOCK_ASSIGNED",
  "DOCK_FAILED",
  "DOCK_RESTORED",
  "DOCK_MAINTENANCE_SCHEDULED",
  "RESOURCE_UNAVAILABLE",
  "RESOURCE_RESTORED",
  "READINESS_EVALUATED",
  "OPTIMIZATION_REQUESTED",
  "OPTIMIZATION_COMPLETED",
  "OPTIMIZATION_FAILED",
  "PLAN_APPROVED",
  "PLAN_REJECTED",
  "TRUCK_RELEASED",
  "RELEASE_OVERRIDDEN",
  "TRUCK_ARRIVED",
  "SERVICE_STARTED",
  "SERVICE_COMPLETED",
  "QUALITY_ALERT_CREATED",
  "QUALITY_REVIEW_UPDATED",
  "SENSOR_SCENARIO_GENERATED",
  "HANDOVER_ACTION_RECORDED",
  "HANDOVER_APPROVED",
  "TRUCK_DEPARTED",
  "SIMULATION_COMPLETED",
  "USER_CREATED",
  "USER_ROLE_CHANGED",
  "SETTINGS_UPDATED",
  "DEMO_RESET",
  "AUTH_LOGIN",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
