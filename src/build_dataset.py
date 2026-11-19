"""Phase 6: assemble the final model-ready training table.

Joins:
  1. weather_features.csv, filtered to rain_24h > config.RAIN_THRESHOLD_MM
     -- this is the full candidate set of (hotspot_id, date) rainy days.
     soil_moisture_surface rides along as a plain column from
     weather_features.csv (Phase 4), no separate join needed.
  2. terrain_features.csv, left-joined on hotspot_id (static per hotspot).
  3. infrastructure_issues.csv, left-joined on hotspot_id (static per
     hotspot, has_infrastructure_issue).
  4. flood_labels_clean.csv, left-joined on (hotspot_id, date) within
     config.DATE_MATCH_TOLERANCE_DAYS -- unmatched candidate rows become
     flooded=0 (the negative examples). Matching uses nearest-date-within-
     tolerance per hotspot, since a single reported flood event can
     legitimately match more than one nearby rainy day.

Adds engineered features:
  month                      -- calendar month of `date`.
  rain_season_cumulative     -- total rain_24h for that hotspot, summed from
                                June 1 of that date's year up to and
                                including the current date. Computed from
                                the FULL weather_features.csv (not just the
                                filtered candidate rows), since zero-rain
                                days correctly contribute 0 to the running
                                total either way.
  hotspot_flood_rate_prior   -- a smoothed, leakage-safe historical flood
                                rate per hotspot, computed ONLY from
                                2022-2024 (training-period) rows:
                                (flooded_count_train + k*global_train_rate)
                                / (candidate_days_train + k), k=5 Laplace
                                smoothing. Computed ONCE per hotspot from
                                training data only, then applied as a fixed
                                constant to every row for that hotspot in
                                BOTH train and test. This script explicitly
                                verifies (and the report states) that the
                                value is identical across all of a
                                hotspot's rows regardless of year -- if it
                                weren't, that would mean 2025-2026 outcomes
                                leaked into a feature, a serious bug.

soil_moisture_surface (same-day mean soil_moisture_0_to_7cm, m3/m3) was
promoted from a Phase 7 exploratory experiment to this permanent pipeline
after it ranked ~2nd in RandomForest feature importance and lifted test
ROC-AUC by +0.059 -- well outside this project's ~0.02-0.03 run-to-run
noise margin. It is a direct ground-saturation measurement, a genuinely
different signal from the rainfall-as-proxy features already present.

Usage:
    python src/build_dataset.py

Reads:  data/processed/weather_features.csv
        data/processed/terrain_features.csv
        data/raw/infrastructure_issues.csv
        data/processed/flood_labels_clean.csv
Writes: data/processed/training_data.csv
            (hotspot_id, date, rain_24h, rain_max_1h, rain_max_3h,
             rain_prev_3d, soil_moisture_surface, rain_season_cumulative,
             hotspot_flood_rate_prior, has_infrastructure_issue,
             elevation_m, slope_deg, sink_depth_m, catchment_cells, month,
             flooded)
"""

import argparse
import sys

import pandas as pd

sys.path.insert(0, ".")
from config import PROCESSED_DIR, RAIN_THRESHOLD_MM, DATE_MATCH_TOLERANCE_DAYS
import os

WEATHER_CSV = os.path.join(PROCESSED_DIR, "weather_features.csv")
TERRAIN_CSV = os.path.join(PROCESSED_DIR, "terrain_features.csv")
LABELS_CSV = os.path.join(PROCESSED_DIR, "flood_labels_clean.csv")
INFRASTRUCTURE_CSV = os.path.join("data", "raw", "infrastructure_issues.csv")
OUTPUT_CSV = os.path.join(PROCESSED_DIR, "training_data.csv")

TRAIN_YEARS = (2022, 2024)
TEST_YEARS = (2025, 2026)
FLOOD_RATE_SMOOTHING_K = 5

FINAL_COLUMNS = [
    "hotspot_id", "date", "rain_24h", "rain_max_1h", "rain_max_3h", "rain_prev_3d",
    "soil_moisture_surface", "rain_season_cumulative", "hotspot_flood_rate_prior",
    "has_infrastructure_issue",
    "elevation_m", "slope_deg", "sink_depth_m", "catchment_cells", "month", "flooded",
]


def match_labels_per_hotspot(weather, labels, tolerance_days):
    """For each (hotspot_id, date) in weather, find the nearest flood_labels_clean
    row at the same hotspot within tolerance_days, if any. Returns weather with
    flooded (0/1) and matched_sources (for provenance checking, dropped later)."""
    tolerance = pd.Timedelta(days=tolerance_days)
    matched_parts = []

    for hotspot_id, w_group in weather.groupby("hotspot_id"):
        w_group = w_group.sort_values("date").reset_index(drop=True)
        l_group = labels[labels["hotspot_id"] == hotspot_id].sort_values("date").reset_index(drop=True)

        if l_group.empty:
            w_group["flooded"] = 0
            w_group["matched_sources"] = None
            matched_parts.append(w_group)
            continue

        merged = pd.merge_asof(
            w_group, l_group[["date", "sources"]],
            on="date", direction="nearest", tolerance=tolerance,
        )
        merged["flooded"] = merged["sources"].notna().astype(int)
        merged = merged.rename(columns={"sources": "matched_sources"})
        matched_parts.append(merged)

    return pd.concat(matched_parts, ignore_index=True)


def add_rain_season_cumulative(candidates, full_weather):
    """Cumulative rain_24h per hotspot, from June 1 of that date's year
    through the current date, computed against the FULL (unfiltered)
    weather series so zero/sub-threshold rain days are correctly included
    in the running total."""
    full_weather = full_weather.copy()
    full_weather["year"] = full_weather["date"].dt.year
    full_weather = full_weather.sort_values(["hotspot_id", "year", "date"])
    full_weather["rain_season_cumulative"] = (
        full_weather.groupby(["hotspot_id", "year"])["rain_24h"].cumsum()
    )
    lookup = full_weather[["hotspot_id", "date", "rain_season_cumulative"]]
    return candidates.merge(lookup, on=["hotspot_id", "date"], how="left")


def add_hotspot_flood_rate_prior(joined, train_years, k):
    """Leakage-safe per-hotspot flood rate: computed from training-period
    rows only, then broadcast as a fixed constant to every row (train+test)
    for that hotspot."""
    joined = joined.copy()
    joined["year"] = joined["date"].dt.year
    train_mask = joined["year"].between(*train_years)
    train = joined[train_mask]

    global_rate = train["flooded"].mean()
    per_hotspot = train.groupby("hotspot_id")["flooded"].agg(["sum", "count"])
    per_hotspot["hotspot_flood_rate_prior"] = (
        (per_hotspot["sum"] + k * global_rate) / (per_hotspot["count"] + k)
    )

    joined = joined.merge(
        per_hotspot[["hotspot_flood_rate_prior"]], on="hotspot_id", how="left"
    )
    return joined, per_hotspot[["hotspot_flood_rate_prior"]], global_rate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    for path in (WEATHER_CSV, TERRAIN_CSV, LABELS_CSV, INFRASTRUCTURE_CSV):
        if not os.path.exists(path):
            print(f"FATAL: {path} not found.", file=sys.stderr)
            sys.exit(1)

    weather = pd.read_csv(WEATHER_CSV, parse_dates=["date"])
    terrain = pd.read_csv(TERRAIN_CSV)
    labels = pd.read_csv(LABELS_CSV, parse_dates=["date"])
    infrastructure = pd.read_csv(INFRASTRUCTURE_CSV)[["hotspot_id", "has_infrastructure_issue"]]

    candidates = weather[weather["rain_24h"] > RAIN_THRESHOLD_MM].copy()
    if candidates.empty:
        print(f"FATAL: no rows with rain_24h > {RAIN_THRESHOLD_MM}mm.", file=sys.stderr)
        sys.exit(1)
    if candidates["soil_moisture_surface"].isna().any():
        print("FATAL: some candidate rows have no soil_moisture_surface -- "
              "check weather_features.csv was built with the current collect_weather.py.", file=sys.stderr)
        sys.exit(1)

    joined = match_labels_per_hotspot(candidates, labels, DATE_MATCH_TOLERANCE_DAYS)

    joined = joined.merge(terrain, on="hotspot_id", how="left", suffixes=("", "_terrain"))
    missing_terrain = joined[joined["elevation_m"].isna()]["hotspot_id"].unique()
    if len(missing_terrain) > 0:
        print(f"FATAL: hotspots with no terrain features after join: {list(missing_terrain)}", file=sys.stderr)
        sys.exit(1)

    joined = joined.merge(infrastructure, on="hotspot_id", how="left")
    missing_infra = joined[joined["has_infrastructure_issue"].isna()]["hotspot_id"].unique()
    if len(missing_infra) > 0:
        print(f"FATAL: hotspots with no infrastructure_issues.csv entry: {list(missing_infra)}", file=sys.stderr)
        sys.exit(1)

    joined["month"] = joined["date"].dt.month

    joined = add_rain_season_cumulative(joined, weather)
    if joined["rain_season_cumulative"].isna().any():
        print("FATAL: some rows have no rain_season_cumulative after merge.", file=sys.stderr)
        sys.exit(1)

    joined, prior_table, global_rate = add_hotspot_flood_rate_prior(joined, TRAIN_YEARS, FLOOD_RATE_SMOOTHING_K)

    # Leakage check: the prior must be identical across all rows of a hotspot,
    # regardless of year (train or test) -- otherwise test-period outcomes
    # would have leaked into this feature.
    n_unique_per_hotspot = joined.groupby("hotspot_id")["hotspot_flood_rate_prior"].nunique()
    leaky_hotspots = n_unique_per_hotspot[n_unique_per_hotspot > 1]
    if len(leaky_hotspots) > 0:
        print(f"FATAL: hotspot_flood_rate_prior is not constant for: {list(leaky_hotspots.index)} -- leakage bug.", file=sys.stderr)
        sys.exit(1)
    print("Leakage check: hotspot_flood_rate_prior is identical across all rows per hotspot (train+test): PASS", file=sys.stderr)
    print(f"Global training flood rate (smoothing anchor): {global_rate:.4f}", file=sys.stderr)
    print("\nPer-hotspot flood_rate_prior (training-period-only, applied to all rows):", file=sys.stderr)
    print(prior_table.to_string(), file=sys.stderr)

    # --- mandatory sanity checks ---
    total_rows = len(joined)
    pct_positive = joined["flooded"].mean() * 100
    print(f"\nTotal rows: {total_rows}", file=sys.stderr)
    print(f"Overall class balance: {pct_positive:.2f}% positive", file=sys.stderr)
    if pct_positive > 60:
        print(f"WARNING: class balance {pct_positive:.2f}% > 60% -- rainfall threshold likely too high, missing negatives.", file=sys.stderr)
    elif pct_positive < 5:
        print(f"WARNING: class balance {pct_positive:.2f}% < 5% -- label collection may have missed events, or threshold too strict.", file=sys.stderr)
    elif not (10 <= pct_positive <= 40):
        print(f"NOTE: overall class balance {pct_positive:.2f}% is outside the 10-40% expected range.", file=sys.stderr)
    elif not (15 <= pct_positive <= 30):
        print(f"NOTE: overall class balance {pct_positive:.2f}% is outside the tighter 15-30% expectation (but within 10-40%).", file=sys.stderr)

    print("\nPer-hotspot class balance:", file=sys.stderr)
    per_hotspot = joined.groupby("hotspot_id").agg(
        n_rows=("flooded", "size"), n_positive=("flooded", "sum")
    )
    per_hotspot["pct_positive"] = (per_hotspot["n_positive"] / per_hotspot["n_rows"] * 100).round(2)
    print(per_hotspot.to_string(), file=sys.stderr)

    zero_row_hotspots = set(terrain["hotspot_id"]) - set(joined["hotspot_id"])
    if zero_row_hotspots:
        print(f"FATAL: hotspots with zero rows in final dataset: {zero_row_hotspots}", file=sys.stderr)
        sys.exit(1)
    print(f"\nNo hotspot has zero rows: PASS ({len(set(joined['hotspot_id']))} of {len(terrain)} hotspots present)", file=sys.stderr)

    positive_rows = joined[joined["flooded"] == 1]
    untraceable = positive_rows[positive_rows["matched_sources"].isna() | (positive_rows["matched_sources"] == "")]
    if len(untraceable) > 0:
        print(f"FATAL: {len(untraceable)} positive-labeled rows have no traceable source_url.", file=sys.stderr)
        sys.exit(1)
    print(f"All {len(positive_rows)} positive rows trace to a real source_url: PASS", file=sys.stderr)

    final = joined[FINAL_COLUMNS].sort_values(["hotspot_id", "date"]).reset_index(drop=True)
    final.to_csv(OUTPUT_CSV, index=False)
    print(f"\nWrote {OUTPUT_CSV} ({len(final)} rows)", file=sys.stderr)


if __name__ == "__main__":
    main()
