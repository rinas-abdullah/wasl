| GET | `/api/appointments` | trucks:read | Appointments in a time window (calendar / dock timeline) |
| POST | `/api/appointments` | appointments:manage | Confirm or reschedule an appointment (server-validated) |
| POST | `/api/appointments/validate` | appointments:manage | Validate a slot without saving (conflict detection) |
| POST | `/api/auth/login` | public | Sign in (sets HttpOnly session cookie) |
| POST | `/api/auth/logout` | authenticated | Sign out |
| GET | `/api/auth/me` | authenticated | Current user, role, permissions, facility and CSRF token |
| GET | `/api/carriers` | trucks:read | Carriers (scoped for carrier roles) |
| GET | `/api/dashboard/congestion-risk` | dashboard:read | Congestion risk (Model 02) for the next 2 hours |
| GET | `/api/dashboard/overview` | dashboard:read | Operational KPIs derived from stored records |
| GET | `/api/decisions` | dashboard:read | Decision log (holds, releases, overrides, plan approvals) |
| GET | `/api/decisions/{id}` | dashboard:read | Explainable decision detail (inputs, checks, alternatives, execution) |
| POST | `/api/demo/reset` | demo:reset | Reset the demo facility (DEMO_MODE + demo organisation only) |
| GET | `/api/docks` | docks:read | Docks with effective status, workload and availability |
| PATCH | `/api/docks/{id}` | resources:manage | Edit dock capabilities |
| PATCH | `/api/docks/{id}/status` | docks:manage | Disable / restore / maintenance (cascades to trucks, plans, alerts) |
| GET | `/api/events` | events:read | Audit/event timeline (append-only) |
| GET | `/api/events/export` | events:read | Export events (CSV or JSON) |
| GET | `/api/facilities` | authenticated | Facilities of the current organisation |
| GET | `/api/handover` | handover:read | Handover records |
| POST | `/api/handover/actions` | handover:act | Record a handover action (Idempotency-Key required) |
| GET | `/api/handover/scan/{token}` | handover:read | Resolve a scanned QR token (auth + scope enforced) |
| GET | `/api/handover/{id}/qr.svg` | handover:act | QR code (SVG) encoding the opaque scan URL |
| GET | `/api/health` | public | Liveness & dependency health |
| GET | `/api/models` | models:read | Model registry (synced from the intelligence service) |
| GET | `/api/notifications` | notifications:read | In-app notifications visible to the current user |
| POST | `/api/notifications/read` | notifications:read | Mark notifications as read |
| POST | `/api/optimization/runs` | optimization:run | Queue a CP-SAT optimisation run (preview only) |
| GET | `/api/optimization/runs` | optimization:read | Optimisation run history |
| GET | `/api/optimization/runs/{id}` | optimization:read | Run detail with candidates and reasons |
| POST | `/api/optimization/runs/{id}/approve` | optimization:approve | Approve and commit a plan (re-validated against current state) |
| POST | `/api/optimization/runs/{id}/reject` | optimization:approve | Reject a plan |
| GET | `/api/quality/reviews` | quality:read | Quality reviews |
| POST | `/api/quality/reviews` | readiness:evaluate | Request a manual quality review |
| GET | `/api/quality/reviews/{id}` | quality:read | Quality review detail with sensor evidence and audit trail |
| POST | `/api/quality/reviews/{id}/actions` | quality:review | Quality workflow action (role + state enforced) |
| POST | `/api/readiness/evaluate` | readiness:evaluate | Evaluate Readiness-to-Release (persisted, explainable) |
| GET | `/api/readiness/evaluations` | readiness:evaluate | Recent readiness evaluations |
| POST | `/api/readiness/release` | release:execute | Release (call) a truck — atomic re-evaluation + resource reservation |
| GET | `/api/reports/operations` | reports:read | Operations report (KPIs, dock/team utilisation, bottlenecks, trucks) |
| GET | `/api/resources` | resources:read | Teams, equipment and time-bounded reservations (with conflicts) |
| PATCH | `/api/resources/equipment/{id}/status` | resources:manage | Set equipment status (revokes affected releases) |
| PATCH | `/api/resources/teams/{id}` | resources:manage | Edit team shift/skills/size |
| PATCH | `/api/resources/teams/{id}/status` | resources:manage | Set team availability (revokes affected releases) |
| POST | `/api/session/facility` | authenticated | Switch the active facility (must belong to the organisation) |
| GET | `/api/settings` | dashboard:read | Facility operational settings |
| PATCH | `/api/settings` | settings:manage | Update facility operational settings |
| GET | `/api/shipments` | quality:read | Shipments with quality status (for sensors/quality) |
| POST | `/api/simulations/runs` | simulation:run | Queue a SimPy experiment (scenario × policies × replications) |
| GET | `/api/simulations/runs/{id}/events` | simulation:read | Event log of one simulation run (for replay) |
| GET | `/api/simulations/scenarios` | simulation:read | Experiment history |
| GET | `/api/simulations/scenarios/{id}` | simulation:read | Experiment with runs, metrics and policy summary (mean ± 95% CI) |
| POST | `/api/simulations/scenarios/{id}/cancel` | simulation:run | Cancel a queued/running experiment |
| POST | `/api/simulations/scenarios/{id}/rerun` | simulation:run | Re-run with identical inputs and seed (reproducibility check) |
| GET | `/api/trucks` | trucks:read | List trucks (server-side filter, sort, pagination) |
| POST | `/api/trucks` | trucks:create | Register a truck with its shipment |
| POST | `/api/trucks/bulk-transitions` | trucks:transition | Bulk lifecycle action (each truck validated individually) |
| GET | `/api/trucks/export.csv` | trucks:read | Export trucks as CSV (current filters) |
| GET | `/api/trucks/{id}` | trucks:read | Truck detail with shipment, appointments, reservations, readiness, events |
| PATCH | `/api/trucks/{id}` | trucks:update | Edit truck/shipment (optimistic concurrency via version) |
| POST | `/api/trucks/{id}/cancel` | trucks:cancel | Cancel a truck request |
| POST | `/api/trucks/{id}/transitions` | trucks:transition | Apply a lifecycle action (state machine enforced) |
| GET | `/api/twin/replay` | events:read | Event-sourced replay of the operations log |
| GET | `/api/twin/state` | dashboard:read | Digital twin live state |
| GET | `/api/users` | users:read | Organisation users and roles |
| POST | `/api/users` | users:manage | Create a user in this organisation |
| PATCH | `/api/users/{id}/role` | users:manage | Change a user's role |
| POST | `/api/virtual-sensors/scenarios` | sensors:generate | Generate a seeded synthetic sensor journey and run detection rules |
| POST | `/api/virtual-sensors/shipments/{id}/reset` | sensors:generate | Archive active streams (quality reviews are kept) |
| GET | `/api/virtual-sensors/shipments/{id}/streams` | quality:read | Sensor streams of a shipment |
| GET | `/api/virtual-sensors/streams/{id}` | quality:read | Readings and detected events of a stream |

`authenticated` = any signed-in user; `public` = no session. Carrier operators and drivers are additionally scoped to their own carrier/driver records on every truck, appointment, handover and report query.
