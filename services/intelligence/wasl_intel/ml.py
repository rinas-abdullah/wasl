"""
Model training, evaluation, registry and inference.

Model 01 — service-time regression (GradientBoostingRegressor + quantile models for an 80% interval)
           baseline: mean service time per cargo type (the baseline named in the WASL proposal).
Model 02 — congestion risk classifier (LogisticRegression) predicting whether yard queue length will
           exceed a threshold within the next 2 hours. Labels come from SimPy roll-outs of a
           queueing process, not from a formula on the features.
           baseline: empirical frequency per load-ratio decile (a calibrated rule of thumb).

Everything here is trained on SYNTHETIC data: "Synthetic Training Data — Experimental Model".
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import simpy
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, confusion_matrix, mean_absolute_error, mean_squared_error, precision_score, recall_score, roc_auc_score, log_loss
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import groundtruth as gt

MODELS_DIR = Path(os.environ.get("WASL_MODELS_DIR", Path(__file__).resolve().parent.parent / "models"))
LABEL = "Synthetic Training Data — Experimental Model"
SERVICE_FEATURES = ["pallet_count", "team_size", "dock_has_leveler", "inspection_required"]
CONGESTION_FEATURES = ["arrivals_next_2h", "dock_utilization", "available_docks", "available_teams", "mean_service_min", "yard_occupancy"]
CONGESTION_THRESHOLD = 5


def _encode_service(df: pd.DataFrame) -> pd.DataFrame:
    out = df[SERVICE_FEATURES].astype(float).copy()
    for col, cats in (("cargo_type", gt.CARGO_TYPES), ("handling_method", gt.HANDLING), ("vehicle_type", gt.VEHICLES)):
        for c in cats:
            out[f"{col}={c}"] = (df[col] == c).astype(float)
    return out


# ------------------------------------------------------------------ #
# Dataset generation                                                   #
# ------------------------------------------------------------------ #

def generate_service_dataset(n: int, seed: int, cv: float = 0.22) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        f = gt.sample_features(rng)
        mean = gt.mean_service_minutes(f["cargo_type"], f["pallet_count"], f["handling_method"], f["vehicle_type"], f["team_size"], f["dock_has_leveler"], f["inspection_required"])
        f["service_min"] = gt.sample_lognormal(rng, mean, cv)
        rows.append(f)
    return pd.DataFrame(rows)


def validate_service_dataset(df: pd.DataFrame) -> dict[str, Any]:
    issues = []
    if df.isna().any().any():
        issues.append("missing values")
    if (df["service_min"] <= 0).any():
        issues.append("non-positive service times")
    if not df["cargo_type"].isin(gt.CARGO_TYPES).all():
        issues.append("unknown cargo types")
    if (df["pallet_count"] < 1).any():
        issues.append("invalid pallet counts")
    return {"rows": int(len(df)), "issues": issues, "valid": not issues, "service_min": {"mean": float(df.service_min.mean()), "p50": float(df.service_min.median()), "p95": float(df.service_min.quantile(0.95))}}


def _queue_rollout(rng: np.random.Generator, arrivals: int, docks: int, teams: int, mean_service: float, yard0: int, busy_frac: float, horizon: float = 120.0) -> int:
    """SimPy roll-out: returns max yard queue length observed in the horizon."""
    env = simpy.Environment()
    servers = simpy.Resource(env, capacity=max(1, min(docks, teams)))
    state = {"queue": 0, "max": 0}

    def service(env, dur):
        state["queue"] += 1
        state["max"] = max(state["max"], state["queue"])
        with servers.request() as req:
            yield req
            state["queue"] -= 1
            yield env.timeout(dur)

    def initial_busy(env, dur):
        with servers.request() as req:
            yield req
            yield env.timeout(dur)

    n_busy = int(round(busy_frac * servers.capacity))
    for _ in range(n_busy):
        env.process(initial_busy(env, float(rng.uniform(0, mean_service))))
    for _ in range(yard0):
        env.process(service(env, gt.sample_lognormal(rng, mean_service, 0.3)))

    def arrival_gen(env):
        times = np.sort(rng.uniform(0, horizon, size=arrivals) + rng.normal(0, 10, size=arrivals))
        last = 0.0
        for t in times:
            t = max(t, last)
            yield env.timeout(t - last)
            last = t
            env.process(service(env, gt.sample_lognormal(rng, mean_service, 0.3)))

    env.process(arrival_gen(env))
    env.run(until=horizon)
    return state["max"]


def generate_congestion_dataset(n: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(n):
        docks = int(rng.integers(2, 7))
        teams = int(rng.integers(1, 6))
        avail_docks = int(max(1, docks - rng.binomial(docks, 0.12)))
        arrivals = int(rng.integers(0, 16))
        mean_service = float(rng.uniform(25, 75))
        yard = int(rng.integers(0, 6))
        util = float(rng.uniform(0, 1))
        mx = _queue_rollout(rng, arrivals, avail_docks, teams, mean_service, yard, util)
        rows.append({"arrivals_next_2h": arrivals, "dock_utilization": util, "available_docks": avail_docks, "available_teams": teams, "mean_service_min": mean_service, "yard_occupancy": yard, "congested": int(mx >= CONGESTION_THRESHOLD)})
    return pd.DataFrame(rows)


def _load_ratio(df: pd.DataFrame) -> pd.Series:
    cap = np.minimum(df["available_docks"], df["available_teams"]).clip(lower=1) * 120.0
    return (df["arrivals_next_2h"] + df["yard_occupancy"]) * df["mean_service_min"] / cap + df["dock_utilization"] * 0.5


# ------------------------------------------------------------------ #
# Training                                                             #
# ------------------------------------------------------------------ #

def train_service_model(seed: int = 20261108, n: int = 6000) -> dict[str, Any]:
    df = generate_service_dataset(n, seed)
    validation = validate_service_dataset(df)
    if not validation["valid"]:
        raise ValueError(f"dataset validation failed: {validation['issues']}")
    train, test = train_test_split(df, test_size=0.2, random_state=seed)
    Xtr, Xte = _encode_service(train), _encode_service(test)
    model = GradientBoostingRegressor(n_estimators=300, max_depth=3, learning_rate=0.05, random_state=seed).fit(Xtr, train.service_min)
    q_lo = GradientBoostingRegressor(loss="quantile", alpha=0.1, n_estimators=200, max_depth=3, learning_rate=0.05, random_state=seed).fit(Xtr, train.service_min)
    q_hi = GradientBoostingRegressor(loss="quantile", alpha=0.9, n_estimators=200, max_depth=3, learning_rate=0.05, random_state=seed).fit(Xtr, train.service_min)
    pred = model.predict(Xte)
    lo, hi = q_lo.predict(Xte), q_hi.predict(Xte)
    cargo_mean = train.groupby("cargo_type").service_min.mean().to_dict()
    base = test.cargo_type.map(cargo_mean).fillna(train.service_min.mean())
    metrics = {
        "mae": float(mean_absolute_error(test.service_min, pred)),
        "rmse": float(math.sqrt(mean_squared_error(test.service_min, pred))),
        "interval_80_coverage": float(np.mean((test.service_min >= lo) & (test.service_min <= hi))),
        "n_train": int(len(train)),
        "n_test": int(len(test)),
    }
    baseline = {
        "name": "mean service time per cargo type",
        "mae": float(mean_absolute_error(test.service_min, base)),
        "rmse": float(math.sqrt(mean_squared_error(test.service_min, base))),
        "cargo_mean_min": {k: round(v, 2) for k, v in cargo_mean.items()},
    }
    return {
        "artifact": {"model": model, "q_lo": q_lo, "q_hi": q_hi, "columns": list(Xtr.columns), "cargo_mean": cargo_mean, "global_mean": float(train.service_min.mean())},
        "meta": {
            "model_name": "service_time",
            "algorithm": "GradientBoostingRegressor (+ quantile GBR for P10/P90)",
            "dataset_source": f"synthetic: groundtruth.py lognormal process, n={n}, seed={seed}",
            "metrics": metrics,
            "baseline_metrics": baseline,
            "beats_baseline": metrics["mae"] < baseline["mae"],
            "validation": validation,
            "features": SERVICE_FEATURES + ["cargo_type", "handling_method", "vehicle_type"],
        },
    }


def train_congestion_model(seed: int = 20261108, n: int = 2500) -> dict[str, Any]:
    df = generate_congestion_dataset(n, seed)
    train, test = train_test_split(df, test_size=0.25, random_state=seed, stratify=df.congested)
    Xtr = train[CONGESTION_FEATURES].assign(load_ratio=_load_ratio(train))
    Xte = test[CONGESTION_FEATURES].assign(load_ratio=_load_ratio(test))
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0)).fit(Xtr, train.congested)
    p = model.predict_proba(Xte)[:, 1]
    yhat = (p >= 0.5).astype(int)
    # Baseline: empirical congestion frequency per load-ratio decile (fit on train).
    bins = np.quantile(Xtr.load_ratio, np.linspace(0, 1, 11))
    bins[0], bins[-1] = -np.inf, np.inf
    tr_bin = np.digitize(Xtr.load_ratio, bins[1:-1])
    freq = pd.Series(train.congested.values).groupby(tr_bin).mean().to_dict()
    te_bin = np.digitize(Xte.load_ratio, bins[1:-1])
    pb = np.array([freq.get(b, train.congested.mean()) for b in te_bin])
    calib = []
    edges = np.linspace(0, 1, 11)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if mask.sum():
            calib.append({"bin": f"{lo:.1f}-{hi:.1f}", "predicted": float(p[mask].mean()), "observed": float(test.congested.values[mask].mean()), "count": int(mask.sum())})
    cm = confusion_matrix(test.congested, yhat, labels=[0, 1]).tolist()
    metrics = {
        "brier": float(brier_score_loss(test.congested, p)),
        "log_loss": float(log_loss(test.congested, p, labels=[0, 1])),
        "roc_auc": float(roc_auc_score(test.congested, p)),
        "precision_at_0.5": float(precision_score(test.congested, yhat, zero_division=0)),
        "recall_at_0.5": float(recall_score(test.congested, yhat, zero_division=0)),
        "confusion_matrix_at_0.5": {"labels": ["not_congested", "congested"], "matrix": cm},
        "calibration": calib,
        "prevalence": float(df.congested.mean()),
        "n_train": int(len(train)),
        "n_test": int(len(test)),
        "threshold_queue_length": CONGESTION_THRESHOLD,
    }
    baseline = {
        "name": "empirical frequency per load-ratio decile",
        "brier": float(brier_score_loss(test.congested, pb)),
        "roc_auc": float(roc_auc_score(test.congested, pb)),
    }
    return {
        "artifact": {"model": model, "features": CONGESTION_FEATURES},
        "meta": {
            "model_name": "congestion_risk",
            "algorithm": "LogisticRegression (standardised features + load ratio)",
            "dataset_source": f"synthetic: SimPy queue roll-outs (120 min), n={n}, seed={seed}",
            "metrics": metrics,
            "baseline_metrics": baseline,
            "beats_baseline": metrics["brier"] < baseline["brier"],
            "features": CONGESTION_FEATURES + ["load_ratio"],
        },
    }


def save(result: dict[str, Any], version: str) -> Path:
    meta = dict(result["meta"])
    meta.update({"version": version, "training_date": dt.datetime.now(dt.timezone.utc).isoformat(), "label": LABEL})
    out = MODELS_DIR / meta["model_name"] / version
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump(result["artifact"], out / "model.joblib")
    (out / "metadata.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    return out


# ------------------------------------------------------------------ #
# Registry & inference                                                 #
# ------------------------------------------------------------------ #

class Registry:
    def __init__(self) -> None:
        self.loaded: dict[str, tuple[dict, dict]] = {}

    def list(self) -> list[dict]:
        items = []
        if MODELS_DIR.exists():
            for meta_path in sorted(MODELS_DIR.glob("*/*/metadata.json")):
                items.append(json.loads(meta_path.read_text()))
        latest: dict[str, str] = {}
        for m in items:
            if m["version"] > latest.get(m["model_name"], ""):
                latest[m["model_name"]] = m["version"]
        for m in items:
            m["is_active"] = latest.get(m["model_name"]) == m["version"]
        return items

    def get(self, name: str) -> tuple[dict, dict] | None:
        if name in self.loaded:
            return self.loaded[name]
        active = [m for m in self.list() if m["model_name"] == name and m["is_active"]]
        if not active:
            return None
        meta = active[0]
        art = joblib.load(MODELS_DIR / name / meta["version"] / "model.joblib")
        self.loaded[name] = (art, meta)
        return self.loaded[name]

    def reload(self) -> None:
        self.loaded.clear()


registry = Registry()


def predict_service(features: dict[str, Any]) -> dict[str, Any]:
    got = registry.get("service_time")
    if got is None:
        raise LookupError("service_time model not trained")
    art, meta = got
    row = pd.DataFrame([features])
    X = _encode_service(row).reindex(columns=art["columns"], fill_value=0.0)
    if meta.get("beats_baseline"):
        mean = float(art["model"].predict(X)[0])
        lo, hi = float(art["q_lo"].predict(X)[0]), float(art["q_hi"].predict(X)[0])
        src = f"MODEL:service_time@{meta['version']}"
    else:
        # The model did not beat the baseline on held-out data: serve the baseline instead, labelled as such.
        mean = float(art["cargo_mean"].get(features["cargo_type"], art["global_mean"]))
        lo = hi = mean
        src = f"BASELINE:cargo_mean@{meta['version']}"
    return {"minutes": mean, "low": min(lo, mean), "high": max(hi, mean), "source": src, "label": LABEL}


def predict_congestion(features: dict[str, Any]) -> dict[str, Any]:
    got = registry.get("congestion_risk")
    if got is None:
        raise LookupError("congestion_risk model not trained")
    art, meta = got
    row = pd.DataFrame([features])[CONGESTION_FEATURES]
    row = row.assign(load_ratio=_load_ratio(row))
    p = float(art["model"].predict_proba(row)[0, 1])
    return {"probability": p, "threshold_queue_length": CONGESTION_THRESHOLD, "source": f"MODEL:congestion_risk@{meta['version']}", "label": LABEL, "beats_baseline": meta.get("beats_baseline")}
