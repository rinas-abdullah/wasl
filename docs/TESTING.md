# Testing

| Suite | Command | What it proves | Last result |
|---|---|---|---|
| Shared domain unit tests | `npm test -w @wasl/shared` | Truck state machine & guards, readiness aggregation & overrides, quality/handover workflows, permissions, Riyadh time zone handling, presets validate | 12 passed |
| API unit tests | `npx vitest run test/unit.test.ts` (in `apps/api`) | Readiness engine on constructed snapshots (READY, reassignment, hold with clear time, crew double-booking, skills, quality, documents vs yard overridability, determinism), resource availability, estimates, virtual sensor determinism and rules, CSV injection | 17 passed |
| API integration tests | `npm test -w @wasl/api` (needs Postgres; uses `wasl_test`, refuses other DBs; needs the intelligence service for 4 solver/simulation tests, which skip with a visible "skipped" if it is down) | Authentication, CSRF, RBAC, IDOR, tenant isolation, truck lifecycle, appointment conflicts, optimistic concurrency, readiness hold & override policy, **concurrent releases**, **EXCLUDE constraint**, dock-failure cascade (alerts, re-plan job, dashboard & twin), OR-Tools solve → explain → approve, **INFEASIBLE**, **stale plan**, sensor → quality → readiness, idempotent/duplicate handover, SimPy run + **reproducible re-run**, audit immutability, report consistency, demo reset scope | 29 passed |
| Intelligence tests | `python -m pytest -q services/intelligence/tests` | CP-SAT no-overlap, down docks, fixed commitments, infeasibility, unassigned reasons, equipment & inspector capacity, reassignment weight, tiny time limit, current-plan conflicts; SimPy reproducibility, no dock double occupancy across all policies, failed docks unused, metric consistency; ML dataset determinism, ground-truth monotonicity, baseline comparison | 18 passed |
| End-to-end (Playwright) | `npm run e2e` with web/API/intelligence running (set `E2E_BASE_URL` for another host) | The full acceptance journey of the brief through the real UI, plus carrier scoping | 2 passed (dev servers **and** the Docker Compose stack) |

All counts above come from runs in the development environment on 2026-11-08.

## Edge cases → where they are tested

| Edge case | Test |
|---|---|
| Two trucks claim the same dock | integration “two concurrent releases…”, “EXCLUDE constraint” |
| Missing resource | unit “busy team → HOLD”, optimizer “no eligible team” |
| Solver timeout | pytest `test_tiny_time_limit_reports_a_known_status` |
| Infeasible optimisation | pytest + integration “INFEASIBLE” |
| Service failure | `intel()` client: timeouts + bounded retries; `/api/health` degraded; estimates fall back to labelled planning table; optimisation job records FAILED with notification |
| Concurrent updates | integration “optimistic concurrency”, advisory locks |
| Unauthorised approval | integration “carrier cannot approve plans” |
| Missing sensor data | unit “R-MISS-01”, integration reproducible MISSING_DATA |
| Duplicate handover | integration “Idempotency-Key … rejects repeated actions” |
| Time zone errors | shared “Riyadh offset and local midnight” |
| Stale operational state | integration “stale plan is rejected” |

## Not covered

No load/performance tests, no visual regression tests, no automated accessibility audit (keyboard focus, labels and semantic markup were checked manually only).
