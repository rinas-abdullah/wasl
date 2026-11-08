"""Scenario presets (mirrored in packages/shared/src/presets.ts for the UI)."""
BASE = {
    "durationMin": 600, "nTrucks": 36, "nDocks": 4, "nReeferDocks": 2, "nTeams": 4, "nInspectors": 1, "yardCapacity": 8,
    "arrival": {"pattern": "UNIFORM_APPOINTMENTS", "latenessMeanMin": 0, "latenessSdMin": 15},
    "service": {"distribution": "LOGNORMAL", "cv": 0.3},
    "coldShare": 0.25, "qualityProbability": 0.1, "inspectionMin": 25, "travelMin": 15, "failures": [],
}


def preset(name: str) -> dict:
    p = {**BASE, "arrival": dict(BASE["arrival"]), "service": dict(BASE["service"]), "failures": []}
    if name == "PEAK_ARRIVALS":
        p["arrival"]["pattern"] = "PEAKED_APPOINTMENTS"; p["nTrucks"] = 44
    elif name == "DOCK_FAILURE":
        p["failures"] = [{"kind": "DOCK", "index": 2, "atMin": 120, "durationMin": 180}]
    elif name == "WORKFORCE_SHORTAGE":
        p["failures"] = [{"kind": "TEAM", "index": 0, "atMin": 90, "durationMin": 240}, {"kind": "TEAM", "index": 1, "atMin": 180, "durationMin": 120}]
    elif name == "DELAYED_TRUCKS":
        p["arrival"].update(latenessMeanMin=25, latenessSdMin=35)
    elif name == "QUALITY_SURGE":
        p["qualityProbability"] = 0.35
    elif name == "MIXED_DISRUPTION":
        p["arrival"].update(pattern="PEAKED_APPOINTMENTS", latenessMeanMin=15, latenessSdMin=30)
        p["qualityProbability"] = 0.2
        p["failures"] = [{"kind": "DOCK", "index": 2, "atMin": 150, "durationMin": 150}, {"kind": "TEAM", "index": 0, "atMin": 200, "durationMin": 180}]
    return p
