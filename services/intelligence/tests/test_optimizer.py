from wasl_intel.optimizer import solve


def base_payload(**over):
    p = {
        "horizon_min": 480, "time_limit_sec": 5, "allow_unassigned": True, "weights": {}, "inspectors": 1, "inspection_min": 20,
        "yard_capacity": 5, "docks": [{"id": "D1"}, {"id": "D2"}],
        "teams": [{"id": "A", "available": True, "shift_start": 0, "shift_end": 480}, {"id": "B", "available": True, "shift_start": 0, "shift_end": 480}],
        "equipment_capacity": {"FORKLIFT": 2}, "fixed": [],
        "trucks": [
            {"id": f"T{i}", "service_min": 45, "ready_min": 15, "target_min": 15 + 20 * i, "on_site": False, "compatible_docks": ["D1", "D2"],
             "eligible_teams": ["A", "B"], "equipment_type": "FORKLIFT", "needs_inspection": False, "priority_weight": 1.0, "current_dock_id": None, "current_start": None}
            for i in range(6)
        ],
    }
    p.update(over)
    return p


def overlaps(a, b):
    return a["start"] < b["end"] and b["start"] < a["end"]


def test_feasible_plan_respects_no_overlap_per_dock_and_team():
    r = solve(base_payload())
    assert r["status"] in ("OPTIMAL", "FEASIBLE")
    asg = [a for a in r["assignments"] if a["assigned"]]
    assert len(asg) == 6
    for i, a in enumerate(asg):
        assert a["start"] >= 15
        for b in asg[i + 1:]:
            if a["dock_id"] == b["dock_id"] or a["team_id"] == b["team_id"]:
                assert not overlaps(a, b)


def test_down_dock_is_never_used_and_fixed_work_is_respected():
    p = base_payload(docks=[{"id": "D1", "down": True}, {"id": "D2"}], fixed=[{"truck_id": "F", "dock_id": "D2", "team_id": "A", "start": 0, "end": 60, "equipment_type": "FORKLIFT"}])
    r = solve(p)
    asg = [a for a in r["assignments"] if a["assigned"]]
    assert asg and all(a["dock_id"] == "D2" for a in asg)
    assert all(a["start"] >= 60 for a in asg)


def test_infeasible_when_unassignment_forbidden_and_no_team_skills():
    p = base_payload(allow_unassigned=False)
    p["trucks"][0]["eligible_teams"] = []
    r = solve(p)
    assert r["status"] == "INFEASIBLE"
    assert r["assignments"] == []


def test_truck_without_compatible_dock_is_unassigned_with_reason():
    p = base_payload()
    p["trucks"][0]["compatible_docks"] = []
    r = solve(p)
    a = next(a for a in r["assignments"] if a["truck_id"] == "T0")
    assert a["assigned"] is False and a["reason"] == "NO_COMPATIBLE_DOCK"


def test_equipment_capacity_limits_parallel_service():
    p = base_payload(equipment_capacity={"FORKLIFT": 1})
    r = solve(p)
    asg = sorted([a for a in r["assignments"] if a["assigned"]], key=lambda a: a["start"])
    for a, b in zip(asg, asg[1:]):
        assert b["start"] >= a["end"]  # one forklift → strictly sequential


def test_inspector_capacity_one_means_inspections_do_not_overlap():
    p = base_payload()
    for t in p["trucks"]:
        t["needs_inspection"] = True
    r = solve(p)
    asg = sorted([a for a in r["assignments"] if a["assigned"]], key=lambda a: a["start"])
    for a, b in zip(asg, asg[1:]):
        assert b["start"] >= a["start"] + 20


def test_reassignment_weight_keeps_current_dock_when_equal():
    p = base_payload(weights={"reassignment": 100})
    p["trucks"] = p["trucks"][:1]
    p["trucks"][0]["current_dock_id"] = "D2"
    r = solve(p)
    assert r["assignments"][0]["dock_id"] == "D2"


def test_tiny_time_limit_reports_a_known_status():
    p = base_payload(time_limit_sec=0.001)
    r = solve(p)
    assert r["status"] in ("OPTIMAL", "FEASIBLE", "UNKNOWN")


def test_current_plan_breakdown_counts_conflicts():
    p = base_payload(docks=[{"id": "D1", "down": True}, {"id": "D2"}])
    p["trucks"][0].update(current_dock_id="D1", current_start=20)
    r = solve(p)
    assert r["current_breakdown"]["conflicts"] >= 1
