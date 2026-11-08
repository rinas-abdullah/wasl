from wasl_intel.presets import preset
from wasl_intel.simulation import run


def small(name="NORMAL", **over):
    p = preset(name)
    p.update(nTrucks=14, durationMin=300)
    p.update(over)
    return p


def test_same_seed_same_results_reproducible():
    a = run(small(), "FULL_WASL", 7)
    b = run(small(), "FULL_WASL", 7)
    assert a["metrics"] == b["metrics"]
    assert a["events"] == b["events"]


def test_different_seed_changes_world():
    a = run(small(), "FCFS", 1)["metrics"]
    b = run(small(), "FCFS", 2)["metrics"]
    assert a != b


def test_all_trucks_served_and_no_dock_double_occupancy():
    for pol in ("FCFS", "FIXED_APPOINTMENTS", "OR_ONLY", "FULL_WASL"):
        r = run(small("DOCK_FAILURE"), pol, 3)
        assert r["metrics"]["served"] == 14
        busy = {}
        for e in r["events"]:
            if e["type"] == "SERVICE_START":
                assert busy.get(e["dock"]) is None, f"{pol}: {e['dock']} double-occupied at {e['t']}"
                busy[e["dock"]] = e["truck"]
            elif e["type"] == "SERVICE_COMPLETE":
                busy[e["dock"]] = None


def test_failed_dock_receives_no_new_service_while_down():
    p = small(failures=[{"kind": "DOCK", "index": 0, "atMin": 30, "durationMin": 120}])
    r = run(p, "FCFS", 5)
    starts = [e for e in r["events"] if e["type"] == "SERVICE_START" and e["dock"] == "D1"]
    assert all(not (30 <= e["t"] < 150) for e in starts)
    assert any(e["type"] == "DOCK_FAILURE" for e in r["events"])


def test_metrics_are_internally_consistent():
    m = run(small(), "FCFS", 11)["metrics"]
    assert m["median_wait_min"] <= m["p95_wait_min"] + 1e-9
    assert 0 <= m["dock_utilization"] <= 1
    assert m["avg_turnaround_min"] >= m["avg_wait_min"]
