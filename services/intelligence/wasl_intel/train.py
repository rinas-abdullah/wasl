"""CLI: python -m wasl_intel.train [--version V] [--if-missing]"""
from __future__ import annotations

import argparse
import datetime as dt
import json

from . import ml


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default=dt.datetime.now(dt.timezone.utc).strftime("%Y.%m.%d-%H%M"))
    ap.add_argument("--if-missing", action="store_true", help="only train when no model is registered")
    ap.add_argument("--seed", type=int, default=20261108)
    args = ap.parse_args()
    existing = {m["model_name"] for m in ml.registry.list()}
    for name, fn in (("service_time", ml.train_service_model), ("congestion_risk", ml.train_congestion_model)):
        if args.if_missing and name in existing:
            print(f"[train] {name}: already present, skipping")
            continue
        res = fn(seed=args.seed)
        path = ml.save(res, args.version)
        print(f"[train] {name} -> {path}")
        print(json.dumps({"metrics": {k: v for k, v in res["meta"]["metrics"].items() if not isinstance(v, (list, dict))}, "baseline": {k: v for k, v in res["meta"]["baseline_metrics"].items() if not isinstance(v, dict)}, "beats_baseline": res["meta"]["beats_baseline"]}, indent=2))


if __name__ == "__main__":
    main()
