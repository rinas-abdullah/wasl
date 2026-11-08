# Feature completion checklist

Legend: ✅ implemented and verified by an automated test or a recorded run · ☑️ implemented, verified manually in the browser only · ⚠️ partial · ❌ not implemented.

## Platform

| Feature | Status | Evidence |
|---|---|---|
| Monorepo (web / api / shared / intelligence / infra / tests / docs) | ✅ | repository |
| PostgreSQL schema, migrations, integrity constraints | ✅ | `apps/api/drizzle`, integration tests |
| Seed data (coherent, re-anchored, isolated second tenant) | ✅ | `db/seed`, integration tests |
| Authentication (bcrypt, HttpOnly sessions, remember-me, logout) | ✅ | integration tests |
| RBAC (8 roles) + resource-level scoping + tenant isolation | ✅ | integration + E2E |
| CSRF, rate limiting, input validation, secure errors | ✅ | integration tests |
| REST API + OpenAPI 3.1 (63 paths) + Swagger UI | ✅ | `/api/docs`, `docs/openapi.json` |
| Background job queue with status/progress/cancel | ✅ | optimisation & simulation tests |
| Live updates via SSE → cache invalidation | ☑️ | observed in browser; not asserted by automated tests |
| Docker images + Compose (health-gated) | ✅ | built and run; E2E passed against it |
| Arabic RTL + English LTR (dates, numbers, charts, tables, icons) | ☑️ | screenshots both locales |

## Operations

| Feature | Status | Evidence |
|---|---|---|
| Overview dashboard (13 KPIs, alerts, decision queue, arrivals, trends, timeline) | ✅ | E2E + KPI assertions in integration tests |
| Live operations board | ☑️ | browser |
| Trucks data grid: search, filters, server sort/pagination, column visibility, saved views (per-browser), CSV, bulk actions | ☑️ / ✅ | CSV & bulk endpoint covered; grid in E2E |
| Truck lifecycle state machine with guards, reasons, alternate paths | ✅ | shared + integration tests |
| Appointment scheduling: day/week, dock timeline, drag & drop, server conflict detection, requested/proposed/confirmed/actual separation | ✅ | integration (conflicts) + E2E (schedule) |
| Dock control: disable/restore/maintenance with full cascade | ✅ | integration "dock failure cascade" + E2E |
| Resource planning: teams, equipment, time-bounded reservations, conflicts | ✅ | EXCLUDE test, resource revocation in optimisation tests |

## Decision intelligence

| Feature | Status | Evidence |
|---|---|---|
| Readiness-to-Release engine (13 checks, evidence, clear times, alternatives) | ✅ | 9 unit tests + integration |
| Atomic release with race protection | ✅ | concurrent-release + EXCLUDE tests |
| Policy-limited override with audit | ✅ | integration |
| OR-Tools CP-SAT optimisation, solver statuses, explanations, current vs proposed, Preview → Approval → Commit, stale-plan protection | ✅ | pytest + integration + E2E |
| SimPy simulation: 7 presets, 4 policies, replications, CIs, event logs, reproducible re-run, cancel | ✅ | pytest + integration + E2E + `docs/EXPERIMENTS.md` |
| ML: service-time and congestion models, baselines, metrics, registry, inference API, baseline fallback | ✅ | pytest; live inference used by the API |
| Explainable decision center (inputs, constraints, alternatives, impact, execution) | ☑️ | browser |
| Digital twin: interactive top-down view bound to server state, dock/truck panels, live updates, event-sourced replay with play/pause/speed/scrub/inspect | ☑️ | E2E checks twin content; replay verified manually |

## Quality & handover

| Feature | Status | Evidence |
|---|---|---|
| Virtual sensor engine (seeded temperature/humidity/shock/vibration/missing, threshold rules, time-series storage, charts) | ✅ | unit + integration + E2E |
| Sensor event → quality review → readiness → assignment requirements → alert → shipment record | ✅ | integration + E2E |
| Quality workflow (6 states, role + notes enforced, audit trail, disclaimer) | ✅ | shared + integration |
| QR handover (opaque token, auth + scope on scan, state-guarded idempotent actions, history) | ✅ | integration + E2E |

## Insights & administration

| Feature | Status | Evidence |
|---|---|---|
| Event timeline: append-only, filters, search, detail, CSV/JSON export | ✅ | audit immutability test + E2E |
| Notifications: role/user/carrier targeting, read/unread, severity, entity links, action-required/resolved | ☑️ | browser |
| Analytics & reports: KPIs, dock/team utilisation, bottlenecks, turnaround table, optimisation & simulation summaries, CSV/JSON | ✅ | integration (consistency) + E2E |
| PDF export | ⚠️ | browser print stylesheet only (no server-side PDF) |
| Organisation settings (capacities, default weights) | ☑️ | browser |
| User management (create, role change rules, protected demo accounts, permission matrix) | ☑️ | browser |
| Demo mode indicator + safe reset | ✅ | integration "demo reset" |
| Help & documentation, demo walkthrough | ✅ | `/help`, `docs/DEMO_GUIDE.md` |

## Known limitations

* All data is synthetic; sensors are virtual; no real warehouse, carrier or telematics integration exists.
* Models are experimental and trained on a declared synthetic process; "Learn" (retraining from operations) is not implemented.
* In the simulator, Full WASL clearly reduces on-site waiting and yard queues but does **not** dominate FCFS on total delay or makespan in several scenarios (see EXPERIMENTS.md).
* SSE bus and rate limiting are per API process (single-replica assumption).
* No email/SMS/WhatsApp; no password reset/MFA; no Content-Security-Policy header yet.
* Saved table views are stored in the browser (a per-user convenience, not system state).
* PDF export relies on the browser's print-to-PDF.
* Not deployed publicly from this environment; "production-ready" is **not** claimed.
