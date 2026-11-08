# Database

PostgreSQL 16, schema in [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts) (Drizzle), migrations in [`apps/api/drizzle/`](../apps/api/drizzle): `0000_init.sql` (generated) and `0001_integrity.sql` (hand-written constraints/triggers). Run with `npm run db:migrate`.

## Entities

| Area | Tables |
|---|---|
| Tenancy & identity | `organizations`, `facilities`, `users`, `memberships` (role + carrier/driver scope), `sessions` (SHA-256 token hash, CSRF token, expiry) |
| Resources | `docks`, `gates`, `workforce_teams`, `equipment` |
| Operations | `carriers`, `drivers` (synthetic references only), `shipments`, `trucks`, `appointments`, `resource_reservations` |
| Decisions | `readiness_evaluations`, `decisions`, `optimization_runs`, `optimization_candidates`, `jobs` |
| Simulation & AI | `simulation_scenarios`, `simulation_runs`, `simulation_events`, `model_versions` |
| Quality | `sensor_streams`, `sensor_readings` (time series, index on `(stream_id, ts)`), `sensor_events`, `quality_reviews` |
| Handover | `handover_records` (opaque `qr_token`), `handover_actions` |
| Cross-cutting | `notifications`, `notification_reads`, `audit_events`, `idempotency_keys` |

Roles and permissions are an enum plus a code-defined matrix ([`permissions.ts`](../packages/shared/src/permissions.ts)) rather than tables: the matrix is versioned with the code that enforces it and shared with the UI.

## Integrity guarantees

| Guarantee | Mechanism |
|---|---|
| No resource is booked twice for overlapping time | `EXCLUDE USING gist (resource_type =, resource_id =, tstzrange(start_at,end_at) &&) WHERE status='ACTIVE'` (requires `btree_gist`) |
| Audit log is append-only | `BEFORE UPDATE/DELETE` trigger raises unless the demo-reset routine sets `wasl.audit_purge='demo'` inside its transaction |
| One active appointment per truck | partial unique index on `appointments(truck_id) WHERE status IN ('REQUESTED','PROPOSED','CONFIRMED')` |
| One open quality review per shipment | partial unique index on `quality_reviews(shipment_id) WHERE status IN (open statuses)` |
| A handover action happens once | unique `(handover_id, action)` and `(handover_id, idempotency_key)` |
| Valid ranges | `CHECK end_at > start_at`, `duration_min > 0`, `service_estimate_min > 0` |
| Tenant isolation | every operational row carries `org_id`/`facility_id`; all queries filter by the session's facility (and carrier/driver scope) |
| Referential integrity | foreign keys with explicit `ON DELETE` behaviour (cascade within a facility, `SET NULL` for optional references) |

Timestamps are `timestamptz` (UTC); the facility time zone (`Asia/Riyadh`) is applied only for display and shift windows. `trucks.deleted_at` supports soft delete. Enumerations are Postgres enums generated from `packages/shared/src/enums.ts`.

## Data provenance

* **Synthetic operational data:** `npm run db:seed` creates the demo organisation (4 docks, 2 gates, 3 teams, 6 equipment units, 4 carriers, 10 drivers, 10 trucks with backfilled history, one sensor excursion with an open quality review, a past dock maintenance) anchored to the current time, plus an isolated "Tenant B".
* **Simulation results** live in `simulation_runs/simulation_events` and are only ever produced by the simulator.
* **Model predictions** carry their source (`MODEL:service_time@version`, `BASELINE:…`, `PLANNING_TABLE`) on every truck (`service_estimate_source`).
* **Operational records** are the audit log and the rows changed by users.

The demo reset (`POST /api/demo/reset`, `DEMO_MODE=true` and `organizations.is_demo` only) deletes and recreates facility-scoped data of the demo organisation; users, carriers and drivers are kept.
