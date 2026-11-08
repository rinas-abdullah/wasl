# Demo guide (for judges)

**Accounts** (all `@demo.wasl.sa`, password `Wasl@Demo2026` unless the deployment sets `DEMO_PASSWORD`):

| Account | Role | Use it for |
|---|---|---|
| `ops` | Operations manager | Most of the walkthrough: trucks, docks, optimisation, simulation, readiness, release |
| `dock` | Dock supervisor | Releases, handover actions |
| `quality` | Quality officer | Virtual sensors, quality decisions |
| `admin` | Organisation admin | Settings, users, **demo reset** |
| `carrier` | Carrier operator (Najd) | Sees only Najd's trucks; no facility-wide screens |
| `driver` | Driver 01 | Sees only own truck (WSL-1006) |
| `auditor` | Auditor | Read-only: events, reports |
| `admin@tenant-b.demo.wasl.sa` | Admin of a second tenant | Proves tenant isolation |

The interface opens in Arabic; use the language switch (top bar) for English. Click the dashed **Demo mode** chip → *Reset demo scenario* (admin/ops) to return to the initial state; times are re-anchored to "now".

## Initial scenario (seeded, synthetic)

Riyadh Distribution Center (demo): 4 docks (D1/D2 reefer, D3 general + inspection bay, D4 side-loading), 2 gates, 3 teams (only Team Bravo has fragile handling; only Team Alpha has pharma GDP), forklift FL-03 in maintenance.

| Truck | Situation |
|---|---|
| WSL-1001, 1002 | Departed earlier today (history for reports and replay) |
| WSL-1003 | In service at D3 |
| WSL-1004 | In service at D1 (frozen) |
| WSL-1005 | Fragile load waiting in the yard → **HOLD**: the only qualified crew is busy (expected re-evaluation time shown) |
| WSL-1006 | Scheduled on D3 (driver account's truck) |
| WSL-1007 | Pharma, policy inspection, D1 |
| WSL-1008 | Bulk/clamp on D3 |
| WSL-1009 | Registered, no confirmed slot yet |
| WSL-1010 | Chilled, **documents incomplete** and a seeded **temperature excursion → review required** |

## Walkthrough (≈10 minutes)

1. **Overview** — KPIs, dock/team status, decision queue, upcoming arrivals, alerts, hourly trend. All derived from the database.
2. **Trucks** → *Register truck*: e.g. rigid, general cargo, 14 pallets. The service time is estimated by the model (source label shown). You land on the truck page.
3. **Appointments** → drag the truck from *Requests awaiting confirmation* onto D4 (or *Schedule*): the server validates compatibility and conflicts before you confirm.
4. **Digital twin** → click docks and trucks; the panel shows status, assignment, estimates, readiness and history. Try *Replay log* to scrub through today's events.
5. **Dock management** → *Disable dock* on D3 with a reason. The banner lists affected trucks; D3 is hatched in the twin, KPIs show 1 out-of-service dock, a critical alert appears, and new assignments to D3 are rejected.
6. **Optimization center** → the solver has already produced *Auto re-plan after D3…* (or press *Run optimization*). Inspect assignments: every reason comes from the solution (previous dock down, crew skills, preceding truck, alternatives).
7. Compare *current vs proposed* (same objective) and **Approve plan**. Appointments change in one transaction; no truck is called yet.
8. **Simulation lab** → *New scenario* → *Dock failure* (reduce replications to 1–2 for speed) → compare the four policies with 95% CIs. Use *Re-run to verify* to see identical results.
9. Sign in as **quality** → **Virtual sensors** → choose WSL-1007's shipment → *Generate temperature excursion*. A quality review is created automatically.
10. As **ops** → **Readiness engine** → WSL-1007 is now *Manual review required*. As **quality**, open the review and *Start review*; re-evaluate: READY with inspection time added.
11. **Readiness engine** → pick a READY truck (e.g. the one you registered) → **Release truck**. Try WSL-1005 (HOLD, crew busy) or WSL-1010 (documents → overridable; quality → not overridable) to see the override policy.
12. As **dock** → **Handover center** → select the released truck → Confirm arrival → Start unloading → Approve handover → Close operation (each action is idempotent and state-checked; a QR code opens the same page after sign-in).
13. **Event timeline** (any role with read access) → every step is there with actor, source and before/after state; export CSV/JSON.
14. **Analytics & reports** → throughput, waiting, turnaround, utilisation, bottlenecks and the truck turnaround table now include your truck. Print to PDF.
15. Optional: sign in as **carrier** or **driver** to see scoped views; as **Tenant B** you cannot see any of the above.
