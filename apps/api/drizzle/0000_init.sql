CREATE TYPE "public"."appointment_status" AS ENUM('REQUESTED', 'PROPOSED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."cargo_type" AS ENUM('GENERAL', 'CHILLED', 'FROZEN', 'PHARMA', 'FRAGILE', 'BULK');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('PENDING_REVIEW', 'EXECUTED', 'REJECTED', 'SUPERSEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."decision_type" AS ENUM('RELEASE', 'HOLD', 'REASSIGNMENT', 'OVERRIDE_RELEASE', 'PLAN_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."dock_status" AS ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE');--> statement-breakpoint
CREATE TYPE "public"."equipment_type" AS ENUM('FORKLIFT', 'PALLET_JACK', 'REACH_TRUCK', 'CLAMP_TRUCK');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."gate_type" AS ENUM('ENTRY', 'EXIT');--> statement-breakpoint
CREATE TYPE "public"."handling_method" AS ENUM('FORKLIFT_PALLET', 'PALLET_JACK', 'MANUAL', 'CLAMP');--> statement-breakpoint
CREATE TYPE "public"."handover_status" AS ENUM('PENDING_ARRIVAL', 'ARRIVAL_CONFIRMED', 'UNLOADING', 'INSPECTION_RECORDED', 'APPROVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."plan_approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'STALE', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('LOW', 'NORMAL', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."quality_status" AS ENUM('NO_ISSUE_OBSERVED', 'REVIEW_REQUIRED', 'UNDER_REVIEW', 'RELEASED_BY_AUTHORIZED_USER', 'ESCALATED', 'HOLD');--> statement-breakpoint
CREATE TYPE "public"."readiness_outcome" AS ENUM('READY', 'HOLD', 'REASSIGNMENT_REQUIRED', 'MANUAL_REVIEW_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."reservation_resource" AS ENUM('DOCK', 'TEAM', 'EQUIPMENT');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('ACTIVE', 'SUSPENDED', 'RELEASED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."resource_status" AS ENUM('AVAILABLE', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'ORGANIZATION_ADMIN', 'OPERATIONS_MANAGER', 'DOCK_SUPERVISOR', 'QUALITY_OFFICER', 'CARRIER_OPERATOR', 'DRIVER', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."sensor_event_type" AS ENUM('TEMP_EXCURSION', 'HUMIDITY_EXCURSION', 'SHOCK', 'MISSING_DATA');--> statement-breakpoint
CREATE TYPE "public"."sensor_scenario" AS ENUM('NORMAL', 'TEMP_EXCURSION', 'SHOCK', 'MISSING_DATA');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."simulation_policy" AS ENUM('FCFS', 'FIXED_APPOINTMENTS', 'OR_ONLY', 'FULL_WASL');--> statement-breakpoint
CREATE TYPE "public"."solver_status" AS ENUM('OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'MODEL_INVALID', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."truck_status" AS ENUM('REGISTERED', 'SCHEDULED', 'CALLED', 'ARRIVED', 'WAITING', 'IN_SERVICE', 'COMPLETED', 'DEPARTED', 'CANCELLED', 'NO_SHOW', 'EXCEPTION');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('VAN', 'RIGID', 'ARTICULATED', 'REEFER_TRAILER');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"dock_id" uuid,
	"status" "appointment_status" NOT NULL,
	"requested_start" timestamp with time zone NOT NULL,
	"proposed_start" timestamp with time zone,
	"confirmed_start" timestamp with time zone,
	"duration_min" integer NOT NULL,
	"source" text NOT NULL,
	"optimization_run_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_label" text,
	"actor_id" uuid,
	"actor_label" text NOT NULL,
	"source" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"previous_state" jsonb,
	"new_state" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"truck_id" uuid,
	"optimization_run_id" uuid,
	"readiness_evaluation_id" uuid,
	"type" "decision_type" NOT NULL,
	"status" "decision_status" NOT NULL,
	"outcome" "readiness_outcome",
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_action" jsonb,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overridden_checks" text[] DEFAULT '{}'::text[] NOT NULL,
	"override_reason" text,
	"execution_result" jsonb,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "docks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"status" "dock_status" DEFAULT 'AVAILABLE' NOT NULL,
	"status_reason" text,
	"status_until" timestamp with time zone,
	"max_vehicle_type" "vehicle_type" NOT NULL,
	"compatible_cargo" "cargo_type"[] NOT NULL,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"restrictions" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"carrier_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "equipment_type" NOT NULL,
	"status" "equipment_status" DEFAULT 'AVAILABLE' NOT NULL,
	"status_reason" text,
	"compatible_operations" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"city" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"yard_capacity" integer NOT NULL,
	"gate_capacity_per_hour" integer NOT NULL,
	"travel_time_min" integer DEFAULT 15 NOT NULL,
	"congestion_threshold" integer DEFAULT 5 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "gate_type" NOT NULL,
	"status" "gate_status" DEFAULT 'OPEN' NOT NULL,
	"capacity_per_hour" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handover_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handover_id" uuid NOT NULL,
	"action" text NOT NULL,
	"previous_status" "handover_status" NOT NULL,
	"new_status" "handover_status" NOT NULL,
	"actor_id" uuid,
	"idempotency_key" text NOT NULL,
	"notes" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handover_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"qr_token" text NOT NULL,
	"status" "handover_status" DEFAULT 'PENDING_ARRIVAL' NOT NULL,
	"inspection_recorded" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handover_records_shipment_id_unique" UNIQUE("shipment_id"),
	CONSTRAINT "handover_records_reference_unique" UNIQUE("reference"),
	CONSTRAINT "handover_records_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"route" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_route_key_pk" PRIMARY KEY("user_id","route","key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid,
	"type" text NOT NULL,
	"ref_id" uuid,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"carrier_id" uuid,
	"driver_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_name" text NOT NULL,
	"version" text NOT NULL,
	"algorithm" text NOT NULL,
	"dataset_source" text NOT NULL,
	"training_date" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	"baseline_metrics" jsonb NOT NULL,
	"beats_baseline" boolean NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"label" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid,
	"user_id" uuid,
	"target_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"carrier_id" uuid,
	"type" text NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"title_ar" text NOT NULL,
	"body" text NOT NULL,
	"body_ar" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"action_required" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimization_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"dock_id" uuid,
	"team_id" uuid,
	"equipment_type" "equipment_type",
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"previous_dock_id" uuid,
	"previous_start_at" timestamp with time zone,
	"dock_changed" boolean DEFAULT false NOT NULL,
	"start_shift_min" integer,
	"waiting_min" integer,
	"tardiness_min" integer,
	"assigned" boolean NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "optimization_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"label" text,
	"trigger" text NOT NULL,
	"job_status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"solver_status" "solver_status",
	"approval_status" "plan_approval_status" DEFAULT 'PENDING' NOT NULL,
	"params" jsonb NOT NULL,
	"input_snapshot" jsonb,
	"objective_value" double precision,
	"best_bound" double precision,
	"objective_breakdown" jsonb,
	"current_plan_breakdown" jsonb,
	"constraint_summary" jsonb,
	"runtime_ms" integer,
	"solver_version" text,
	"base_state_version" bigint,
	"error" text,
	"created_by" uuid,
	"decided_by" uuid,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"slug" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "quality_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"truck_id" uuid,
	"status" "quality_status" NOT NULL,
	"trigger" text NOT NULL,
	"sensor_event_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"violations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_data" boolean DEFAULT false NOT NULL,
	"inspection_required" boolean DEFAULT true NOT NULL,
	"assigned_inspector_id" uuid,
	"decision" text,
	"notes" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"outcome" "readiness_outcome" NOT NULL,
	"proposed_call_time" timestamp with time zone NOT NULL,
	"checks" jsonb NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"next_reevaluation_at" timestamp with time zone,
	"engine_version" text NOT NULL,
	"evaluated_by" uuid,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"resource_type" "reservation_resource" NOT NULL,
	"resource_id" uuid NOT NULL,
	"truck_id" uuid NOT NULL,
	"decision_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stream_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"type" "sensor_event_type" NOT NULL,
	"rule_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"peak_value" real,
	"threshold" real,
	"readings_count" integer NOT NULL,
	"severity" "severity" NOT NULL,
	"requires_review" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"stream_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"temperature_c" real,
	"humidity_pct" real,
	"shock_g" real,
	"vibration_rms" real,
	"missing" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sensor_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"scenario" "sensor_scenario" NOT NULL,
	"seed" integer NOT NULL,
	"generator_version" text NOT NULL,
	"interval_sec" integer NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"thresholds" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"facility_id" uuid,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"cargo_type" "cargo_type" NOT NULL,
	"pallet_count" integer NOT NULL,
	"weight_kg" integer NOT NULL,
	"handling_method" "handling_method" NOT NULL,
	"documents_complete" boolean DEFAULT true NOT NULL,
	"inspection_required" boolean DEFAULT false NOT NULL,
	"required_conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_status" "quality_status" DEFAULT 'NO_ISSUE_OBSERVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"t_min" double precision NOT NULL,
	"event_type" text NOT NULL,
	"truck_ref" text,
	"dock_ref" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"policy" "simulation_policy" NOT NULL,
	"replication" integer NOT NULL,
	"seed" integer NOT NULL,
	"sim_version" text,
	"job_status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"metrics" jsonb,
	"timeseries" jsonb,
	"event_count" integer,
	"runtime_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "simulation_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"name" text NOT NULL,
	"preset" text,
	"params" jsonb NOT NULL,
	"seed" integer NOT NULL,
	"replications" integer NOT NULL,
	"policies" text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"code" text NOT NULL,
	"plate_number" text NOT NULL,
	"carrier_id" uuid NOT NULL,
	"driver_id" uuid,
	"shipment_id" uuid NOT NULL,
	"vehicle_type" "vehicle_type" NOT NULL,
	"status" "truck_status" DEFAULT 'REGISTERED' NOT NULL,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"notes" text,
	"requested_arrival" timestamp with time zone NOT NULL,
	"actual_arrival" timestamp with time zone,
	"assigned_dock_id" uuid,
	"reassignment_required" boolean DEFAULT false NOT NULL,
	"service_estimate_min" integer NOT NULL,
	"service_estimate_low_min" integer,
	"service_estimate_high_min" integer,
	"service_estimate_source" text NOT NULL,
	"called_at" timestamp with time zone,
	"service_started_at" timestamp with time zone,
	"service_completed_at" timestamp with time zone,
	"departed_at" timestamp with time zone,
	"status_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trucks_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workforce_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"shift_start" text NOT NULL,
	"shift_end" text NOT NULL,
	"size" integer NOT NULL,
	"skills" text[] NOT NULL,
	"status" "resource_status" DEFAULT 'AVAILABLE' NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_dock_id_docks_id_fk" FOREIGN KEY ("dock_id") REFERENCES "public"."docks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carriers" ADD CONSTRAINT "carriers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_readiness_evaluation_id_readiness_evaluations_id_fk" FOREIGN KEY ("readiness_evaluation_id") REFERENCES "public"."readiness_evaluations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docks" ADD CONSTRAINT "docks_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_actions" ADD CONSTRAINT "handover_actions_handover_id_handover_records_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."handover_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_actions" ADD CONSTRAINT "handover_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_records" ADD CONSTRAINT "handover_records_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_records" ADD CONSTRAINT "handover_records_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_records" ADD CONSTRAINT "handover_records_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_candidates" ADD CONSTRAINT "optimization_candidates_run_id_optimization_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."optimization_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_candidates" ADD CONSTRAINT "optimization_candidates_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_candidates" ADD CONSTRAINT "optimization_candidates_dock_id_docks_id_fk" FOREIGN KEY ("dock_id") REFERENCES "public"."docks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_candidates" ADD CONSTRAINT "optimization_candidates_team_id_workforce_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."workforce_teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_runs" ADD CONSTRAINT "optimization_runs_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_assigned_inspector_id_users_id_fk" FOREIGN KEY ("assigned_inspector_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reviews" ADD CONSTRAINT "quality_reviews_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_evaluations" ADD CONSTRAINT "readiness_evaluations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_evaluations" ADD CONSTRAINT "readiness_evaluations_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_evaluations" ADD CONSTRAINT "readiness_evaluations_evaluated_by_users_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reservations" ADD CONSTRAINT "resource_reservations_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_events" ADD CONSTRAINT "sensor_events_stream_id_sensor_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."sensor_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_events" ADD CONSTRAINT "sensor_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_readings" ADD CONSTRAINT "sensor_readings_stream_id_sensor_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."sensor_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_streams" ADD CONSTRAINT "sensor_streams_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_streams" ADD CONSTRAINT "sensor_streams_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensor_streams" ADD CONSTRAINT "sensor_streams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_events" ADD CONSTRAINT "simulation_events_run_id_simulation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."simulation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_runs" ADD CONSTRAINT "simulation_runs_scenario_id_simulation_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."simulation_scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_scenarios" ADD CONSTRAINT "simulation_scenarios_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_scenarios" ADD CONSTRAINT "simulation_scenarios_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_scenarios" ADD CONSTRAINT "simulation_scenarios_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trucks" ADD CONSTRAINT "trucks_assigned_dock_id_docks_id_fk" FOREIGN KEY ("assigned_dock_id") REFERENCES "public"."docks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workforce_teams" ADD CONSTRAINT "workforce_teams_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_facility_start_idx" ON "appointments" USING btree ("facility_id","confirmed_start");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_one_active_per_truck" ON "appointments" USING btree ("truck_id") WHERE status in ('REQUESTED','PROPOSED','CONFIRMED');--> statement-breakpoint
CREATE INDEX "audit_facility_time_idx" ON "audit_events" USING btree ("facility_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "carriers_org_code_uq" ON "carriers" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "decisions_facility_idx" ON "decisions" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE INDEX "decisions_truck_idx" ON "decisions" USING btree ("truck_id");--> statement-breakpoint
CREATE UNIQUE INDEX "docks_facility_code_uq" ON "docks" USING btree ("facility_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_org_ref_uq" ON "drivers" USING btree ("org_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_facility_code_uq" ON "equipment" USING btree ("facility_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_org_code_uq" ON "facilities" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "gates_facility_code_uq" ON "gates" USING btree ("facility_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "handover_actions_idem_uq" ON "handover_actions" USING btree ("handover_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "handover_actions_once_uq" ON "handover_actions" USING btree ("handover_id","action");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_org_uq" ON "memberships" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_name_version_uq" ON "model_versions" USING btree ("model_name","version");--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "optimization_candidates_run_idx" ON "optimization_candidates" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "optimization_runs_facility_idx" ON "optimization_runs" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE INDEX "quality_reviews_facility_idx" ON "quality_reviews" USING btree ("facility_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_reviews_one_open_per_shipment" ON "quality_reviews" USING btree ("shipment_id") WHERE status in ('REVIEW_REQUIRED','UNDER_REVIEW','ESCALATED','HOLD');--> statement-breakpoint
CREATE INDEX "readiness_truck_idx" ON "readiness_evaluations" USING btree ("truck_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "reservations_resource_idx" ON "resource_reservations" USING btree ("resource_type","resource_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_truck_idx" ON "resource_reservations" USING btree ("truck_id");--> statement-breakpoint
CREATE INDEX "sensor_events_shipment_idx" ON "sensor_events" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "sensor_readings_stream_ts_idx" ON "sensor_readings" USING btree ("stream_id","ts");--> statement-breakpoint
CREATE INDEX "sensor_streams_shipment_idx" ON "sensor_streams" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_facility_ref_uq" ON "shipments" USING btree ("facility_id","reference");--> statement-breakpoint
CREATE INDEX "simulation_events_run_idx" ON "simulation_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "simulation_runs_scenario_idx" ON "simulation_runs" USING btree ("scenario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trucks_facility_code_uq" ON "trucks" USING btree ("facility_id","code");--> statement-breakpoint
CREATE INDEX "trucks_facility_status_idx" ON "trucks" USING btree ("facility_id","status");--> statement-breakpoint
CREATE INDEX "trucks_dock_idx" ON "trucks" USING btree ("assigned_dock_id");--> statement-breakpoint
CREATE INDEX "trucks_carrier_idx" ON "trucks" USING btree ("carrier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_facility_code_uq" ON "workforce_teams" USING btree ("facility_id","code");