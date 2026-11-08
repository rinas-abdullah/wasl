# Architecture

```
 Browser (Arabic RTL / English LTR)
   │  same-origin: /api/* rewritten by Next.js → API   (HttpOnly session cookie, CSRF header)
   ▼
 apps/web  Next.js 16 · React 19 · TanStack Query/Table · Recharts · Radix
   │  REST + Server-Sent Events (/api/stream)
   ▼
 apps/api  Fastify 5 · TypeScript · Drizzle ORM ─────────────► PostgreSQL 16
   │  • auth, RBAC, tenant scoping, CSRF, rate limiting        (EXCLUDE constraint, append-only
   │  • domain services (trucks, docks, readiness, quality…)    audit trigger, partial unique idx)
   │  • Postgres-backed job queue (FOR UPDATE SKIP LOCKED)
   │  • in-process event bus → SSE invalidation
   │  HTTP (internal, timeouts + bounded retries)
   ▼
 services/intelligence  FastAPI · OR-Tools CP-SAT · SimPy · scikit-learn
```

## Responsibilities

| Layer | Owns | Does not own |
|---|---|---|
| `packages/shared` | Enumerations, truck/quality/handover state machines, role→permission matrix, Zod input schemas, readiness check catalogue & aggregation, scenario presets | I/O |
| `apps/api` | All business rules and authorisation, persistence, transactions, audit, notifications, job orchestration, explanation text for decisions | Heavy maths |
| `services/intelligence` | Pure computation: solving, simulating, training/inference. Stateless apart from trained model artefacts | Business rules (compatibility and skills are resolved by the API and passed in), authorisation |
| `apps/web` | Presentation, bilingual UX, live refresh | Any decision logic; buttons are hidden for UX only — the API enforces everything |

## Key flows

**Release (call a truck).** `POST /api/readiness/release` → transaction → `pg_advisory_xact_lock(facility)` → `SELECT … FOR UPDATE` on the truck → load a fresh snapshot → `evaluateReadiness()` → validate overrides against policy → insert dock/team/equipment reservations (the `reservations_no_overlap` EXCLUDE constraint rejects concurrent double booking with SQLSTATE 23P01 → HTTP 409) → truck `CALLED` → decision + audit + notification → commit → SSE invalidation.

**Dock failure.** `PATCH /api/docks/:id/status` → dock status updated → affected trucks found → releases revoked (reservations `SUSPENDED`, `CALLED→SCHEDULED/WAITING`, `reassignment_required=true`) → pending decisions → `DOCK_FAILED` audit event → critical notification → after commit an optimisation job is queued (preview only) → SSE pushes `docks/trucks/twin/dashboard/notifications` so every screen agrees.

**Optimisation.** Job worker → `buildSolverInput()` (TS resolves compatibility/skills/equipment, fixes committed reservations) → `/optimize` (CP-SAT) → candidates with reasons/alternatives derived from the solution → plan `PENDING`. Approval re-validates every candidate against the current state (stale-plan protection) and commits appointments in one transaction. Releases still require the readiness engine.

**Sensor → quality → readiness.** `POST /api/virtual-sensors/scenarios` → seeded series → threshold rules → `sensor_events` → `openQualityRequirement()` (review, shipment status, inspection flag, revoke release if already called) → readiness re-evaluated after commit.

## Live state consistency

Every mutating service calls `bumpState()` (facility `state_version`) and queues an SSE message *after commit*. The browser invalidates the matching TanStack Query caches, so dashboard, tables, twin and reports always re-read the same server state. Dock `OCCUPIED`/`RESERVED` is derived from truck/reservation rows at read time rather than stored, so it cannot drift.

## Background jobs

`jobs` table with `QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED`, claimed with `FOR UPDATE SKIP LOCKED`, max 2 concurrent per API process, stale `RUNNING` jobs re-queued on start. Simulation progress is written per run. Heavy work never runs inside an HTTP request.

## Scaling notes (not implemented)

* The SSE bus is in-process; multiple API replicas need Postgres `LISTEN/NOTIFY` or Redis pub/sub.
* The job queue already supports multiple workers.
* The intelligence service is stateless and can be replicated; CP-SAT uses 8 workers per live solve.
