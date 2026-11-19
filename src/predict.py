"""Phase 7/9: shared prediction interface -- risk probability + tier per hotspot.

This is the single function Phase 9's Streamlit app (and the eventual Phase 10
--notify automation) calls to turn a hotspot's rainfall + terrain features
into a risk score. It is import-driven, not console-output-driven: the
public function `predict_risk()` returns a plain dict, not a printed string,
so callers can consume it directly.

Risk tiers (GREEN/YELLOW/RED) are a fixed mapping of the model's predicted
probability (config.GREEN_MAX, config.YELLOW_MAX) for user-facing display.
They are NOT the same thing as the recall-tuned decision threshold used
during Phase 7 evaluation.

Two of the model's features need special handling here (they aren't plain
rainfall/terrain values a caller can just hand over):
  hotspot_flood_rate_prior -- a fixed constant per hotspot, computed once in
      Phase 6 from 2022-2024 training data. Looked up from training_data.csv
      here (deduplicated per hotspot), never recomputed live.
  rain_season_cumulative -- depends on how much it has already rained at
      that hotspot since June 1 of the current year. In --forecast mode this
      is computed by summing the real historical weather_features.csv rows
      for the current season-to-date, then adding each forecast day's rain
      progressively. In --hotspot_id ad-hoc mode, the caller must supply it
      directly (--rain_season_cumulative), since there's no "current date"
      context to look up season-to-date history from automatically.

Usage (CLI):
    python src/predict.py --forecast
        Scores every (hotspot, date) row in data/processed/weather_forecast.csv,
        writes data/processed/risk_predictions.csv, prints a summary.

    python src/predict.py --hotspot_id H01 --date 2026-07-15 \\
        --rain_24h 45 --rain_max_1h 20 --rain_max_3h 35 --rain_prev_3d 10 \\
        --rain_season_cumulative 300 --soil_moisture_surface 0.32
        Scores a single ad-hoc set of rainfall features for one hotspot
        (terrain features and hotspot_flood_rate_prior looked up automatically).

Usage (import, for Phase 9):
    from src.predict import predict_risk, load_model
    bundle = load_model()
    result = predict_risk(bundle, feature_dict)
    # result = {"probability": 0.42, "tier": "YELLOW", "features": {...}}

Reads:  models/risk_model.pkl
        data/processed/terrain_features.csv
        data/processed/training_data.csv      (for hotspot_flood_rate_prior lookup)
        data/processed/weather_features.csv    (--forecast mode only, season-to-date)
        data/processed/weather_forecast.csv    (--forecast mode only)
Writes: data/processed/risk_predictions.csv    (--forecast mode only)
"""

import argparse
import sys

import joblib
import pandas as pd

sys.path.insert(0, ".")
from config import BASE_DIR, PROCESSED_DIR, GREEN_MAX, YELLOW_MAX
import os

MODEL_PATH = os.path.join(BASE_DIR, "models", "risk_model.pkl")
TERRAIN_CSV = os.path.join(PROCESSED_DIR, "terrain_features.csv")
TRAINING_DATA_CSV = os.path.join(PROCESSED_DIR, "training_data.csv")
WEATHER_CSV = os.path.join(PROCESSED_DIR, "weather_features.csv")
FORECAST_CSV = os.path.join(PROCESSED_DIR, "weather_forecast.csv")
PREDICTIONS_CSV = os.path.join(PROCESSED_DIR, "risk_predictions.csv")


def tier_for_probability(p):
    if p < GREEN_MAX:
        return "GREEN"
    elif p < YELLOW_MAX:
        return "YELLOW"
    else:
        return "RED"


def load_model(path=MODEL_PATH):
    if not os.path.exists(path):
        raise FileNotFoundError(f"FATAL: model not found at {path}. Run src/train_model.py first.")
    return joblib.load(path)


def load_flood_rate_priors():
    """hotspot_flood_rate_prior is a fixed constant per hotspot (Phase 6) --
    looked up here, never recomputed live."""
    if not os.path.exists(TRAINING_DATA_CSV):
        raise FileNotFoundError(f"FATAL: {TRAINING_DATA_CSV} not found.")
    df = pd.read_csv(TRAINING_DATA_CSV)
    return df.groupby("hotspot_id")["hotspot_flood_rate_prior"].first()


def load_infrastructure_flags():
    """has_infrastructure_issue is a fixed constant per hotspot (Phase 6) --
    looked up here, never recomputed live."""
    if not os.path.exists(TRAINING_DATA_CSV):
        raise FileNotFoundError(f"FATAL: {TRAINING_DATA_CSV} not found.")
    df = pd.read_csv(TRAINING_DATA_CSV)
    return df.groupby("hotspot_id")["has_infrastructure_issue"].first()


def _model_predict_proba(model, row):
    """model is always a dict of {component model(s), platt, kind} -- see
    train_model.py's unified manual-Platt-calibration block. 'single' means
    one base model (rf or hgb) was chosen; 'ensemble' averages rf+hgb first.
    Either way, the base probability is passed through the fitted Platt
    (logistic regression) calibrator before being returned."""
    if model["kind"] == "ensemble":
        rf_prob = model["rf"].predict_proba(row)[0, 1]
        hgb_prob = model["hgb"].predict_proba(row)[0, 1]
        raw_prob = (rf_prob + hgb_prob) / 2
    else:
        base = model.get("rf") or model.get("hgb")
        raw_prob = base.predict_proba(row)[0, 1]
    return float(model["platt"].predict_proba([[raw_prob]])[0, 1])


def predict_risk(bundle, feature_dict):
    """feature_dict must contain all of bundle['feature_cols']. Returns a
    plain dict: {probability, tier, features} -- features echoes back
    exactly what went into the prediction, for Phase 9/explain.py to cite."""
    model = bundle["model"]
    feature_cols = bundle["feature_cols"]
    missing = [c for c in feature_cols if c not in feature_dict]
    if missing:
        raise ValueError(f"FATAL: missing required features: {missing}")

    row = pd.DataFrame([{c: feature_dict[c] for c in feature_cols}])
    probability = _model_predict_proba(model, row)
    return {
        "probability": round(probability, 4),
        "tier": tier_for_probability(probability),
        "features": {c: feature_dict[c] for c in feature_cols},
    }


def predict_for_hotspot(bundle, terrain_row, flood_rate_prior, infrastructure_flag, hotspot_id, date,
                         rain_24h, rain_max_1h, rain_max_3h, rain_prev_3d, rain_season_cumulative,
                         soil_moisture_surface):
    """Convenience wrapper: combines a terrain_features.csv row, the
    hotspot's fixed flood-rate prior and infrastructure flag, and live/
    ad-hoc rainfall + soil moisture values into the full feature vector."""
    month = pd.Timestamp(date).month
    feature_dict = {
        "rain_24h": rain_24h,
        "rain_max_1h": rain_max_1h,
        "rain_max_3h": rain_max_3h,
        "rain_prev_3d": rain_prev_3d,
        "soil_moisture_surface": soil_moisture_surface,
        "rain_season_cumulative": rain_season_cumulative,
        "hotspot_flood_rate_prior": flood_rate_prior,
        "has_infrastructure_issue": infrastructure_flag,
        "elevation_m": terrain_row["elevation_m"],
        "slope_deg": terrain_row["slope_deg"],
        "sink_depth_m": terrain_row["sink_depth_m"],
        "catchment_cells": terrain_row["catchment_cells"],
        "month": month,
    }
    result = predict_risk(bundle, feature_dict)
    result["hotspot_id"] = hotspot_id
    result["date"] = str(date)
    return result


def compute_forecast_season_cumulative(weather_history, forecast):
    """For each hotspot, season-to-date rain (sum of real weather_features.csv
    rows from June 1 of the current year through yesterday) plus a running
    total of the forecast's own rain_24h added day by day."""
    forecast = forecast.sort_values(["hotspot_id", "date"]).copy()
    results = []
    for hotspot_id, fgroup in forecast.groupby("hotspot_id"):
        year = fgroup["date"].iloc[0].year
        season_start = pd.Timestamp(year=year, month=6, day=1)
        hist = weather_history[
            (weather_history["hotspot_id"] == hotspot_id)
            & (weather_history["date"] >= season_start)
            & (weather_history["date"] < fgroup["date"].min())
        ]
        running_total = hist["rain_24h"].sum()
        fgroup = fgroup.sort_values("date").reset_index(drop=True)
        cumulative = []
        for rain in fgroup["rain_24h"]:
            running_total += rain
            cumulative.append(running_total)
        fgroup["rain_season_cumulative"] = cumulative
        results.append(fgroup)
    return pd.concat(results, ignore_index=True)


def run_forecast_mode():
    for path in (TERRAIN_CSV, FORECAST_CSV, WEATHER_CSV, TRAINING_DATA_CSV):
        if not os.path.exists(path):
            print(f"FATAL: {path} not found.", file=sys.stderr)
            sys.exit(1)

    bundle = load_model()
    terrain = pd.read_csv(TERRAIN_CSV).set_index("hotspot_id")
    priors = load_flood_rate_priors()
    infra_flags = load_infrastructure_flags()
    weather_history = pd.read_csv(WEATHER_CSV, parse_dates=["date"])
    forecast = pd.read_csv(FORECAST_CSV, parse_dates=["date"])
    forecast = compute_forecast_season_cumulative(weather_history, forecast)

    results = []
    for _, row in forecast.iterrows():
        hid = row["hotspot_id"]
        if hid not in terrain.index:
            print(f"FATAL: no terrain features for {hid}.", file=sys.stderr)
            sys.exit(1)
        if hid not in priors.index or hid not in infra_flags.index:
            print(f"FATAL: no hotspot_flood_rate_prior/has_infrastructure_issue for {hid}.", file=sys.stderr)
            sys.exit(1)
        result = predict_for_hotspot(
            bundle, terrain.loc[hid], priors.loc[hid], infra_flags.loc[hid], hid, row["date"].date(),
            row["rain_24h"], row["rain_max_1h"], row["rain_max_3h"], row["rain_prev_3d"],
            row["rain_season_cumulative"], row["soil_moisture_surface"],
        )
        results.append(result)

    out = pd.DataFrame([
        {"hotspot_id": r["hotspot_id"], "date": r["date"], "probability": r["probability"], "tier": r["tier"], **r["features"]}
        for r in results
    ])
    out.to_csv(PREDICTIONS_CSV, index=False)
    print(f"Wrote {PREDICTIONS_CSV} ({len(out)} rows)", file=sys.stderr)
    print(out[["hotspot_id", "date", "probability", "tier"]].to_string(index=False), file=sys.stderr)
    print("\nTier counts:", file=sys.stderr)
    print(out["tier"].value_counts().to_string(), file=sys.stderr)


def run_single_mode(args):
    if not os.path.exists(TERRAIN_CSV):
        print(f"FATAL: {TERRAIN_CSV} not found.", file=sys.stderr)
        sys.exit(1)
    bundle = load_model()
    terrain = pd.read_csv(TERRAIN_CSV).set_index("hotspot_id")
    priors = load_flood_rate_priors()
    infra_flags = load_infrastructure_flags()
    if args.hotspot_id not in terrain.index:
        print(f"FATAL: unknown hotspot_id {args.hotspot_id}.", file=sys.stderr)
        sys.exit(1)

    result = predict_for_hotspot(
        bundle, terrain.loc[args.hotspot_id], priors.loc[args.hotspot_id], infra_flags.loc[args.hotspot_id],
        args.hotspot_id, args.date,
        args.rain_24h, args.rain_max_1h, args.rain_max_3h, args.rain_prev_3d, args.rain_season_cumulative,
        args.soil_moisture_surface,
    )
    print(result, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--forecast", action="store_true", help="score every row in weather_forecast.csv")
    parser.add_argument("--hotspot_id", help="score a single hotspot with ad-hoc rainfall values")
    parser.add_argument("--date", help="date for the single-hotspot scoring (YYYY-MM-DD)")
    parser.add_argument("--rain_24h", type=float)
    parser.add_argument("--rain_max_1h", type=float)
    parser.add_argument("--rain_max_3h", type=float)
    parser.add_argument("--rain_prev_3d", type=float)
    parser.add_argument("--rain_season_cumulative", type=float)
    parser.add_argument("--soil_moisture_surface", type=float)
    args = parser.parse_args()

    if args.forecast:
        run_forecast_mode()
    elif args.hotspot_id:
        required = [args.date, args.rain_24h, args.rain_max_1h, args.rain_max_3h, args.rain_prev_3d,
                    args.rain_season_cumulative, args.soil_moisture_surface]
        if any(v is None for v in required):
            print("FATAL: --hotspot_id requires --date, --rain_24h, --rain_max_1h, --rain_max_3h, "
                  "--rain_prev_3d, --rain_season_cumulative, --soil_moisture_surface.", file=sys.stderr)
            sys.exit(1)
        run_single_mode(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
