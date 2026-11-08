"""
Discrete-event simulation of truck reception (SimPy).

World (identical across policies within a replication — common random numbers):
  * N trucks with appointment times; physical arrival = appointment + lateness ~ Normal(mu, sd)
  * cargo: cold (needs a reefer dock) with probability `coldShare`, otherwise general
  * true service time ~ LogNormal(groundtruth mean, cv) — unknown to planners
  * with probability `qualityProbability` a truck needs an inspection (inspector + `inspectionMin`) at the dock
  * dock / team failures at given times for given durations

Resources: docks (reefer subset), unloading teams (one per service), inspectors.
A service needs dock + team; an inspection (if needed) happens at the dock before unloading
and holds the dock and team while it runs.

Policies:
  FCFS               trucks served in gate-arrival order on any free compatible dock.
  FIXED_APPOINTMENTS round-robin dock per appointment order; no start before the slot;
                     dock serves its own sequence (skip a truck >30 min late).
  OR_ONLY            one CP-SAT plan at t=0 with baseline (cargo-mean) durations; execution follows the
                     planned dock sequence, starts as soon as possible; no readiness gating, no re-planning.
  FULL_WASL          CP-SAT plan with ML-predicted durations, readiness-gated calls from a staging area
                     (`travelMin` away), inspector pre-coordinated at call time, re-optimisation on
                     disruptions (failure/restore) and large overruns.

All randomness comes from numpy Generators seeded from (seed, replication, stream).
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import simpy

from . import groundtruth as gt
from . import ml
from .optimizer import solve

SIM_VERSION = "wasl-sim-1.2.0"
# WASL calls a truck when its dock is predicted free within travel time + this margin.
CALL_MARGIN_MIN = 10


@dataclass
class Truck:
    idx: int
    ref: str
    appt: float
    earliest: float
    cold: bool
    pallets: int
    handling: str
    vehicle: str
    true_service: float
    est_baseline: float
    est_model: float
    inspection: bool
    gate_arrival: float | None = None
    dock_arrival: float | None = None
    called_at: float | None = None
    start: float | None = None
    insp_start: float | None = None
    end: float | None = None
    dock: int | None = None
    planned_dock: int | None = None
    planned_start: float | None = None


@dataclass
class Dock:
    idx: int
    reefer: bool
    up: bool = True
    busy: bool = False
    reserved_by: int | None = None
    busy_time: float = 0.0
    down_time: float = 0.0
    pred_free: float = 0.0


@dataclass
class World:
    trucks: list[Truck]
    docks: list[Dock]
    n_teams: int
    events: list[dict] = field(default_factory=list)


def build_world(params: dict, seed: int) -> World:
    rng = np.random.default_rng(seed)
    n = params["nTrucks"]
    dur = params["durationMin"]
    arr = params["arrival"]
    if arr["pattern"] == "PEAKED_APPOINTMENTS":
        k = n // 2
        base = np.linspace(0, dur * 0.85, n - k)
        peak = rng.uniform(dur * 0.3, dur * 0.3 + 120, size=k)
        appts = np.sort(np.concatenate([base, peak]))
    else:
        appts = np.sort(np.linspace(0, dur * 0.85, n) + rng.uniform(-5, 5, size=n))
    appts = np.clip(appts, 0, None)
    lateness = rng.normal(arr["latenessMeanMin"], arr["latenessSdMin"], size=n)
    svc_rng = np.random.default_rng(seed + 7919)
    model = ml.registry.get("service_time")
    trucks = []
    for i in range(n):
        cold = bool(rng.random() < params["coldShare"])
        cargo = str(rng.choice(["CHILLED", "FROZEN"])) if cold else str(rng.choice(["GENERAL", "BULK", "FRAGILE"], p=[0.7, 0.2, 0.1]))
        handling = str(rng.choice(["FORKLIFT_PALLET", "PALLET_JACK"], p=[0.75, 0.25]))
        vehicle = "REEFER_TRAILER" if cold else str(rng.choice(["RIGID", "ARTICULATED"], p=[0.4, 0.6]))
        pallets = int(rng.integers(6, 31))
        inspection = bool(rng.random() < params["qualityProbability"])
        mean = gt.mean_service_minutes(cargo, pallets, handling, vehicle, 4, True, False)
        if params["service"]["distribution"] == "TRIANGULAR":
            true = float(svc_rng.triangular(0.7 * mean, mean, mean * (1 + 2 * params["service"]["cv"])))
        else:
            true = gt.sample_lognormal(svc_rng, mean, params["service"]["cv"])
        feats = {"cargo_type": cargo, "pallet_count": pallets, "handling_method": handling, "vehicle_type": vehicle, "team_size": 4, "dock_has_leveler": True, "inspection_required": False}
        if model is not None:
            art, _meta = model
            est_base = float(art["cargo_mean"].get(cargo, art["global_mean"]))
            try:
                est_model = ml.predict_service(feats)["minutes"]
            except Exception:
                est_model = est_base
        else:
            est_base = est_model = mean  # no trained model: both planners use the same estimate
        trucks.append(Truck(i, f"T{i + 1:03d}", float(appts[i]), max(0.0, float(appts[i] + lateness[i])), cold, pallets, handling, vehicle, true, est_base, est_model, inspection))
    n_reefer = min(params["nReeferDocks"], params["nDocks"])
    docks = [Dock(d, reefer=d < n_reefer) for d in range(params["nDocks"])]
    return World(trucks, docks, params["nTeams"])


def compatible(t: Truck, d: Dock) -> bool:
    return d.reefer if t.cold else True


def plan_with_cpsat(world: World, trucks: list[Truck], now: float, params: dict, use_model: bool, team_free: int, horizon: float, seed: int, det_time: float = 0.5) -> dict[int, tuple[int, float]]:
    """Returns truck idx -> (dock idx, planned start). Uses the same CP-SAT model as live optimisation."""
    if not trucks:
        return {}
    docks = [{"id": str(d.idx), "down": not d.up} for d in world.docks]
    fixed = []
    for d in world.docks:
        if (d.busy or d.reserved_by is not None) and d.up:
            fixed.append({"truck_id": f"busy{d.idx}", "dock_id": str(d.idx), "team_id": "pool" if d.busy else None, "start": 0, "end": max(1, int(math.ceil(d.pred_free - now)))})
    tlist = []
    for t in trucks:
        est = t.est_model if use_model else t.est_baseline
        svc = int(round(est + (params["inspectionMin"] if t.inspection and use_model else 0)))
        ready = max(0, int(round((t.gate_arrival if t.gate_arrival is not None else max(t.appt, now)) - now)))
        tlist.append({
            "id": str(t.idx),
            "service_min": max(5, svc),
            "ready_min": ready,
            "target_min": max(0, int(round(t.appt - now))),
            "on_site": t.gate_arrival is not None,
            "compatible_docks": [str(d.idx) for d in world.docks if compatible(t, d) and d.up],
            "eligible_teams": [],
            "needs_inspection": bool(t.inspection and use_model),
            "priority_weight": 1.0,
            "current_dock_id": str(t.planned_dock) if t.planned_dock is not None else None,
            "current_start": None,
        })
    payload = {
        "horizon_min": int(horizon),
        "time_limit_sec": det_time,
        "allow_unassigned": True,
        "weights": {"waitingPerMin": 1, "tardinessPerMin": 3, "disruptionPerMin": 0.0, "reassignment": 5 if use_model else 0, "makespanPerMin": 0.5, "unassigned": 1000},
        "inspectors": params["nInspectors"],
        "inspection_min": params["inspectionMin"],
        "yard_capacity": None,
        "docks": docks,
        "teams": [],
        "team_pool_capacity": max(1, team_free),
        "equipment_capacity": {},
        "fixed": fixed,
        "trucks": tlist,
        "seed": seed,
    }
    res = solve(payload, deterministic=True)
    out = {}
    for a in res["assignments"]:
        if a["assigned"]:
            out[int(a["truck_id"])] = (int(a["dock_id"]), now + a["start"])
    return out


def run(params: dict, policy: str, seed: int) -> dict[str, Any]:
    wall = time.perf_counter()
    world = build_world(params, seed)
    env = simpy.Environment()
    trucks, docks = world.trucks, world.docks
    teams = {"free": params["nTeams"], "down": 0, "busy_time": 0.0}
    inspectors = simpy.Resource(env, capacity=max(1, params["nInspectors"])) if params["nInspectors"] > 0 else None
    insp_reserved = {"n": 0}
    yard: list[Truck] = []  # on site, waiting for a dock
    staging: list[Truck] = []  # WASL: near the facility, not yet called
    state = {"yard_area": 0.0, "yard_last_t": 0.0, "yard_max": 0, "changes": 0, "replans": 0, "team_area": 0.0, "team_last": 0.0, "yard_overflow_area": 0.0}
    log = world.events
    use_model = policy == "FULL_WASL"
    travel = params["travelMin"]
    horizon_cap = params["durationMin"] * 3

    def ev(kind: str, t: Truck | None = None, dock: int | None = None, **payload):
        log.append({"t": round(env.now, 2), "type": kind, "truck": t.ref if t else None, "dock": f"D{dock + 1}" if dock is not None else None, **({"payload": payload} if payload else {})})

    def yard_update():
        dt = env.now - state["yard_last_t"]
        state["yard_area"] += len(yard) * dt
        state["yard_overflow_area"] += max(0, len(yard) - params["yardCapacity"]) * dt
        state["yard_last_t"] = env.now
        state["yard_max"] = max(state["yard_max"], len(yard))

    def team_update():
        dt = env.now - state["team_last"]
        state["team_area"] += (params["nTeams"] - teams["down"] - teams["free"]) * dt
        state["team_last"] = env.now

    # --- static plans ---
    plan: dict[int, tuple[int, float]] = {}
    if policy == "FIXED_APPOINTMENTS":
        order = sorted(trucks, key=lambda t: t.appt)
        rr = {True: 0, False: 0}
        for t in order:
            comp = [d for d in docks if compatible(t, d) and (t.cold or not d.reefer)] or [d for d in docks if compatible(t, d)]
            if not comp:
                continue
            d = comp[rr[t.cold] % len(comp)]
            rr[t.cold] += 1
            plan[t.idx] = (d.idx, t.appt)
    elif policy in ("OR_ONLY", "FULL_WASL"):
        plan = plan_with_cpsat(world, trucks, 0.0, params, use_model, params["nTeams"], params["durationMin"] * 2, seed, det_time=1.5)
    for t in trucks:
        if t.idx in plan:
            t.planned_dock, t.planned_start = plan[t.idx]
    if policy != "FCFS":
        # Trucks the plan could not place are appended to the least-loaded compatible dock.
        load = {d.idx: sum(x.est_baseline for x in trucks if x.planned_dock == d.idx) for d in docks}
        for t in sorted(trucks, key=lambda x: x.appt):
            if t.planned_dock is None:
                comp = [d for d in docks if compatible(t, d)]
                if comp:
                    d = min(comp, key=lambda d: load[d.idx])
                    t.planned_dock, t.planned_start = d.idx, max(t.appt, max([x.planned_start or 0 for x in trucks if x.planned_dock == d.idx], default=0) + 1)
                    load[d.idx] += t.est_baseline

    def dock_sequence(d: Dock, pool: list[Truck]) -> list[Truck]:
        return sorted([t for t in pool if t.planned_dock == d.idx], key=lambda t: t.planned_start or 0)

    # --- service process ---
    def serve(t: Truck, d: Dock, pre_coordinated: bool):
        # dock/team were claimed synchronously in start_service()
        if t.inspection:
            if pre_coordinated:
                t.insp_start = env.now
                ev("QUALITY_REVIEW", t, d.idx, preCoordinated=True)
                yield env.timeout(params["inspectionMin"])
                insp_reserved["n"] -= 1
            elif inspectors is not None:
                with inspectors.request() as req:
                    yield req
                    t.insp_start = env.now
                    ev("QUALITY_REVIEW", t, d.idx, preCoordinated=False)
                    yield env.timeout(params["inspectionMin"])
        yield env.timeout(t.true_service)
        t.end = env.now
        d.busy_time += t.end - t.start
        d.busy = False
        team_update()
        teams["free"] += 1
        ev("SERVICE_COMPLETE", t, d.idx)
        ev("DEPARTURE", t, d.idx)
        if use_model:
            predicted = t.est_model + (params["inspectionMin"] if t.inspection else 0)
            if t.true_service + (params["inspectionMin"] if t.inspection else 0) > predicted * 1.5 and env.now - state.get("last_overrun_replan", -1e9) >= 30:
                state["last_overrun_replan"] = env.now
                replan("SERVICE_OVERRUN")
        dispatch()

    # --- selection rules ---
    def free_docks():
        return [d for d in docks if d.up and not d.busy and d.reserved_by is None]

    def start_service(t: Truck, d: Dock, pre=False):
        # Claim resources synchronously: a SimPy process only runs when the scheduler reaches it,
        # so deferring this would let the same dispatch loop seat two trucks on one dock.
        team_update()
        teams["free"] -= 1
        d.busy = True
        d.reserved_by = None
        t.dock = d.idx
        t.dock_arrival = env.now
        if t in yard:
            yard_update()
            yard.remove(t)
        t.start = env.now
        d.pred_free = env.now + (t.est_model if use_model else t.est_baseline) + (params["inspectionMin"] if t.inspection else 0)
        ev("SERVICE_START", t, d.idx, waited=round(t.start - (t.gate_arrival or t.start), 1))
        env.process(serve(t, d, pre))

    def dispatch():
        if policy == "FCFS":
            for t in sorted(list(yard), key=lambda x: x.gate_arrival):
                if teams["free"] <= 0:
                    break
                fd = [d for d in free_docks() if compatible(t, d)]
                if not fd:
                    continue
                fd.sort(key=lambda d: d.reefer)  # keep reefer docks for cold cargo when possible
                start_service(t, fd[0])
        elif policy in ("FIXED_APPOINTMENTS", "OR_ONLY"):
            pairs = []
            for d in free_docks():
                seq = [t for t in dock_sequence(d, trucks) if t.start is None]
                for t in seq:
                    if t not in yard:
                        # next planned truck not here yet: the dock waits unless that truck is >30 min late
                        ref = t.appt if policy == "FIXED_APPOINTMENTS" else (t.planned_start or 0)
                        if env.now - ref <= 30:
                            break
                        continue
                    if policy == "FIXED_APPOINTMENTS" and env.now < t.appt:
                        break
                    pairs.append((t.planned_start or t.appt, t, d))
                    break
            for _, t, d in sorted(pairs, key=lambda x: x[0]):
                if teams["free"] <= 0:
                    break
                start_service(t, d)
        else:  # FULL_WASL — readiness-gated calls
            # 1) trucks already on site go first to reserved docks
            for t in list(yard):
                d = docks[t.planned_dock] if t.planned_dock is not None else None
                if d and d.reserved_by == t.idx and d.up and not d.busy and teams["free"] > 0:
                    start_service(t, d, pre=True)
            # 2) call trucks from staging when their dock is (predicted to be) ready within travel time
            for d in docks:
                if not d.up or d.reserved_by is not None:
                    continue
                if d.busy and d.pred_free - env.now > travel + CALL_MARGIN_MIN:
                    continue
                busy_soon = sum(1 for x in docks if x.busy and x.pred_free - env.now <= travel + CALL_MARGIN_MIN)
                if teams["free"] + busy_soon - sum(1 for x in docks if x.reserved_by is not None) <= 0:
                    continue
                cands = [t for t in dock_sequence(d, staging)] or [t for t in sorted(staging, key=lambda x: x.planned_start or x.appt) if compatible(t, d)]
                for t in cands:
                    if t.inspection:
                        if inspectors is None or insp_reserved["n"] >= params["nInspectors"]:
                            continue
                        insp_reserved["n"] += 1
                    staging.remove(t)
                    d.reserved_by = t.idx
                    if t.planned_dock != d.idx:
                        state["changes"] += 1 if t.planned_dock is not None else 0
                        t.planned_dock = d.idx
                    t.called_at = env.now
                    ev("TRUCK_CALLED", t, d.idx)
                    env.process(travel_in(t))
                    break

    def travel_in(t: Truck):
        yield env.timeout(max(travel, t.earliest - env.now))
        gate_in(t)

    def gate_in(t: Truck):
        yard_update()
        t.gate_arrival = env.now
        ev("ARRIVAL", t)
        ev("GATE_ADMISSION", t)
        yard.append(t)
        ev("QUEUE_ENTRY", t, payload_q=len(yard))
        dispatch()

    def truck_proc(t: Truck):
        # WASL's call decision point is `travel` minutes before the truck would reach the gate.
        yield env.timeout(max(0.0, t.earliest - travel) if policy == "FULL_WASL" else t.earliest)
        if policy == "FULL_WASL":
            staging.append(t)
            ev("STAGING", t)
            dispatch()
        else:
            gate_in(t)

    def replan(reason: str):
        if policy != "FULL_WASL":
            return
        # Rolling horizon: staged trucks + trucks expected within the next 4 hours.
        pending = [t for t in staging] + [t for t in trucks if t.start is None and t not in staging and t not in yard and t.called_at is None and t.appt <= env.now + 240]
        if not pending:
            return
        before = {t.idx: t.planned_dock for t in pending}
        free_teams = max(1, teams["free"] + sum(1 for d in docks if d.busy))
        newplan = plan_with_cpsat(world, pending, env.now, params, True, free_teams, params["durationMin"] * 2, seed + state["replans"] + 1)
        state["replans"] += 1
        changed = 0
        for t in pending:
            if t.idx in newplan:
                t.planned_dock, t.planned_start = newplan[t.idx]
                if before[t.idx] is not None and before[t.idx] != t.planned_dock:
                    changed += 1
        state["changes"] += changed
        ev("REPLAN", None, None, reason=reason, changed=changed)

    def failure(f: dict):
        yield env.timeout(f["atMin"])
        if f["kind"] == "DOCK" and f["index"] < len(docks):
            d = docks[f["index"]]
            d.up = False
            ev("DOCK_FAILURE", None, d.idx, durationMin=f["durationMin"])
            if d.reserved_by is not None:
                # reserved truck must be re-routed
                t = trucks[d.reserved_by]
                d.reserved_by = None
                t.planned_dock = None
            replan("DOCK_FAILURE")
            dispatch()
            t0 = env.now
            yield env.timeout(f["durationMin"])
            d.up = True
            d.down_time += env.now - t0
            ev("DOCK_RESTORED", None, d.idx)
            replan("DOCK_RESTORED")
            dispatch()
        elif f["kind"] == "TEAM":
            # one team becomes unavailable (waits for it to finish current work)
            while teams["free"] <= 0:
                yield env.timeout(1)
            team_update()
            teams["free"] -= 1
            teams["down"] += 1
            ev("RESOURCE_FAILURE", None, None, resource="TEAM", index=f["index"], durationMin=f["durationMin"])
            replan("TEAM_SHORTAGE")
            yield env.timeout(f["durationMin"])
            team_update()
            teams["free"] += 1
            teams["down"] -= 1
            ev("RESOURCE_RESTORED", None, None, resource="TEAM", index=f["index"])
            replan("TEAM_RESTORED")
            dispatch()

    # yard reassignment for WASL when a reserved dock failed while truck was travelling
    def watchdog():
        while True:
            yield env.timeout(5)
            if policy == "FULL_WASL":
                for t in list(yard):
                    if t.start is None and (t.planned_dock is None or docks[t.planned_dock].reserved_by != t.idx):
                        fd = [d for d in free_docks() if compatible(t, d)]
                        if fd and teams["free"] > 0:
                            fd[0].reserved_by = t.idx
                            t.planned_dock = fd[0].idx
                            state["changes"] += 1
            dispatch()
            if all(t.end is not None for t in trucks) or env.now > horizon_cap:
                return

    for t in trucks:
        env.process(truck_proc(t))
    for f in params.get("failures", []):
        env.process(failure(f))
    done = env.process(watchdog())
    env.run(until=done)
    yard_update()
    team_update()
    T_end = env.now

    served = [t for t in trucks if t.end is not None]
    waits = np.array([t.start - t.gate_arrival for t in served]) if served else np.array([0.0])
    delays = np.array([t.start - t.earliest for t in served]) if served else np.array([0.0])
    tat = np.array([t.end - t.gate_arrival for t in served]) if served else np.array([0.0])
    vs_appt = np.array([max(0.0, t.start - t.appt) for t in served]) if served else np.array([0.0])
    insp = [t for t in served if t.inspection and t.insp_start is not None]
    q_resp = np.array([t.insp_start - t.dock_arrival for t in insp]) if insp else np.array([])
    avail_dock_time = sum(T_end - d.down_time for d in docks)
    metrics = {
        "trucks": len(trucks),
        "served": len(served),
        "served_within_duration": int(sum(1 for t in served if t.end <= params["durationMin"])),
        "avg_wait_min": float(waits.mean()),
        "median_wait_min": float(np.median(waits)),
        "p95_wait_min": float(np.percentile(waits, 95)),
        "avg_total_delay_min": float(delays.mean()),
        "avg_lateness_vs_appointment_min": float(vs_appt.mean()),
        "avg_turnaround_min": float(tat.mean()),
        "avg_queue_length": state["yard_area"] / T_end if T_end > 0 else 0.0,
        "max_queue_length": int(state["yard_max"]),
        "yard_overflow_truck_min": state["yard_overflow_area"],
        "dock_utilization": sum(d.busy_time for d in docks) / avail_dock_time if avail_dock_time > 0 else 0.0,
        "team_utilization": state["team_area"] / (params["nTeams"] * T_end) if T_end > 0 else 0.0,
        "avg_quality_response_min": float(q_resp.mean()) if len(q_resp) else 0.0,
        "inspections": len(insp),
        "schedule_changes": int(state["changes"]),
        "replans": int(state["replans"]),
        "makespan_min": float(T_end),
    }
    # queue time-series (5-min sampling) for charts
    series = []
    pts = sorted(((e["t"], e["type"]) for e in log if e["type"] in ("QUEUE_ENTRY", "SERVICE_START")))
    q = 0
    idx = 0
    for tt in range(0, int(T_end) + 5, 5):
        while idx < len(pts) and pts[idx][0] <= tt:
            q += 1 if pts[idx][1] == "QUEUE_ENTRY" else -1 if q > 0 else 0
            idx += 1
        series.append({"t": tt, "queue": max(0, q)})
    return {
        "policy": policy,
        "seed": seed,
        "sim_version": SIM_VERSION,
        "metrics": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in metrics.items()},
        "timeseries": {"queue": series, "waits": [round(float(w), 1) for w in waits]},
        "events": log,
        "runtime_ms": int((time.perf_counter() - wall) * 1000),
        "model_used": "MODEL" if (use_model and ml.registry.get("service_time")) else "BASELINE",
    }
