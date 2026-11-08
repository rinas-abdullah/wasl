# Methodology

This document states the assumptions behind every number WASL computes, so results can be challenged and reproduced. **All data is synthetic.** Results on synthetic data do not demonstrate performance in a real warehouse.

## 1. Data generation

**Service time (ground truth)** — [`groundtruth.py`](../services/intelligence/wasl_intel/groundtruth.py):

`mean = setup(cargo) + perPallet(handling) × cargoFactor(cargo) × pallets × (4/teamSize)^0.55 × (1.15 if no leveler) + vehicleOverhead + 20·inspection`,
actual ~ LogNormal(mean, CV) (CV 0.22 for the ML dataset, scenario CV in the simulator). Feature distributions (cargo mix, handling mix, vehicle by cargo, pallets by vehicle, crew 2–6, 80 % levelers, 12 % inspection) are fixed and seeded.

**Congestion labels** — 2 500 windows with random state (docks, crews, arrivals in next 2 h, mean service, yard occupancy, current utilisation); each label is the outcome of a **SimPy roll-out** of 120 minutes: `congested = max queue ≥ 5`. Labels are therefore produced by a queueing process, not by a formula on the features.

**Operational demo data** — seeded rows anchored to the seed time (see DATABASE.md). Service estimates in the seed use the labelled planning table so the seed does not depend on the model.

## 2. Models (Predict)

| | Model 01 — service time | Model 02 — congestion risk |
|---|---|---|
| Algorithm | GradientBoostingRegressor (300 trees, depth 3) + quantile GBRs (P10/P90) | Standardised LogisticRegression + engineered load ratio |
| Split | 80/20 random, seed 20261108 | 75/25 stratified, seed 20261108 |
| Baseline | Mean service time per cargo type (as proposed in the WASL submission) | Empirical congestion frequency per load-ratio decile |
| Metrics (held-out) | MAE 8.44 min vs baseline 20.95; RMSE 12.54 vs 30.01; P10–P90 coverage 78.4 % | Brier 0.070 vs 0.121; ROC AUC 0.971 vs 0.907; precision 0.92 / recall 0.90 @0.5; calibration table stored |
| Policy | If a model does not beat its baseline on held-out data, the API serves the **baseline**, labelled `BASELINE:…` | Shown as "experimental"; never used to release trucks |

Label everywhere: *Synthetic Training Data — Experimental Model*. The model only *estimates*; it never issues releases and never bypasses safety constraints. Version, dataset description, training date and metrics are stored in `model_versions`.

## 3. Optimisation objective and constraints (Optimize)

Decision variables, constraints and objective are documented at the top of [`optimizer.py`](../services/intelligence/wasl_intel/optimizer.py). Summary:

* Variables: assigned `u_i`, dock `x_{i,d}` (compatible docks only), crew `y_{i,k}` (skill-eligible crews only), start `s_i`, yard arrival `arr_i = min(target_i, s_i)`.
* Hard constraints: one dock & one crew per assigned truck; `NoOverlap` per dock and per crew including **committed reservations** (released/in-service trucks are fixed); shift windows; `Cumulative` equipment capacity per type; `Cumulative` inspector capacity during the first `inspection_min` of service; `Cumulative` yard capacity over `[arr_i, s_i)`; `s_i ≥ ready_i` (travel time or 5 min from yard; at most 30 min earlier than the slot).
* Objective (minimise, "equivalent waiting minutes"): waiting (1.0/min × priority) + tardiness beyond a 15-min grace (3.0/min × priority) + moving a confirmed slot (0.2/min) + voluntary reassignment (15 per truck; not charged when the current dock is unusable) + makespan (0.5/min, proxy for resource idle time) + unassigned (1000 per truck). Priority factors: low 0.8, normal 1, high 1.5, critical 2.5.
* **These weights are an operating policy, not scientifically optimal values.** They are editable per run and per facility and stored with each run.
* Status reporting: OPTIMAL / FEASIBLE (with gap = |obj − bound| / obj) / INFEASIBLE / MODEL_INVALID / UNKNOWN (time limit without a solution). A greedy list-schedule warm start is supplied as a hint.
* Explanations are derived after solving from the solution and inputs (previous dock state, compatibility, crew skills, preceding interval on the dock, alternatives on other compatible docks) — no text generation.

## 4. Readiness rules (Verify)

13 checks with evidence source, result (PASS/FAIL/WARN/N/A), blocking flag, overridability and expected clear time ([`engine.ts`](../apps/api/src/domain/readiness/engine.ts), catalogue in [`readiness.ts`](../packages/shared/src/readiness.ts)). Aggregation: any failing blocking check whose consequence is reassignment → `REASSIGNMENT_REQUIRED`; else quality → `MANUAL_REVIEW_REQUIRED`; else `HOLD`; otherwise `READY`. Overridable by policy: documents, appointment confirmation, gate capacity. Never overridable: dock operational/compatible/free, crew, equipment, yard capacity, quality.

## 5. Simulation (Simulate)

[`simulation.py`](../services/intelligence/wasl_intel/simulation.py), version `wasl-sim-1.2.0`.

* **World**: N trucks with appointments (uniform over 85 % of the horizon, or 50 % concentrated in a 2-hour peak); physical arrival = appointment + Normal(μ, σ) lateness; cold cargo needs a reefer dock; true service time drawn from the ground-truth process; inspection with probability *q* needs an inspector at the dock; dock/crew failures at given times.
* **Common random numbers**: within replication *r* every policy faces the same world (seed + r); service times use a separate stream.
* **Policies**:
  * *FCFS* — gate-arrival order, any free compatible dock (reefer docks kept for cold cargo when possible), inspector requested at the dock.
  * *Fixed appointments* — round-robin dock per appointment order, no start before the slot, the dock serves its own sequence (skip a truck > 30 min late).
  * *OR only* — one CP-SAT plan at t = 0 with baseline (cargo-mean) durations; execution follows each dock's planned sequence, starting as soon as possible; no readiness gating, no re-planning.
  * *Full WASL* — CP-SAT plan with model-predicted durations; trucks are held at a staging decision point (`travelMin` before natural arrival) and called when their dock is predicted free within travel time + 10 min and a crew is available; the inspector is reserved at call time; rolling-horizon (4 h) re-optimisation on dock/crew failure and restoration and on large overruns (> 150 % of prediction, at most every 30 min).
* **Metrics**: on-site wait (gate → service start; mean, median, P95), *total delay* (natural arrival → service start, which includes off-site holding — reported so WASL's holding is not hidden), turnaround on site, time-average and max yard queue, yard overflow truck-minutes, dock utilisation (busy / available time), crew utilisation, quality response (dock arrival → inspection start), schedule changes, replans, makespan, throughput within the horizon.
* **Reproducibility**: each run stores parameters, seed, policy, simulator version, timestamp, full event log and metrics. `Re-run to verify` repeats a scenario and the UI compares results exactly (also asserted in the integration and pytest suites). Solver calls inside the simulator use `num_workers = 1` and a *deterministic* time limit so results are identical across runs.
* **Repetitions**: default 3 replications; summaries show mean ± 95 % CI (t-distribution).

## 6. KPI definitions (dashboard & reports)

| KPI | Definition |
|---|---|
| Scheduled today | Trucks whose confirmed (else requested) time falls in the facility's local day, excluding cancelled |
| Arrivals today | Trucks with `actual_arrival` today |
| Waiting | Trucks in `WAITING` or `ARRIVED` |
| In service | Trucks in `IN_SERVICE` |
| Available / occupied / out-of-service docks | Derived effective dock state: admin status down → OOS/maintenance; a truck in service → occupied; active reservation within 60 min → reserved |
| Avg waiting | Mean of `service_started_at − actual_arrival` over trucks served in the period (sample size shown) |
| Avg turnaround / P95 | `departed_at − actual_arrival` / 95th percentile of waiting |
| Dock utilisation | Σ service minutes on the dock within the period ÷ period length |
| Resource utilisation | Crew reservation minutes ÷ shift minutes within the period |
| Quality review rate | Shipments with a review created in the period ÷ trucks in the period |
| Schedule stability | 1 − reschedules ÷ (schedules + reschedules) |
| Bottleneck frequency | Count of failing blocking checks across non-READY readiness evaluations |
| Congestion risk | Model 02 probability for the next 2 h from live features |

## 7. Limitations

* Synthetic processes encode our own assumptions; the models learn those assumptions back. Real validation requires historical warehouse data.
* The simulator abstracts the yard, gate processing and dock moves; crews are homogeneous in the simulation (skills are modelled only in the live optimiser).
* Full WASL in the simulator pays a real cost for holding trucks off-site (travel latency, inspector reservation); in several scenarios FCFS achieves lower *total* delay — see [EXPERIMENTS.md](EXPERIMENTS.md). We report this rather than tuning it away.
* CP-SAT objective weights are policy choices; different weights produce different trade-offs.
* "Learn" is limited to recording estimate vs. actual; no retraining loop on operational data exists.
