import numpy as np

from wasl_intel import ml
from wasl_intel import groundtruth as gt


def test_dataset_generation_is_seeded_and_valid():
    a = ml.generate_service_dataset(200, 1)
    b = ml.generate_service_dataset(200, 1)
    assert a.equals(b)
    assert ml.validate_service_dataset(a)["valid"]


def test_groundtruth_monotonic_in_pallets_and_crew():
    m1 = gt.mean_service_minutes("GENERAL", 10, "FORKLIFT_PALLET", "RIGID", 4, True, False)
    m2 = gt.mean_service_minutes("GENERAL", 20, "FORKLIFT_PALLET", "RIGID", 4, True, False)
    m3 = gt.mean_service_minutes("GENERAL", 20, "FORKLIFT_PALLET", "RIGID", 6, True, False)
    assert m2 > m1 and m3 < m2


def test_service_model_reports_baseline_comparison():
    res = ml.train_service_model(seed=3, n=800)
    meta = res["meta"]
    assert {"mae", "rmse"} <= meta["metrics"].keys()
    assert {"mae", "rmse"} <= meta["baseline_metrics"].keys()
    assert meta["beats_baseline"] == (meta["metrics"]["mae"] < meta["baseline_metrics"]["mae"])


def test_congestion_model_metrics_and_probabilities():
    res = ml.train_congestion_model(seed=3, n=400)
    m = res["meta"]["metrics"]
    assert 0 <= m["brier"] <= 1
    assert len(m["confusion_matrix_at_0.5"]["matrix"]) == 2
    p = res["artifact"]["model"].predict_proba(np.array([[5, 0.5, 3, 3, 40, 1, 1.0]]))[0, 1]
    assert 0 <= p <= 1
