"""
Synthetic ground-truth process for unloading (service) time.

This is the DATA-GENERATING assumption used for both the ML training set and
the SimPy simulation. It is documented openly so judges can see that the model
is learning a declared synthetic process — not real warehouse data.

mean_minutes = setup(cargo) + per_pallet(cargo, handling) * pallets * crew_factor * dock_factor
              + inspection_min (if inspection) + vehicle_overhead(vehicle)
actual ~ LogNormal with coefficient of variation `cv` around mean_minutes.
"""
from __future__ import annotations

import math
import numpy as np

CARGO_TYPES = ["GENERAL", "CHILLED", "FROZEN", "PHARMA", "FRAGILE", "BULK"]
HANDLING = ["FORKLIFT_PALLET", "PALLET_JACK", "MANUAL", "CLAMP"]
VEHICLES = ["VAN", "RIGID", "ARTICULATED", "REEFER_TRAILER"]

SETUP = {"GENERAL": 10, "CHILLED": 14, "FROZEN": 17, "PHARMA": 18, "FRAGILE": 12, "BULK": 8}
PER_PALLET = {
    # minutes per pallet by handling method, multiplied by a cargo factor
    "FORKLIFT_PALLET": 1.35,
    "PALLET_JACK": 1.9,
    "MANUAL": 3.6,
    "CLAMP": 1.6,
}
CARGO_FACTOR = {"GENERAL": 1.0, "CHILLED": 1.12, "FROZEN": 1.2, "PHARMA": 1.25, "FRAGILE": 1.45, "BULK": 0.85}
VEHICLE_OVERHEAD = {"VAN": 2, "RIGID": 4, "ARTICULATED": 6, "REEFER_TRAILER": 8}


def mean_service_minutes(cargo: str, pallets: int, handling: str, vehicle: str, team_size: int, leveler: bool, inspection: bool, inspection_min: int = 20) -> float:
    crew_factor = (4.0 / max(1, team_size)) ** 0.55  # diminishing returns of crew size
    dock_factor = 1.0 if leveler else 1.15
    m = SETUP[cargo] + PER_PALLET[handling] * CARGO_FACTOR[cargo] * pallets * crew_factor * dock_factor + VEHICLE_OVERHEAD[vehicle]
    if inspection:
        m += inspection_min
    return m


def sample_lognormal(rng: np.random.Generator, mean: float, cv: float) -> float:
    sigma2 = math.log(1 + cv * cv)
    mu = math.log(mean) - sigma2 / 2
    return float(rng.lognormal(mu, math.sqrt(sigma2)))


def sample_features(rng: np.random.Generator) -> dict:
    cargo = rng.choice(CARGO_TYPES, p=[0.42, 0.16, 0.1, 0.07, 0.1, 0.15])
    handling = rng.choice(HANDLING, p=[0.6, 0.22, 0.1, 0.08])
    vehicle = "REEFER_TRAILER" if cargo in ("CHILLED", "FROZEN", "PHARMA") and rng.random() < 0.7 else rng.choice(["VAN", "RIGID", "ARTICULATED"], p=[0.2, 0.35, 0.45])
    max_p = {"VAN": 12, "RIGID": 20, "ARTICULATED": 33, "REEFER_TRAILER": 30}[vehicle]
    return {
        "cargo_type": str(cargo),
        "pallet_count": int(rng.integers(2, max_p + 1)),
        "handling_method": str(handling),
        "vehicle_type": str(vehicle),
        "team_size": int(rng.integers(2, 7)),
        "dock_has_leveler": bool(rng.random() < 0.8),
        "inspection_required": bool(rng.random() < 0.12),
    }
