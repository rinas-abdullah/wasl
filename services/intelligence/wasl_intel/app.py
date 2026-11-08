"""FastAPI entrypoint for the WASL intelligence service (internal network only)."""
from __future__ import annotations

import hmac
import logging
import os
import time
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import ml
from .optimizer import solve
from .simulation import SIM_VERSION, run as run_simulation

logging.basicConfig(level=logging.INFO, format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')
log = logging.getLogger("wasl.intel")

app = FastAPI(title="WASL Intelligence Service", version="0.1.0", description="OR-Tools optimisation, SimPy simulation and scikit-learn models. Internal service called by the WASL API.")


INTERNAL_KEY = os.environ.get("INTELLIGENCE_API_KEY", "")


@app.middleware("http")
async def require_internal_key(request, call_next):
    """When INTELLIGENCE_API_KEY is set, only callers presenting it (the WASL API) are served. /health stays open."""
    if INTERNAL_KEY and request.url.path != "/health" and not hmac.compare_digest(request.headers.get("x-internal-key", ""), INTERNAL_KEY):
        return JSONResponse({"detail": "forbidden"}, status_code=403)
    return await call_next(request)


@app.on_event("startup")
def ensure_models() -> None:
    if not ml.registry.list():
        log.info("no trained models found — training on synthetic data")
        for fn in (ml.train_service_model, ml.train_congestion_model):
            ml.save(fn(), time.strftime("%Y.%m.%d-%H%M"))
        ml.registry.reload()


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "sim_version": SIM_VERSION, "models": [f"{m['model_name']}@{m['version']}" for m in ml.registry.list() if m["is_active"]]}


@app.post("/optimize")
def optimize(payload: dict[str, Any]) -> dict[str, Any]:
    required = {"horizon_min", "trucks", "docks", "teams"}
    missing = required - payload.keys()
    if missing:
        raise HTTPException(422, f"missing fields: {sorted(missing)}")
    res = solve(payload)
    log.info("optimize status=%s trucks=%d runtime_ms=%d", res["status"], len(payload["trucks"]), res["runtime_ms"])
    return res


class SimRequest(BaseModel):
    params: dict[str, Any]
    policy: Literal["FCFS", "FIXED_APPOINTMENTS", "OR_ONLY", "FULL_WASL"]
    seed: int = Field(ge=0)


@app.post("/simulate")
def simulate(req: SimRequest) -> dict[str, Any]:
    res = run_simulation(req.params, req.policy, req.seed)
    log.info("simulate policy=%s seed=%d runtime_ms=%d", req.policy, req.seed, res["runtime_ms"])
    return res


class ServiceFeatures(BaseModel):
    cargo_type: str
    pallet_count: int = Field(ge=1, le=60)
    handling_method: str
    vehicle_type: str
    team_size: int = Field(ge=1, le=30)
    dock_has_leveler: bool = True
    inspection_required: bool = False


@app.post("/predict/service-time")
def predict_service(f: ServiceFeatures) -> dict[str, Any]:
    try:
        return ml.predict_service(f.model_dump())
    except LookupError as e:
        raise HTTPException(503, str(e))


class CongestionFeatures(BaseModel):
    arrivals_next_2h: int = Field(ge=0)
    dock_utilization: float = Field(ge=0, le=1)
    available_docks: int = Field(ge=0)
    available_teams: int = Field(ge=0)
    mean_service_min: float = Field(gt=0)
    yard_occupancy: int = Field(ge=0)


@app.post("/predict/congestion")
def predict_congestion(f: CongestionFeatures) -> dict[str, Any]:
    try:
        return ml.predict_congestion(f.model_dump())
    except LookupError as e:
        raise HTTPException(503, str(e))


@app.get("/models")
def models() -> list[dict[str, Any]]:
    return ml.registry.list()
