"""
Truck-to-dock scheduling with Google OR-Tools CP-SAT.

Decision variables (per plannable truck i):
  u_i          assigned (bool) — forced to 1 when allow_unassigned is False
  x_{i,d}      truck i served at dock d (bool, only for compatible docks)
  y_{i,k}      truck i served by team k (bool, only for skill-eligible teams)
  s_i          service start (minutes from t0), e_i = s_i + p_i
  arr_i        expected yard arrival = min(target_i, s_i) for off-site trucks, 0 for on-site trucks

Hard constraints:
  * exactly one dock and one team when assigned (sum x = u, sum y = u)
  * NoOverlap per dock and per team, including committed (fixed) work
  * team shift windows
  * cumulative equipment capacity per equipment type
  * cumulative inspector capacity for trucks that need a quality inspection
  * cumulative yard capacity over the waiting intervals [arr_i, s_i)
  * s_i >= ready_i (earliest moment the truck can be at the dock)

Objective (minimise, all terms in "equivalent minutes", see docs/METHODOLOGY.md):
  w_wait * prio_i * (s_i - arr_i)                      on-site waiting
+ w_tardy * prio_i * max(0, s_i - target_i - grace)    lateness vs. requested/confirmed slot
+ w_disr * |s_i - current_start_i|                      schedule disruption (trucks with a confirmed slot)
+ w_reassign * [dock changed]                           voluntary reassignment (not counted if current dock is unusable)
+ w_makespan * max_i e_i                                 proxy for dock idle time / end of day
+ w_unassigned * (1 - u_i)
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model
import ortools

SCALE = 10  # objective weights are scaled to integers (0.1-minute resolution)

STATUS = {
    cp_model.OPTIMAL: "OPTIMAL",
    cp_model.FEASIBLE: "FEASIBLE",
    cp_model.INFEASIBLE: "INFEASIBLE",
    cp_model.MODEL_INVALID: "MODEL_INVALID",
    cp_model.UNKNOWN: "UNKNOWN",
}


@dataclass
class Weights:
    waitingPerMin: float = 1.0
    tardinessPerMin: float = 3.0
    disruptionPerMin: float = 0.2
    reassignment: float = 15.0
    makespanPerMin: float = 0.5
    unassigned: float = 1000.0


def _w(v: float) -> int:
    return int(round(v * SCALE))


def solve(payload: dict[str, Any], deterministic: bool = False) -> dict[str, Any]:
    t_start = time.perf_counter()
    H = int(payload["horizon_min"])
    trucks = payload["trucks"]
    fixed = payload.get("fixed", [])
    docks = {d["id"]: d for d in payload["docks"]}
    teams = {t["id"]: t for t in payload["teams"]}
    eq_cap: dict[str, int] = payload.get("equipment_capacity", {})
    inspectors = int(payload.get("inspectors", 0))
    insp_min = int(payload.get("inspection_min", 20))
    yard_cap = payload.get("yard_capacity")
    grace = int(payload.get("tardiness_grace_min", 15))
    allow_unassigned = bool(payload.get("allow_unassigned", True))
    team_pool = payload.get("team_pool_capacity")  # simulation mode: identical teams as one cumulative pool
    w = Weights(**payload.get("weights", {}))

    fixed_end = max([f["end"] for f in fixed], default=0)
    # Horizon must cover committed work plus everything that could be scheduled sequentially.
    UB = max(H, fixed_end) + sum(int(t["service_min"]) for t in trucks) + 60

    m = cp_model.CpModel()
    u, s, e, arr, x, y = {}, {}, {}, {}, {}, {}
    dock_iv: dict[str, list] = {d: [] for d in docks}
    team_iv: dict[str, list] = {k: [] for k in teams}
    pool_iv: list = []
    eq_iv: dict[str, list] = {}
    eq_dem: dict[str, list] = {}
    insp_iv: list = []
    yard_iv: list = []
    obj_terms: list = []
    terms: dict[str, list] = {k: [] for k in ["waiting", "tardiness", "disruption", "reassignment", "makespan", "unassigned"]}
    forced_unassigned: dict[str, str] = {}

    # Fixed (committed) work occupies docks / teams / equipment
    for f in fixed:
        st, en = int(f["start"]), max(int(f["end"]), int(f["start"]) + 1)
        if f.get("dock_id") in dock_iv:
            dock_iv[f["dock_id"]].append(m.NewIntervalVar(st, en - st, en, f"fx_d_{f['truck_id']}"))
        if f.get("team_id") in team_iv:
            team_iv[f["team_id"]].append(m.NewIntervalVar(st, en - st, en, f"fx_t_{f['truck_id']}"))
        if team_pool is not None and f.get("team_id"):
            pool_iv.append(m.NewIntervalVar(st, en - st, en, f"fx_p_{f['truck_id']}"))
        if f.get("equipment_type"):
            eq_iv.setdefault(f["equipment_type"], []).append(m.NewIntervalVar(st, en - st, en, f"fx_e_{f['truck_id']}"))
            eq_dem.setdefault(f["equipment_type"], []).append(1)

    makespan = m.NewIntVar(0, UB, "makespan")
    m.Add(makespan >= fixed_end)

    for t in trucks:
        i = t["id"]
        p = int(t["service_min"])
        ready = max(0, int(t["ready_min"]))
        target = int(t["target_min"])
        comp = [d for d in t["compatible_docks"] if d in docks and not docks[d].get("down")]
        elig = [k for k in t.get("eligible_teams", []) if k in teams and teams[k].get("available", True)]
        eqt = t.get("equipment_type")
        reason = None
        if not comp:
            reason = "NO_COMPATIBLE_DOCK"
        elif team_pool is None and not elig:
            reason = "NO_ELIGIBLE_TEAM"
        elif eqt and eq_cap.get(eqt, 0) <= 0:
            reason = "NO_EQUIPMENT"
        elif t.get("needs_inspection") and inspectors <= 0:
            reason = "NO_INSPECTOR"

        u[i] = m.NewBoolVar(f"u_{i}")
        if reason:
            forced_unassigned[i] = reason
            m.Add(u[i] == 0)
        if not allow_unassigned:
            # Hard requirement: every truck must be placed (makes the model INFEASIBLE if impossible).
            m.Add(u[i] == 1)

        s[i] = m.NewIntVar(ready, UB, f"s_{i}")
        e[i] = m.NewIntVar(ready + p, UB + p, f"e_{i}")
        m.Add(e[i] == s[i] + p)

        # dock choice
        xs = []
        for d in comp:
            b = m.NewBoolVar(f"x_{i}_{d}")
            x[(i, d)] = b
            xs.append(b)
            dock_iv[d].append(m.NewOptionalIntervalVar(s[i], p, e[i], b, f"iv_d_{i}_{d}"))
        m.Add(sum(xs) == u[i]) if xs else m.Add(u[i] == 0)

        # team choice
        if team_pool is not None:
            pool_iv.append(m.NewOptionalIntervalVar(s[i], p, e[i], u[i], f"iv_p_{i}"))
        else:
            ys = []
            for k in elig:
                b = m.NewBoolVar(f"y_{i}_{k}")
                y[(i, k)] = b
                ys.append(b)
                team_iv[k].append(m.NewOptionalIntervalVar(s[i], p, e[i], b, f"iv_t_{i}_{k}"))
                m.Add(s[i] >= int(teams[k]["shift_start"])).OnlyEnforceIf(b)
                m.Add(e[i] <= int(teams[k]["shift_end"])).OnlyEnforceIf(b)
            m.Add(sum(ys) == u[i]) if ys else m.Add(u[i] == 0)

        if eqt:
            eq_iv.setdefault(eqt, []).append(m.NewOptionalIntervalVar(s[i], p, e[i], u[i], f"iv_e_{i}"))
            eq_dem.setdefault(eqt, []).append(1)
        if t.get("needs_inspection"):
            ie = m.NewIntVar(0, UB + insp_min, f"ie_{i}")
            m.Add(ie == s[i] + insp_min)
            insp_iv.append(m.NewOptionalIntervalVar(s[i], insp_min, ie, u[i], f"iv_q_{i}"))

        # yard waiting interval [arr_i, s_i)
        arr[i] = m.NewIntVar(0, UB, f"arr_{i}")
        if t.get("on_site"):
            m.Add(arr[i] == 0)
        else:
            m.AddMinEquality(arr[i], [s[i], m.NewConstant(max(0, target))])
        wait = m.NewIntVar(0, UB, f"wait_{i}")
        m.Add(wait == s[i] - arr[i])
        if yard_cap is not None:
            yard_iv.append(m.NewOptionalIntervalVar(arr[i], wait, s[i], u[i], f"iv_y_{i}"))

        prio = float(t.get("priority_weight", 1.0))
        wt = m.NewIntVar(0, UB, f"wt_{i}")  # waiting counted only if assigned
        m.Add(wt == wait).OnlyEnforceIf(u[i])
        m.Add(wt == 0).OnlyEnforceIf(u[i].Not())
        tard = m.NewIntVar(0, UB, f"tard_{i}")
        m.Add(tard >= s[i] - target - grace)
        tz = m.NewIntVar(0, UB, f"tz_{i}")
        m.Add(tz == tard).OnlyEnforceIf(u[i])
        m.Add(tz == 0).OnlyEnforceIf(u[i].Not())
        obj_terms += [_w(w.waitingPerMin * prio) * wt, _w(w.tardinessPerMin * prio) * tz]
        terms["waiting"].append((wt, w.waitingPerMin * prio))
        terms["tardiness"].append((tz, w.tardinessPerMin * prio))

        if t.get("current_start") is not None:
            dev = m.NewIntVar(0, 2 * UB, f"dev_{i}")
            m.AddAbsEquality(dev, s[i] - int(t["current_start"]))
            devu = m.NewIntVar(0, 2 * UB, f"devu_{i}")
            m.Add(devu == dev).OnlyEnforceIf(u[i])
            m.Add(devu == 0).OnlyEnforceIf(u[i].Not())
            obj_terms.append(_w(w.disruptionPerMin) * devu)
            terms["disruption"].append((devu, w.disruptionPerMin))
        cur = t.get("current_dock_id")
        if cur and (i, cur) in x:
            ch = m.NewBoolVar(f"ch_{i}")
            m.Add(ch == u[i] - x[(i, cur)])
            obj_terms.append(_w(w.reassignment) * ch)
            terms["reassignment"].append((ch, w.reassignment))

        m.Add(makespan >= e[i]).OnlyEnforceIf(u[i])
        un = u[i].Not()
        obj_terms.append(_w(w.unassigned) * un)
        terms["unassigned"].append((un, w.unassigned))

    for d, ivs in dock_iv.items():
        if len(ivs) > 1:
            m.AddNoOverlap(ivs)
    for k, ivs in team_iv.items():
        if len(ivs) > 1:
            m.AddNoOverlap(ivs)
    if team_pool is not None and pool_iv:
        m.AddCumulative(pool_iv, [1] * len(pool_iv), int(team_pool))
    for typ, ivs in eq_iv.items():
        m.AddCumulative(ivs, eq_dem[typ], max(0, int(eq_cap.get(typ, 0))))
    if insp_iv:
        m.AddCumulative(insp_iv, [1] * len(insp_iv), max(0, inspectors))
    if yard_cap is not None and yard_iv:
        m.AddCumulative(yard_iv, [1] * len(yard_iv), max(0, int(yard_cap)))

    # Greedy warm start (earliest-ready first, earliest feasible dock/team) as a solution hint.
    _add_greedy_hint(m, trucks, fixed, docks, teams, team_pool, s, x, y, u, forced_unassigned)

    obj_terms.append(_w(w.makespanPerMin) * makespan)
    terms["makespan"].append((makespan, w.makespanPerMin))
    m.Minimize(sum(obj_terms))

    solver = cp_model.CpSolver()
    tl = float(payload.get("time_limit_sec", 10))
    if deterministic:
        solver.parameters.num_workers = 1
        solver.parameters.max_deterministic_time = tl
    else:
        solver.parameters.num_workers = 8
        solver.parameters.max_time_in_seconds = tl
    solver.parameters.random_seed = int(payload.get("seed", 0))
    code = solver.Solve(m)
    status = STATUS.get(code, "UNKNOWN")
    runtime_ms = int((time.perf_counter() - t_start) * 1000)

    stats = m.Proto()
    constraint_summary = {
        "trucks": len(trucks),
        "docks": len(docks),
        "teams": len(teams) if team_pool is None else int(team_pool),
        "fixed_commitments": len(fixed),
        "variables": len(stats.variables),
        "constraints": len(stats.constraints),
        "families": [
            "one_dock_per_assigned_truck",
            "one_team_per_assigned_truck" if team_pool is None else "team_pool_cumulative",
            "no_overlap_per_dock",
            "no_overlap_per_team" if team_pool is None else "team_pool_capacity",
            "team_shift_windows" if team_pool is None else None,
            "equipment_capacity",
            "inspector_capacity",
            "yard_capacity" if yard_cap is not None else None,
            "earliest_readiness",
        ],
        "forced_unassigned": forced_unassigned,
        "wall_time_s": solver.WallTime(),
        "branches": solver.NumBranches(),
        "conflicts": solver.NumConflicts(),
    }
    constraint_summary["families"] = [f for f in constraint_summary["families"] if f]

    result: dict[str, Any] = {
        "status": status,
        "objective": None,
        "best_bound": None,
        "runtime_ms": runtime_ms,
        "solver_version": f"ortools-{ortools.__version__}/cp-sat",
        "assignments": [],
        "breakdown": {},
        "current_breakdown": current_plan_breakdown(payload),
        "constraint_summary": constraint_summary,
    }
    if status not in ("OPTIMAL", "FEASIBLE"):
        result["message"] = {
            "INFEASIBLE": "No plan satisfies all hard constraints (try allowing unassigned trucks or check capacities).",
            "UNKNOWN": "Solver hit the time limit before finding a feasible plan.",
            "MODEL_INVALID": "Model invalid — please report.",
        }.get(status, status)
        return result

    result["objective"] = solver.ObjectiveValue() / SCALE
    result["best_bound"] = solver.BestObjectiveBound() / SCALE
    result["gap"] = (abs(result["objective"] - result["best_bound"]) / max(1e-9, abs(result["objective"]))) if result["objective"] else 0.0
    bd = {k: 0.0 for k in terms}
    for k, lst in terms.items():
        for var, wt in lst:
            bd[k] += solver.Value(var) * wt
    bd["waiting_minutes"] = sum(solver.Value(v) for v, _ in terms["waiting"])
    bd["tardiness_minutes"] = sum(solver.Value(v) for v, _ in terms["tardiness"])
    bd["reassignments"] = sum(solver.Value(v) for v, _ in terms["reassignment"])
    bd["unassigned_count"] = sum(solver.Value(v) for v, _ in terms["unassigned"])
    bd["makespan_min"] = solver.Value(makespan)
    result["breakdown"] = {k: round(v, 2) for k, v in bd.items()}

    for t in trucks:
        i = t["id"]
        if solver.Value(u[i]):
            dock = next((d for d in t["compatible_docks"] if (i, d) in x and solver.Value(x[(i, d)])), None)
            team = next((k for k in t.get("eligible_teams", []) if (i, k) in y and solver.Value(y[(i, k)])), None)
            st = solver.Value(s[i])
            result["assignments"].append(
                {
                    "truck_id": i,
                    "assigned": True,
                    "dock_id": dock,
                    "team_id": team,
                    "start": st,
                    "end": st + int(t["service_min"]),
                    "waiting": st - solver.Value(arr[i]),
                    "tardiness": max(0, st - int(t["target_min"]) - grace),
                }
            )
        else:
            result["assignments"].append({"truck_id": i, "assigned": False, "dock_id": None, "team_id": None, "start": None, "end": None, "waiting": None, "tardiness": None, "reason": forced_unassigned.get(i, "CAPACITY")})
    return result


def current_plan_breakdown(payload: dict[str, Any]) -> dict[str, float]:
    """Evaluates the CURRENT plan (existing dock + confirmed start) with the same objective terms, and counts its conflicts."""
    w = Weights(**payload.get("weights", {}))
    grace = int(payload.get("tardiness_grace_min", 15))
    docks = {d["id"]: d for d in payload["docks"]}
    waiting = tard = 0.0
    wmin = tmin = 0
    unassigned = 0
    conflicts = 0
    ends = [f["end"] for f in payload.get("fixed", [])]
    per_dock: dict[str, list[tuple[int, int]]] = {}
    for f in payload.get("fixed", []):
        if f.get("dock_id"):
            per_dock.setdefault(f["dock_id"], []).append((f["start"], f["end"]))
    for t in payload["trucks"]:
        cd, cs = t.get("current_dock_id"), t.get("current_start")
        if not cd or cs is None:
            unassigned += 1
            continue
        p = int(t["service_min"])
        start = max(int(cs), int(t["ready_min"]))
        if cd not in t["compatible_docks"] or docks.get(cd, {}).get("down"):
            conflicts += 1
        arr = 0 if t.get("on_site") else min(start, int(t["target_min"]))
        wm = start - arr
        tm = max(0, start - int(t["target_min"]) - grace)
        prio = float(t.get("priority_weight", 1.0))
        waiting += wm * w.waitingPerMin * prio
        tard += tm * w.tardinessPerMin * prio
        wmin += wm
        tmin += tm
        per_dock.setdefault(cd, []).append((start, start + p))
        ends.append(start + p)
    for ivs in per_dock.values():
        ivs.sort()
        for a, b in zip(ivs, ivs[1:]):
            if b[0] < a[1]:
                conflicts += 1
    makespan = max(ends, default=0)
    return {
        "waiting": round(waiting, 2),
        "tardiness": round(tard, 2),
        "disruption": 0.0,
        "reassignment": 0.0,
        "makespan": round(makespan * w.makespanPerMin, 2),
        "unassigned": round(unassigned * w.unassigned, 2),
        "waiting_minutes": wmin,
        "tardiness_minutes": tmin,
        "unassigned_count": unassigned,
        "makespan_min": makespan,
        "conflicts": conflicts,
        "total": round(waiting + tard + makespan * w.makespanPerMin + unassigned * w.unassigned, 2),
    }


def _add_greedy_hint(m, trucks, fixed, docks, teams, team_pool, s, x, y, u, forced) -> None:
    dock_busy: dict[str, list[tuple[int, int]]] = {d: [] for d in docks}
    team_busy: dict[str, list[tuple[int, int]]] = {k: [] for k in teams}
    pool: list[tuple[int, int]] = []
    for f in fixed:
        if f.get("dock_id") in dock_busy:
            dock_busy[f["dock_id"]].append((f["start"], f["end"]))
        if f.get("team_id") in team_busy:
            team_busy[f["team_id"]].append((f["start"], f["end"]))
        if team_pool is not None and f.get("team_id"):
            pool.append((f["start"], f["end"]))

    def earliest(busy, t0, p):
        t = t0
        for a, b in sorted(busy):
            if b <= t:
                continue
            if a >= t + p:
                break
            t = max(t, b)
        return t

    def pool_ok(t, p):
        cap = int(team_pool)
        pts = sorted({t} | {a for a, b in pool if t <= a < t + p})
        return all(sum(1 for a, b in pool if a <= q < b) < cap for q in pts)

    for t in sorted(trucks, key=lambda t: (t["ready_min"], t["target_min"])):
        i = t["id"]
        if i in forced:
            continue
        p = int(t["service_min"])
        best = None
        for d in t["compatible_docks"]:
            if (i, d) not in x:
                continue
            st = earliest(dock_busy[d], max(0, int(t["ready_min"])), p)
            if team_pool is not None:
                guard = 0
                while not pool_ok(st, p) and guard < 500:
                    st = min([b for a, b in pool if b > st] + [st + 5])
                    st = earliest(dock_busy[d], st, p)
                    guard += 1
                cand = (st, d, None)
            else:
                opts = []
                for k in t.get("eligible_teams", []):
                    if (i, k) not in y:
                        continue
                    sk = max(st, int(teams[k]["shift_start"]))
                    for _ in range(50):
                        a = earliest(dock_busy[d], sk, p)
                        b = earliest(team_busy[k], a, p)
                        if a == b:
                            break
                        sk = b
                    if sk + p <= int(teams[k]["shift_end"]):
                        opts.append((sk, d, k))
                if not opts:
                    continue
                cand = min(opts)
            if best is None or cand[0] < best[0]:
                best = cand
        if best is None:
            continue
        st, d, k = best
        m.AddHint(u[i], 1)
        m.AddHint(s[i], st)
        for dd in t["compatible_docks"]:
            if (i, dd) in x:
                m.AddHint(x[(i, dd)], 1 if dd == d else 0)
        if k is not None:
            for kk in t.get("eligible_teams", []):
                if (i, kk) in y:
                    m.AddHint(y[(i, kk)], 1 if kk == k else 0)
            team_busy[k].append((st, st + p))
        else:
            pool.append((st, st + p))
        dock_busy[d].append((st, st + p))
