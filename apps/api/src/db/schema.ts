import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  APPOINTMENT_STATUSES,
  CARGO_TYPES,
  DECISION_STATUSES,
  DECISION_TYPES,
  DOCK_STATUSES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_TYPES,
  GATE_STATUSES,
  GATE_TYPES,
  HANDLING_METHODS,
  HANDOVER_STATUSES,
  JOB_STATUSES,
  PLAN_APPROVAL_STATUSES,
  PRIORITIES,
  QUALITY_STATUSES,
  READINESS_OUTCOMES,
  RESERVATION_RESOURCE_TYPES,
  RESERVATION_STATUSES,
  RESOURCE_STATUSES,
  ROLES,
  SENSOR_EVENT_TYPES,
  SENSOR_SCENARIOS,
  SEVERITIES,
  SIMULATION_POLICIES,
  SOLVER_STATUSES,
  TRUCK_STATUSES,
  VEHICLE_TYPES,
} from "@wasl/shared";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export const roleEnum = pgEnum("role", ROLES);
export const truckStatusEnum = pgEnum("truck_status", TRUCK_STATUSES);
export const vehicleTypeEnum = pgEnum("vehicle_type", VEHICLE_TYPES);
export const cargoTypeEnum = pgEnum("cargo_type", CARGO_TYPES);
export const handlingMethodEnum = pgEnum("handling_method", HANDLING_METHODS);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const dockStatusEnum = pgEnum("dock_status", DOCK_STATUSES);
export const gateTypeEnum = pgEnum("gate_type", GATE_TYPES);
export const gateStatusEnum = pgEnum("gate_status", GATE_STATUSES);
export const resourceStatusEnum = pgEnum("resource_status", RESOURCE_STATUSES);
export const equipmentTypeEnum = pgEnum("equipment_type", EQUIPMENT_TYPES);
export const equipmentStatusEnum = pgEnum("equipment_status", EQUIPMENT_STATUSES);
export const appointmentStatusEnum = pgEnum("appointment_status", APPOINTMENT_STATUSES);
export const reservationResourceEnum = pgEnum("reservation_resource", RESERVATION_RESOURCE_TYPES);
export const reservationStatusEnum = pgEnum("reservation_status", RESERVATION_STATUSES);
export const readinessOutcomeEnum = pgEnum("readiness_outcome", READINESS_OUTCOMES);
export const decisionTypeEnum = pgEnum("decision_type", DECISION_TYPES);
export const decisionStatusEnum = pgEnum("decision_status", DECISION_STATUSES);
export const jobStatusEnum = pgEnum("job_status", JOB_STATUSES);
export const solverStatusEnum = pgEnum("solver_status", SOLVER_STATUSES);
export const planApprovalEnum = pgEnum("plan_approval_status", PLAN_APPROVAL_STATUSES);
export const simulationPolicyEnum = pgEnum("simulation_policy", SIMULATION_POLICIES);
export const sensorScenarioEnum = pgEnum("sensor_scenario", SENSOR_SCENARIOS);
export const sensorEventTypeEnum = pgEnum("sensor_event_type", SENSOR_EVENT_TYPES);
export const qualityStatusEnum = pgEnum("quality_status", QUALITY_STATUSES);
export const handoverStatusEnum = pgEnum("handover_status", HANDOVER_STATUSES);
export const severityEnum = pgEnum("severity", SEVERITIES);

/* ------------------------------------------------------------------ */
/* Tenancy & identity                                                  */
/* ------------------------------------------------------------------ */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  slug: text("slug").notNull().unique(),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    city: text("city").notNull(),
    timezone: text("timezone").notNull().default("Asia/Riyadh"),
    yardCapacity: integer("yard_capacity").notNull(),
    gateCapacityPerHour: integer("gate_capacity_per_hour").notNull(),
    travelTimeMin: integer("travel_time_min").notNull().default(15),
    congestionThreshold: integer("congestion_threshold").notNull().default(5),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    /** Monotonic counter bumped on every operational change; used to detect stale plans. */
    stateVersion: bigint("state_version", { mode: "number" }).notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("facilities_org_code_uq").on(t.orgId, t.code)],
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  locale: text("locale").notNull().default("ar"),
  isDemo: boolean("is_demo").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const carriers = pgTable(
  "carriers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("carriers_org_code_uq").on(t.orgId, t.code)],
);

export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    carrierId: uuid("carrier_id").notNull().references(() => carriers.id, { onDelete: "cascade" }),
    /** Synthetic reference only. No personal data (phone, national ID) is stored. */
    reference: text("reference").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("drivers_org_ref_uq").on(t.orgId, t.reference)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    /** Scope for CARRIER_OPERATOR and DRIVER roles. */
    carrierId: uuid("carrier_id").references(() => carriers.id, { onDelete: "set null" }),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_org_uq").on(t.userId, t.orgId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull().unique(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Facility resources                                                  */
/* ------------------------------------------------------------------ */

export const docks = pgTable(
  "docks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    status: dockStatusEnum("status").notNull().default("AVAILABLE"),
    statusReason: text("status_reason"),
    statusUntil: ts("status_until"),
    maxVehicleType: vehicleTypeEnum("max_vehicle_type").notNull(),
    compatibleCargo: cargoTypeEnum("compatible_cargo").array().notNull(),
    features: text("features").array().notNull().default(sql`'{}'::text[]`),
    restrictions: text("restrictions"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("docks_facility_code_uq").on(t.facilityId, t.code)],
);

export const gates = pgTable(
  "gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: gateTypeEnum("type").notNull(),
    status: gateStatusEnum("status").notNull().default("OPEN"),
    capacityPerHour: integer("capacity_per_hour").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("gates_facility_code_uq").on(t.facilityId, t.code)],
);

export const workforceTeams = pgTable(
  "workforce_teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    shiftStart: text("shift_start").notNull(),
    shiftEnd: text("shift_end").notNull(),
    size: integer("size").notNull(),
    skills: text("skills").array().notNull(),
    status: resourceStatusEnum("status").notNull().default("AVAILABLE"),
    statusReason: text("status_reason"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("teams_facility_code_uq").on(t.facilityId, t.code)],
);

export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    type: equipmentTypeEnum("type").notNull(),
    status: equipmentStatusEnum("status").notNull().default("AVAILABLE"),
    statusReason: text("status_reason"),
    compatibleOperations: text("compatible_operations").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("equipment_facility_code_uq").on(t.facilityId, t.code)],
);

/* ------------------------------------------------------------------ */
/* Trucks, shipments, appointments                                     */
/* ------------------------------------------------------------------ */

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    cargoType: cargoTypeEnum("cargo_type").notNull(),
    palletCount: integer("pallet_count").notNull(),
    weightKg: integer("weight_kg").notNull(),
    handlingMethod: handlingMethodEnum("handling_method").notNull(),
    documentsComplete: boolean("documents_complete").notNull().default(true),
    /** Set by policy (e.g. PHARMA) or by a quality event. */
    inspectionRequired: boolean("inspection_required").notNull().default(false),
    requiredConditions: jsonb("required_conditions").$type<Record<string, number>>().notNull().default({}),
    qualityStatus: qualityStatusEnum("quality_status").notNull().default("NO_ISSUE_OBSERVED"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("shipments_facility_ref_uq").on(t.facilityId, t.reference)],
);

export const trucks = pgTable(
  "trucks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    plateNumber: text("plate_number").notNull(),
    carrierId: uuid("carrier_id").notNull().references(() => carriers.id),
    driverId: uuid("driver_id").references(() => drivers.id, { onDelete: "set null" }),
    shipmentId: uuid("shipment_id").notNull().unique().references(() => shipments.id),
    vehicleType: vehicleTypeEnum("vehicle_type").notNull(),
    status: truckStatusEnum("status").notNull().default("REGISTERED"),
    priority: priorityEnum("priority").notNull().default("NORMAL"),
    notes: text("notes"),
    requestedArrival: ts("requested_arrival").notNull(),
    actualArrival: ts("actual_arrival"),
    assignedDockId: uuid("assigned_dock_id").references(() => docks.id, { onDelete: "set null" }),
    reassignmentRequired: boolean("reassignment_required").notNull().default(false),
    serviceEstimateMin: integer("service_estimate_min").notNull(),
    serviceEstimateLowMin: integer("service_estimate_low_min"),
    serviceEstimateHighMin: integer("service_estimate_high_min"),
    serviceEstimateSource: text("service_estimate_source").notNull(),
    calledAt: ts("called_at"),
    serviceStartedAt: ts("service_started_at"),
    serviceCompletedAt: ts("service_completed_at"),
    departedAt: ts("departed_at"),
    statusReason: text("status_reason"),
    version: integer("version").notNull().default(1),
    deletedAt: ts("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("trucks_facility_code_uq").on(t.facilityId, t.code),
    index("trucks_facility_status_idx").on(t.facilityId, t.status),
    index("trucks_dock_idx").on(t.assignedDockId),
    index("trucks_carrier_idx").on(t.carrierId),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    truckId: uuid("truck_id").notNull().references(() => trucks.id, { onDelete: "cascade" }),
    dockId: uuid("dock_id").references(() => docks.id, { onDelete: "set null" }),
    status: appointmentStatusEnum("status").notNull(),
    /** Carrier's requested slot. */
    requestedStart: ts("requested_start").notNull(),
    /** Slot proposed by optimisation / planner (may differ from requested). */
    proposedStart: ts("proposed_start"),
    /** Slot confirmed to the carrier. */
    confirmedStart: ts("confirmed_start"),
    durationMin: integer("duration_min").notNull(),
    source: text("source").notNull(),
    optimizationRunId: uuid("optimization_run_id"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("appointments_facility_start_idx").on(t.facilityId, t.confirmedStart),
    uniqueIndex("appointments_one_active_per_truck").on(t.truckId).where(sql`status in ('REQUESTED','PROPOSED','CONFIRMED')`),
  ],
);

/**
 * Time-bounded resource reservations. A Postgres EXCLUDE constraint (see
 * migration 0001_reservations_exclusion.sql) guarantees that no two ACTIVE
 * reservations overlap on the same resource — this is the last line of
 * defence against two trucks being released onto the same dock/crew.
 */
export const resourceReservations = pgTable(
  "resource_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    resourceType: reservationResourceEnum("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    truckId: uuid("truck_id").notNull().references(() => trucks.id, { onDelete: "cascade" }),
    decisionId: uuid("decision_id"),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    status: reservationStatusEnum("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reservations_resource_idx").on(t.resourceType, t.resourceId, t.startAt), index("reservations_truck_idx").on(t.truckId)],
);

/* ------------------------------------------------------------------ */
/* Decision intelligence                                               */
/* ------------------------------------------------------------------ */

export const readinessEvaluations = pgTable(
  "readiness_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    truckId: uuid("truck_id").notNull().references(() => trucks.id, { onDelete: "cascade" }),
    outcome: readinessOutcomeEnum("outcome").notNull(),
    proposedCallTime: ts("proposed_call_time").notNull(),
    checks: jsonb("checks").$type<unknown[]>().notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    nextReevaluationAt: ts("next_reevaluation_at"),
    engineVersion: text("engine_version").notNull(),
    evaluatedBy: uuid("evaluated_by").references(() => users.id, { onDelete: "set null" }),
    evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
  },
  (t) => [index("readiness_truck_idx").on(t.truckId, t.evaluatedAt)],
);

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    truckId: uuid("truck_id").references(() => trucks.id, { onDelete: "cascade" }),
    optimizationRunId: uuid("optimization_run_id"),
    readinessEvaluationId: uuid("readiness_evaluation_id").references(() => readinessEvaluations.id, { onDelete: "set null" }),
    type: decisionTypeEnum("type").notNull(),
    status: decisionStatusEnum("status").notNull(),
    outcome: readinessOutcomeEnum("outcome"),
    reasons: jsonb("reasons").$type<{ en: string; ar: string }[]>().notNull().default([]),
    suggestedAction: jsonb("suggested_action").$type<{ en: string; ar: string } | null>(),
    alternatives: jsonb("alternatives").$type<unknown[]>().notNull().default([]),
    impact: jsonb("impact").$type<Record<string, unknown>>().notNull().default({}),
    overriddenChecks: text("overridden_checks").array().notNull().default(sql`'{}'::text[]`),
    overrideReason: text("override_reason"),
    executionResult: jsonb("execution_result").$type<Record<string, unknown> | null>(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("decisions_facility_idx").on(t.facilityId, t.createdAt), index("decisions_truck_idx").on(t.truckId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    refId: uuid("ref_id"),
    status: jobStatusEnum("status").notNull().default("QUEUED"),
    progress: real("progress").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("jobs_status_idx").on(t.status, t.createdAt)],
);

export const optimizationRuns = pgTable(
  "optimization_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    label: text("label"),
    trigger: text("trigger").notNull(),
    jobStatus: jobStatusEnum("job_status").notNull().default("QUEUED"),
    solverStatus: solverStatusEnum("solver_status"),
    approvalStatus: planApprovalEnum("approval_status").notNull().default("PENDING"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull(),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>(),
    objectiveValue: doublePrecision("objective_value"),
    bestBound: doublePrecision("best_bound"),
    objectiveBreakdown: jsonb("objective_breakdown").$type<Record<string, number>>(),
    currentPlanBreakdown: jsonb("current_plan_breakdown").$type<Record<string, number>>(),
    constraintSummary: jsonb("constraint_summary").$type<Record<string, unknown>>(),
    runtimeMs: integer("runtime_ms"),
    solverVersion: text("solver_version"),
    baseStateVersion: bigint("base_state_version", { mode: "number" }),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decisionReason: text("decision_reason"),
    decidedAt: ts("decided_at"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("optimization_runs_facility_idx").on(t.facilityId, t.createdAt)],
);

export const optimizationCandidates = pgTable(
  "optimization_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => optimizationRuns.id, { onDelete: "cascade" }),
    truckId: uuid("truck_id").notNull().references(() => trucks.id, { onDelete: "cascade" }),
    dockId: uuid("dock_id").references(() => docks.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references(() => workforceTeams.id, { onDelete: "set null" }),
    equipmentType: equipmentTypeEnum("equipment_type"),
    startAt: ts("start_at"),
    endAt: ts("end_at"),
    previousDockId: uuid("previous_dock_id"),
    previousStartAt: ts("previous_start_at"),
    dockChanged: boolean("dock_changed").notNull().default(false),
    startShiftMin: integer("start_shift_min"),
    waitingMin: integer("waiting_min"),
    tardinessMin: integer("tardiness_min"),
    assigned: boolean("assigned").notNull(),
    reasons: jsonb("reasons").$type<{ en: string; ar: string }[]>().notNull().default([]),
    alternatives: jsonb("alternatives").$type<unknown[]>().notNull().default([]),
  },
  (t) => [index("optimization_candidates_run_idx").on(t.runId)],
);

export const simulationScenarios = pgTable("simulation_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  preset: text("preset"),
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  seed: integer("seed").notNull(),
  replications: integer("replications").notNull(),
  policies: text("policies").array().notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const simulationRuns = pgTable(
  "simulation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id").notNull().references(() => simulationScenarios.id, { onDelete: "cascade" }),
    policy: simulationPolicyEnum("policy").notNull(),
    replication: integer("replication").notNull(),
    seed: integer("seed").notNull(),
    simVersion: text("sim_version"),
    jobStatus: jobStatusEnum("job_status").notNull().default("QUEUED"),
    metrics: jsonb("metrics").$type<Record<string, number>>(),
    timeseries: jsonb("timeseries").$type<Record<string, unknown>>(),
    eventCount: integer("event_count"),
    runtimeMs: integer("runtime_ms"),
    error: text("error"),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("simulation_runs_scenario_idx").on(t.scenarioId)],
);

export const simulationEvents = pgTable(
  "simulation_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").notNull().references(() => simulationRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    tMin: doublePrecision("t_min").notNull(),
    eventType: text("event_type").notNull(),
    truckRef: text("truck_ref"),
    dockRef: text("dock_ref"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("simulation_events_run_idx").on(t.runId, t.seq)],
);

export const modelVersions = pgTable(
  "model_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    modelName: text("model_name").notNull(),
    version: text("version").notNull(),
    algorithm: text("algorithm").notNull(),
    datasetSource: text("dataset_source").notNull(),
    trainingDate: ts("training_date").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    baselineMetrics: jsonb("baseline_metrics").$type<Record<string, unknown>>().notNull(),
    beatsBaseline: boolean("beats_baseline").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    label: text("label").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("model_versions_name_version_uq").on(t.modelName, t.version)],
);

/* ------------------------------------------------------------------ */
/* Virtual sensors & quality                                           */
/* ------------------------------------------------------------------ */

export const sensorStreams = pgTable(
  "sensor_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    scenario: sensorScenarioEnum("scenario").notNull(),
    seed: integer("seed").notNull(),
    generatorVersion: text("generator_version").notNull(),
    intervalSec: integer("interval_sec").notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    thresholds: jsonb("thresholds").$type<Record<string, number>>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("sensor_streams_shipment_idx").on(t.shipmentId)],
);

export const sensorReadings = pgTable(
  "sensor_readings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    streamId: uuid("stream_id").notNull().references(() => sensorStreams.id, { onDelete: "cascade" }),
    ts: ts("ts").notNull(),
    temperatureC: real("temperature_c"),
    humidityPct: real("humidity_pct"),
    shockG: real("shock_g"),
    vibrationRms: real("vibration_rms"),
    missing: boolean("missing").notNull().default(false),
  },
  (t) => [index("sensor_readings_stream_ts_idx").on(t.streamId, t.ts)],
);

export const sensorEvents = pgTable(
  "sensor_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    streamId: uuid("stream_id").notNull().references(() => sensorStreams.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    type: sensorEventTypeEnum("type").notNull(),
    ruleId: text("rule_id").notNull(),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at").notNull(),
    peakValue: real("peak_value"),
    threshold: real("threshold"),
    readingsCount: integer("readings_count").notNull(),
    severity: severityEnum("severity").notNull(),
    requiresReview: boolean("requires_review").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sensor_events_shipment_idx").on(t.shipmentId)],
);

export const qualityReviews = pgTable(
  "quality_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    truckId: uuid("truck_id").references(() => trucks.id, { onDelete: "set null" }),
    status: qualityStatusEnum("status").notNull(),
    trigger: text("trigger").notNull(),
    sensorEventIds: uuid("sensor_event_ids").array().notNull().default(sql`'{}'::uuid[]`),
    violations: jsonb("violations").$type<unknown[]>().notNull().default([]),
    missingData: boolean("missing_data").notNull().default(false),
    inspectionRequired: boolean("inspection_required").notNull().default(true),
    assignedInspectorId: uuid("assigned_inspector_id").references(() => users.id, { onDelete: "set null" }),
    decision: text("decision"),
    notes: text("notes"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: ts("decided_at"),
    history: jsonb("history").$type<{ at: string; actor: string; from: string | null; to: string; notes: string | null }[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("quality_reviews_facility_idx").on(t.facilityId, t.status),
    uniqueIndex("quality_reviews_one_open_per_shipment").on(t.shipmentId).where(sql`status in ('REVIEW_REQUIRED','UNDER_REVIEW','ESCALATED','HOLD')`),
  ],
);

/* ------------------------------------------------------------------ */
/* Handover                                                            */
/* ------------------------------------------------------------------ */

export const handoverRecords = pgTable("handover_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  facilityId: uuid("facility_id").notNull().references(() => facilities.id, { onDelete: "cascade" }),
  shipmentId: uuid("shipment_id").notNull().unique().references(() => shipments.id, { onDelete: "cascade" }),
  truckId: uuid("truck_id").notNull().references(() => trucks.id, { onDelete: "cascade" }),
  reference: text("reference").notNull().unique(),
  /** Opaque random identifier embedded in the QR code. Grants nothing by itself: scanning requires an authenticated, authorised session. */
  qrToken: text("qr_token").notNull().unique(),
  status: handoverStatusEnum("status").notNull().default("PENDING_ARRIVAL"),
  inspectionRecorded: boolean("inspection_recorded").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const handoverActions = pgTable(
  "handover_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handoverId: uuid("handover_id").notNull().references(() => handoverRecords.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    previousStatus: handoverStatusEnum("previous_status").notNull(),
    newStatus: handoverStatusEnum("new_status").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    notes: text("notes"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("handover_actions_idem_uq").on(t.handoverId, t.idempotencyKey), uniqueIndex("handover_actions_once_uq").on(t.handoverId, t.action)],
);

/* ------------------------------------------------------------------ */
/* Notifications, audit, idempotency                                    */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id").references(() => facilities.id, { onDelete: "cascade" }),
    /** Either a specific user, or a set of roles (null userId). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    targetRoles: text("target_roles").array().notNull().default(sql`'{}'::text[]`),
    /** For scoped roles (carrier/driver): restrict to this carrier. */
    carrierId: uuid("carrier_id"),
    type: text("type").notNull(),
    severity: severityEnum("severity").notNull(),
    title: text("title").notNull(),
    titleAr: text("title_ar").notNull(),
    body: text("body").notNull(),
    bodyAr: text("body_ar").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    actionRequired: boolean("action_required").notNull().default(false),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_org_created_idx").on(t.orgId, t.createdAt)],
);

export const notificationReads = pgTable(
  "notification_reads",
  {
    notificationId: uuid("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    readAt: ts("read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);

/** Append-only audit log. UPDATE/DELETE are blocked by trigger (migration 0001). */
export const auditEvents = pgTable(
  "audit_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: uuid("id").notNull().unique().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    facilityId: uuid("facility_id"),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label").notNull(),
    source: text("source").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    correlationId: uuid("correlation_id").notNull(),
    previousState: jsonb("previous_state").$type<Record<string, unknown> | null>(),
    newState: jsonb("new_state").$type<Record<string, unknown> | null>(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_facility_time_idx").on(t.facilityId, t.occurredAt),
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_type_idx").on(t.eventType),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    userId: uuid("user_id").notNull(),
    route: text("route").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.route, t.key] })],
);
