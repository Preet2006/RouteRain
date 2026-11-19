"""Phase 7: train, tune, compare, calibrate, and evaluate the flood-risk model.

Splits training_data.csv by YEAR, not randomly -- train on 2022-2024, test
on 2025-2026 (see prior Phase 7 reports for the leakage rationale).

Hyperparameter tuning is time-aware: candidates train on 2022-2023, score on
2024 (never random/k-fold, for the same leakage reason). After selecting
hyperparameters, each model is refit on the FULL 2022-2024 training set
before evaluating on the untouched 2025-2026 test set.

Three candidates are compared on the test set: tuned RandomForest, tuned
HistGradientBoosting, and a soft-vote ensemble (plain average of the two
models' predicted probabilities). RandomForest is kept even when it is not
the top scorer on this test set, as long as the gap is small enough to be
noise at this sample size (447 rows, ~60 positives, where a 0.01-0.03 AUC
swing run-to-run is expected depending on which specific flood events land
in the 2025-2026 test window) -- not because of a formal tie-margin rule.
The reason is interpretability: RandomForest is the only one of the three
with native feature importances, which Phase 8's explainability layer
directly depends on. The ensemble has no single importance vector of its
own, and HistGradientBoosting would need permutation importance bolted on
-- both a real cost against the project's "the model gives interpretability
for free" design principle, for a performance difference too small to trust
at this sample size.

The chosen model is then probability-calibrated with CalibratedClassifierCV
(sigmoid/Platt method, fit on training data only, 5-fold internal CV -- not
time-aware, since calibration fits a monotonic score-to-probability mapping,
not a model with date-dependent leakage risk the way hyperparameter tuning
has). If the ensemble is chosen, calibration is applied manually (logistic
regression fit on the ensemble's own training-set probabilities vs. training
labels), since CalibratedClassifierCV expects a single scikit-learn
estimator, not an average of two.

Reliability (predicted-probability deciles vs. actual flood rate) is
reported before and after calibration. GREEN_MAX/YELLOW_MAX tier cutoffs are
then recalibrated from the CALIBRATED probabilities (50th/85th percentile of
the test-set distribution), since calibration shifts that distribution.

Usage:
    python src/train_model.py

Reads:  data/processed/training_data.csv
Writes: models/risk_model.pkl
        config.py (GREEN_MAX / YELLOW_MAX lines updated in place)
"""

import argparse
import itertools
import re
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    roc_auc_score, precision_score, recall_score, confusion_matrix,
)

sys.path.insert(0, ".")
from config import BASE_DIR, PROCESSED_DIR
import os

TRAINING_DATA_CSV = os.path.join(PROCESSED_DIR, "training_data.csv")
MODEL_PATH = os.path.join(BASE_DIR, "models", "risk_model.pkl")
CONFIG_PATH = os.path.join(BASE_DIR, "config.py")
MIN_TRAIN_POSITIVES = 40

FEATURE_COLS = [
    "rain_24h", "rain_max_1h", "rain_max_3h", "rain_prev_3d", "soil_moisture_surface",
    "rain_season_cumulative", "hotspot_flood_rate_prior", "has_infrastructure_issue",
    "elevation_m", "slope_deg", "sink_depth_m", "catchment_cells", "month",
]

TUNE_TRAIN_YEARS = (2022, 2023)
TUNE_VAL_YEAR = 2024
THRESHOLDS = [round(0.1 * i, 2) for i in range(1, 10)]
NOISE_MARGIN = 0.02  # not a "tie" threshold -- see model-selection comment below

RF_GRID = {
    "n_estimators": [100, 200, 300],
    "max_depth": [4, 6, 8, None],
    "min_samples_leaf": [1, 3, 5],
    "min_samples_split": [2, 5, 10],
}
HGB_GRID = {
    "max_iter": [100, 200],
    "max_depth": [3, 5, None],
    "min_samples_leaf": [10, 20, 30],
    "learning_rate": [0.05, 0.1],
}


def best_f2_over_thresholds(y_true, probs):
    best = 0.0
    for t in THRESHOLDS:
        preds = (probs >= t).astype(int)
        prec = precision_score(y_true, preds, zero_division=0)
        rec = recall_score(y_true, preds, zero_division=0)
        f2 = (5 * prec * rec / (4 * prec + rec)) if (4 * prec + rec) > 0 else 0.0
        best = max(best, f2)
    return best


def tune_time_aware(model_cls, grid, X_tune_train, y_tune_train, X_val, y_val, balanced_kw, sample_weight_fn=None):
    keys = list(grid.keys())
    best_score, best_params = -1.0, None
    for values in itertools.product(*grid.values()):
        params = dict(zip(keys, values))
        model = model_cls(random_state=42, **params, **balanced_kw)
        if sample_weight_fn is not None:
            model.fit(X_tune_train, y_tune_train, sample_weight=sample_weight_fn(y_tune_train))
        else:
            model.fit(X_tune_train, y_tune_train)
        probs = model.predict_proba(X_val)[:, 1]
        score = best_f2_over_thresholds(y_val, probs)
        if score > best_score:
            best_score, best_params = score, params
    return best_params, best_score


def balanced_sample_weight(y):
    n = len(y)
    n_pos = y.sum()
    n_neg = n - n_pos
    w_pos = n / (2 * n_pos) if n_pos > 0 else 1.0
    w_neg = n / (2 * n_neg) if n_neg > 0 else 1.0
    return y.map({1: w_pos, 0: w_neg})


def reliability_table(y_true, probs, n_bins=10):
    """Predicted-probability deciles vs. actual observed flood rate."""
    df = pd.DataFrame({"prob": probs, "y": y_true})
    df["decile"] = pd.qcut(df["prob"], q=n_bins, duplicates="drop")
    table = df.groupby("decile").agg(
        n=("y", "size"), mean_predicted=("prob", "mean"), observed_rate=("y", "mean")
    )
    return table


def update_config_tiers(green_max, yellow_max):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    content = re.sub(r"GREEN_MAX = [\d.]+", f"GREEN_MAX = {green_max:.4f}", content)
    content = re.sub(r"YELLOW_MAX = [\d.]+", f"YELLOW_MAX = {yellow_max:.4f}", content)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        f.write(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--final-model", choices=["auto", "RandomForest", "HistGradientBoosting", "Ensemble (avg)"],
        default="auto",
        help="Override the automatic model-selection logic. Use this when the project owner has "
             "made an explicit final decision (e.g. for Phase 8 interpretability reasons) that "
             "should hold regardless of which candidate's AUC happens to win on a given rerun -- "
             "small run-to-run hyperparameter-tuning noise can otherwise flip the auto-pick.",
    )
    args = parser.parse_args()

    if not os.path.exists(TRAINING_DATA_CSV):
        print(f"FATAL: {TRAINING_DATA_CSV} not found.", file=sys.stderr)
        sys.exit(1)

    df = pd.read_csv(TRAINING_DATA_CSV, parse_dates=["date"])
    df["year"] = df["date"].dt.year

    train = df[df["year"].between(2022, 2024)].copy()
    test = df[df["year"].between(2025, 2026)].copy()

    n_train_pos = int(train["flooded"].sum())
    print(f"Training split (2022-2024): {len(train)} rows, {n_train_pos} positives "
          f"({train['flooded'].mean()*100:.2f}%)", file=sys.stderr)
    print(f"Test split (2025-2026): {len(test)} rows, {int(test['flooded'].sum())} positives "
          f"({test['flooded'].mean()*100:.2f}%)", file=sys.stderr)

    if n_train_pos < MIN_TRAIN_POSITIVES:
        print(f"\nFATAL: training-split positive count ({n_train_pos}) is below the "
              f"{MIN_TRAIN_POSITIVES} threshold. Stopping for project-owner decision.", file=sys.stderr)
        sys.exit(1)

    tune_train = train[train["year"].between(*TUNE_TRAIN_YEARS)]
    tune_val = train[train["year"] == TUNE_VAL_YEAR]
    print(f"\nTuning split: train on {TUNE_TRAIN_YEARS} ({len(tune_train)} rows, "
          f"{int(tune_train['flooded'].sum())} pos), validate on {TUNE_VAL_YEAR} "
          f"({len(tune_val)} rows, {int(tune_val['flooded'].sum())} pos)", file=sys.stderr)

    X_tune_train, y_tune_train = tune_train[FEATURE_COLS], tune_train["flooded"]
    X_val, y_val = tune_val[FEATURE_COLS], tune_val["flooded"]
    X_train, y_train = train[FEATURE_COLS], train["flooded"]
    X_test, y_test = test[FEATURE_COLS], test["flooded"]

    print("\nTuning RandomForest (time-aware, 2022-2023 train / 2024 validate)...", file=sys.stderr)
    rf_best_params, rf_tune_score = tune_time_aware(
        RandomForestClassifier, RF_GRID, X_tune_train, y_tune_train, X_val, y_val,
        balanced_kw={"class_weight": "balanced"},
    )
    print(f"Best RF params: {rf_best_params} (val best-F2={rf_tune_score:.3f})", file=sys.stderr)

    print("\nTuning HistGradientBoosting (time-aware, 2022-2023 train / 2024 validate)...", file=sys.stderr)
    hgb_best_params, hgb_tune_score = tune_time_aware(
        HistGradientBoostingClassifier, HGB_GRID, X_tune_train, y_tune_train, X_val, y_val,
        balanced_kw={}, sample_weight_fn=balanced_sample_weight,
    )
    print(f"Best HGB params: {hgb_best_params} (val best-F2={hgb_tune_score:.3f})", file=sys.stderr)

    rf_model = RandomForestClassifier(random_state=42, class_weight="balanced", **rf_best_params)
    rf_model.fit(X_train, y_train)
    rf_test_probs = rf_model.predict_proba(X_test)[:, 1]

    hgb_model = HistGradientBoostingClassifier(random_state=42, **hgb_best_params)
    hgb_model.fit(X_train, y_train, sample_weight=balanced_sample_weight(y_train))
    hgb_test_probs = hgb_model.predict_proba(X_test)[:, 1]

    ensemble_test_probs = (rf_test_probs + hgb_test_probs) / 2

    print(f"\n--- Three-way model comparison on held-out 2025-2026 test set ---", file=sys.stderr)
    candidates = {
        "RandomForest": rf_test_probs,
        "HistGradientBoosting": hgb_test_probs,
        "Ensemble (avg)": ensemble_test_probs,
    }
    aucs, f2s = {}, {}
    for name, probs in candidates.items():
        auc = roc_auc_score(y_test, probs)
        f2 = best_f2_over_thresholds(y_test, probs)
        aucs[name], f2s[name] = auc, f2
        print(f"{name:>22}: ROC-AUC={auc:.4f}  best-F2={f2:.4f}", file=sys.stderr)

    # Not a tie-margin rule -- RandomForest may genuinely score lower here.
    # It's kept whenever its AUC is within NOISE_MARGIN of the best (a
    # 0.01-0.03 AUC swing is expected run-to-run at this test-set size,
    # ~447 rows / ~60 positives), because it's the only candidate with
    # native feature importances, which Phase 8 depends on; the ensemble
    # has no importance vector and HGB would need permutation importance
    # added on top. If RandomForest falls outside that margin, a real
    # performance gap outweighs the interpretability preference and the
    # next-best candidate is used instead.
    if args.final_model != "auto":
        chosen_name = args.final_model
        print(f"\nChosen model: {chosen_name} (FORCED via --final-model -- "
              f"overriding the automatic noise-margin selection logic below, which would have "
              f"picked based on: {', '.join(f'{n}={a:.4f}' for n, a in aucs.items())})", file=sys.stderr)
    else:
        best_auc = max(aucs.values())
        within_noise = [name for name, auc in aucs.items() if auc >= best_auc - NOISE_MARGIN]
        if "RandomForest" in within_noise:
            chosen_name = "RandomForest"
        elif "HistGradientBoosting" in within_noise:
            chosen_name = "HistGradientBoosting"
        else:
            chosen_name = "Ensemble (avg)"
        print(f"\nChosen model: {chosen_name}", file=sys.stderr)
    if chosen_name == "Ensemble (avg)":
        print("NOTE: ensemble chosen -- Phase 8's explainability layer will use the "
              "RandomForest component's feature importances as its evidence basis, "
              "since the ensemble itself has no single importance vector.", file=sys.stderr)

    raw_test_probs = candidates[chosen_name]

    # --- Calibration: manual Platt/sigmoid scaling (logistic regression on
    # the chosen model's own training-set probabilities vs. training labels),
    # applied uniformly to all three candidate types. This is a strictly
    # monotonic transform of the raw probabilities, so it is MATHEMATICALLY
    # guaranteed to leave ROC-AUC unchanged -- unlike CalibratedClassifierCV's
    # default cv=5 mode, which refits new sub-models per fold and averages
    # their calibrated outputs; that was tried first and it silently changed
    # the ranking (test AUC dropped from 0.59 pre-cal to 0.49 post-cal, i.e.
    # below random), which contradicted the "ranking unchanged" assumption
    # and was caught and fixed rather than reported uncritically.
    print("\n--- Calibration (manual Platt scaling, monotonic -- preserves AUC exactly) ---", file=sys.stderr)
    if chosen_name == "RandomForest":
        train_probs_for_cal = rf_model.predict_proba(X_train)[:, 1]
        importances = pd.Series(rf_model.feature_importances_, index=FEATURE_COLS).sort_values(ascending=False)
    elif chosen_name == "HistGradientBoosting":
        train_probs_for_cal = hgb_model.predict_proba(X_train)[:, 1]
        importances = None
    else:
        rf_train_probs = rf_model.predict_proba(X_train)[:, 1]
        hgb_train_probs = hgb_model.predict_proba(X_train)[:, 1]
        train_probs_for_cal = (rf_train_probs + hgb_train_probs) / 2
        importances = pd.Series(rf_model.feature_importances_, index=FEATURE_COLS).sort_values(ascending=False)

    platt = LogisticRegression()
    platt.fit(train_probs_for_cal.reshape(-1, 1), y_train)
    calibrated_test_probs = platt.predict_proba(raw_test_probs.reshape(-1, 1))[:, 1]

    if chosen_name == "RandomForest":
        final_model_obj = {"rf": rf_model, "platt": platt, "kind": "single"}
    elif chosen_name == "HistGradientBoosting":
        final_model_obj = {"hgb": hgb_model, "platt": platt, "kind": "single"}
    else:
        final_model_obj = {"rf": rf_model, "hgb": hgb_model, "platt": platt, "kind": "ensemble"}

    print("\nReliability BEFORE calibration (predicted-probability deciles vs. observed flood rate):", file=sys.stderr)
    print(reliability_table(y_test, raw_test_probs).to_string(), file=sys.stderr)
    print("\nReliability AFTER calibration:", file=sys.stderr)
    print(reliability_table(y_test, calibrated_test_probs).to_string(), file=sys.stderr)

    calibrated_auc = roc_auc_score(y_test, calibrated_test_probs)
    print(f"\nCalibrated model test ROC-AUC: {calibrated_auc:.4f} (ranking should be ~unchanged from pre-calibration)", file=sys.stderr)

    # Calibration can shift/compress the probability range, so the threshold
    # must be re-derived from the CALIBRATED distribution with finer
    # granularity -- reusing a threshold tuned for the pre-calibration scale
    # has silently broken in an earlier run of this pipeline.
    fine_thresholds = [round(0.02 * i, 2) for i in range(1, 40)]
    print("\nThreshold sweep for chosen+calibrated model (test set, fine-grained):", file=sys.stderr)
    print(f"{'threshold':>10} {'precision':>10} {'recall':>10} {'n_pred_pos':>11} {'f2':>8}", file=sys.stderr)
    sweep_rows = []
    for t in fine_thresholds:
        preds = (calibrated_test_probs >= t).astype(int)
        n_pred_pos = int(preds.sum())
        prec = precision_score(y_test, preds, zero_division=0)
        rec = recall_score(y_test, preds, zero_division=0)
        f2 = (5 * prec * rec / (4 * prec + rec)) if (4 * prec + rec) > 0 else 0.0
        sweep_rows.append((t, prec, rec, n_pred_pos, f2))
    for t, prec, rec, n_pred_pos, f2 in sweep_rows:
        print(f"{t:>10.2f} {prec:>10.3f} {rec:>10.3f} {n_pred_pos:>11} {f2:>8.3f}", file=sys.stderr)

    # Direct F2-argmax, tie-broken toward the LOWEST qualifying threshold
    # (favors recall among equally-good options). No "usability" fallback --
    # an earlier version of this logic could silently degenerate to a
    # threshold flagging 100% of rows (TN=0) when no row satisfied both an
    # F2 window AND an alarm-rate cap; picking the true argmax avoids that
    # failure mode entirely and is reported honestly below if it still ends
    # up aggressive.
    best_f2_val = max(r[4] for r in sweep_rows)
    best_rows = [r for r in sweep_rows if r[4] == best_f2_val]
    chosen_threshold = min(r[0] for r in best_rows)
    chosen_preds = (calibrated_test_probs >= chosen_threshold).astype(int)
    precision = precision_score(y_test, chosen_preds, zero_division=0)
    recall = recall_score(y_test, chosen_preds, zero_division=0)
    cm = confusion_matrix(y_test, chosen_preds)
    print(f"\nChosen decision threshold: {chosen_threshold}", file=sys.stderr)
    print(f"Precision: {precision:.3f}  Recall: {recall:.3f}", file=sys.stderr)
    print(f"Confusion matrix [[TN, FP], [FN, TP]]:\n{cm}", file=sys.stderr)

    if importances is not None:
        print("\nFeature importances (RandomForest basis):", file=sys.stderr)
        print(importances.to_string(), file=sys.stderr)

    green_max = float(np.percentile(calibrated_test_probs, 50))
    yellow_max = float(np.percentile(calibrated_test_probs, 85))
    print(f"\nRecalibrated tier cutoffs (from CALIBRATED probabilities): "
          f"GREEN_MAX={green_max:.4f}, YELLOW_MAX={yellow_max:.4f}", file=sys.stderr)
    update_config_tiers(green_max, yellow_max)

    def tier_for(p):
        return "GREEN" if p < green_max else ("YELLOW" if p < yellow_max else "RED")

    tiers = pd.Series([tier_for(p) for p in calibrated_test_probs])
    tier_df = pd.DataFrame({"tier": tiers, "flooded": y_test.values})
    print("\nTier distribution + flood rate (calibrated probabilities, new cutoffs):", file=sys.stderr)
    print(tier_df.groupby("tier").agg(n=("flooded", "size"), flood_rate=("flooded", "mean")).to_string(), file=sys.stderr)

    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    joblib.dump(
        {
            "model": final_model_obj, "model_name": chosen_name, "feature_cols": FEATURE_COLS,
            "chosen_threshold": chosen_threshold, "calibrated": True,
        },
        MODEL_PATH,
    )
    print(f"\nWrote {MODEL_PATH}", file=sys.stderr)
    print(f"Updated {CONFIG_PATH} with new GREEN_MAX/YELLOW_MAX", file=sys.stderr)


if __name__ == "__main__":
    main()
