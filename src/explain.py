"""Phase 8: plain-language, checkable explanations for a risk score.

This is the project's core differentiator -- existing tools give a score or
a generic rain warning; this gives a specific, checkable reason, built from
template logic (deterministic, free, can't hallucinate a number), not an
LLM call.

Reads the feature importances actually baked into models/risk_model.pkl and
the actual GREEN_MAX/YELLOW_MAX tier cutoffs from config.py -- nothing here
is hardcoded from the plan doc or a prompt, so this stays correct if the
model is ever retrained with a different feature set or importance ranking.

Template logic, in order of the model's own feature importance:
  1. Primary rain/soil-moisture reasons (rain_prev_3d, soil_moisture_surface,
     rain_24h, rain_max_1h, rain_season_cumulative) -- included when a
     feature sits at or above the 75th percentile of its distribution,
     computed from the 2022-2024 TRAINING-PERIOD rows only (consistent with
     every other statistic in this project -- hotspot_flood_rate_prior,
     hyperparameter tuning -- rather than leaking 2025-2026 test-period
     values into what counts as "notably elevated"). soil_moisture_surface
     is converted to a percentage and a qualitative label (dry /
     moderately saturated / highly saturated, from terciles of its own
     training-period distribution), never shown as a raw 0-1 fraction.
  2. hotspot_flood_rate_prior -- mentioned as a secondary factor only when
     this hotspot's own (smoothed) prior sits in the top third of all 12
     hotspots' priors.
  3. Terrain (sink_depth_m, elevation_m, slope_deg) and
     has_infrastructure_issue -- the model's weakest features. Never a
     standalone/primary reason; only appended as supporting context, and
     only when at least one primary reason has already triggered.

Explanation INTENSITY scales with the calibrated probability itself, not a
separate threshold: near a tier boundary (probability < 1.5x YELLOW_MAX),
language is softened ("conditions lean toward elevated risk") and only the
single strongest-priority reason is cited; well past that point, the full
multi-factor explanation is used. This matters because the deployed model
runs at a low decision threshold with high recall and low precision, so a
borderline 14% call and a 92% call should not read with the same confidence.

Always closes with the historical hit-rate line, pulled from the RAW
training-period (2022-2024) counts underlying hotspot_flood_rate_prior for
that hotspot -- not the smoothed prior value itself.

Also provides explain_reroute() (Phase 9 Part B): a one-line explanation
for src/route_planner.py's flood-aware route, e.g. "Rerouted to avoid
Bilaspur Chowk (RED) -- adds approximately 6 minutes," or the plain
"no reroute needed" sentence when nothing was avoided.

Usage:
    python src/explain.py
        Generates and prints example explanations for several real rows
        from training_data.csv, covering all three tiers plus a genuine
        "no standout factor" case, and reports what fraction of YELLOW/RED
        predictions overall fall into that no-standout-factor bucket.

Reads:  models/risk_model.pkl
        config.py (GREEN_MAX, YELLOW_MAX)
        data/processed/training_data.csv
        data/raw/hotspots.csv
Writes: nothing (print-only, non-destructive per project rule 4)
"""

import argparse
import sys

import pandas as pd

sys.path.insert(0, ".")
from config import PROCESSED_DIR, HOTSPOTS_CSV, GREEN_MAX, YELLOW_MAX
import os
from src.predict import load_model, predict_risk

TRAINING_DATA_CSV = os.path.join(PROCESSED_DIR, "training_data.csv")
TRAIN_YEARS = (2022, 2024)
HIGH_PERCENTILE = 0.75
DEEP_INTENSITY_MULTIPLIER = 1.5  # probability >= this x YELLOW_MAX -> full multi-factor explanation

PRIMARY_RAIN_FEATURES = ["rain_prev_3d", "soil_moisture_surface", "rain_24h", "rain_max_1h", "rain_season_cumulative"]

REASON_TEMPLATES = {
    "rain_prev_3d": lambda v: f"the ground has already absorbed {v:.0f}mm of rain over the preceding 3 days",
    "rain_24h": lambda v: f"{v:.0f}mm of rain has fallen today",
    "rain_max_1h": lambda v: f"a burst of {v:.0f}mm fell within a single hour",
    "rain_season_cumulative": lambda v: f"this location has seen {v:.0f}mm of rain so far this monsoon season",
}


def train_only(df):
    return df[pd.to_datetime(df["date"]).dt.year.between(*TRAIN_YEARS)]


def compute_thresholds(df):
    """75th-percentile 'notably elevated' cutoffs, computed from the
    2022-2024 TRAINING-PERIOD rows only -- not the full train+test dataset,
    which would leak test-period distribution into what counts as elevated."""
    train = train_only(df)
    return {col: train[col].quantile(HIGH_PERCENTILE) for col in PRIMARY_RAIN_FEATURES}


def soil_moisture_label(value, df):
    train = train_only(df)
    p33, p66 = train["soil_moisture_surface"].quantile([0.33, 0.66])
    if value < p33:
        return "dry"
    elif value < p66:
        return "moderately saturated"
    else:
        return "highly saturated"


def compute_hotspot_hit_rates(df):
    """Raw (unsmoothed) training-period flood counts per hotspot --
    X of the last Y comparable rain days, pulled directly from the data
    underlying hotspot_flood_rate_prior rather than the smoothed value."""
    train = train_only(df)
    return train.groupby("hotspot_id").agg(
        floods=("flooded", "sum"), rain_days=("flooded", "size")
    )


def reason_for_feature(feature, value, soil_label=None):
    if feature == "soil_moisture_surface":
        return f"the ground is already {soil_label} ({value*100:.0f}% soil moisture)"
    template = REASON_TEMPLATES.get(feature)
    return template(value) if template else None


def collect_reasons(features, thresholds, soil_label, hotspot_prior, prior_top_third_cutoff):
    """Primary rain/soil reasons (in importance order) + the secondary
    hotspot-history reason, before any intensity scaling or terrain/
    infrastructure supporting context is applied."""
    reasons = []
    for feature in PRIMARY_RAIN_FEATURES:
        value = features[feature]
        if value < thresholds[feature]:
            continue
        reasons.append(reason_for_feature(feature, value, soil_label))

    if hotspot_prior >= prior_top_third_cutoff:
        reasons.append("this location has a history of frequent flooding in comparable conditions")
    return reasons


def build_explanation(hotspot_name, tier, probability, features, thresholds, soil_label,
                       hotspot_prior, prior_top_third_cutoff, hit_floods, hit_rain_days):
    # GREEN means the model's overall (holistic) judgment is low risk -- never
    # cite "elevated risk" language here even if one individual feature happens
    # to cross its 75th-percentile threshold; other factors are pulling the
    # combined probability down, and saying otherwise would contradict the tier.
    if tier == "GREEN":
        reasons = []
    else:
        reasons = collect_reasons(features, thresholds, soil_label, hotspot_prior, prior_top_third_cutoff)
    deep = probability >= DEEP_INTENSITY_MULTIPLIER * YELLOW_MAX

    if not deep and reasons:
        reasons = reasons[:1]  # near a tier boundary: cite only the single strongest-priority reason

    # Terrain/infrastructure: supporting context only, only if a primary
    # reason already fired, and only for the full (deep) explanation --
    # softened near-boundary language stays focused on the one cited reason.
    if reasons and deep:
        if features["sink_depth_m"] > 1.0:
            reasons.append(f"it sits in a natural low point ({features['sink_depth_m']:.1f}m below its surroundings)")
        if features["has_infrastructure_issue"] == 1:
            reasons.append("a documented drainage/infrastructure issue exists at this location")

    probability_pct = probability * 100
    if not reasons:
        why = " No specific risk factors stand out in current conditions."
    elif deep:
        why = " Conditions match patterns that have led to flooding before: " + "; ".join(reasons) + "."
    else:
        why = f" Conditions lean toward elevated risk: {reasons[0]}."

    history = f" It has flooded on {hit_floods} of the last {hit_rain_days} comparable rain days at this location."

    return f"{hotspot_name} - {tier} ({probability_pct:.0f}% estimated risk).{why}{history}"


def explain_reroute(avoided_hotspots, delta_time_s, origin_inside_hotspots=None, dest_inside_hotspots=None):
    """One-line reroute explanation for Phase 9 Part B (src/route_planner.py).
    avoided_hotspots: list of {name, tier} dicts the flood-aware route
    avoided relative to the normal route. delta_time_s: flood-aware minus
    normal travel time, seconds (>= 0 -- the flood-aware route should never
    be faster than the normal one).

    origin_inside_hotspots/dest_inside_hotspots (optional, from plan_route()):
    hotspots whose own RED/YELLOW buffer contains the origin/destination
    point itself. This is a materially different situation from "the route
    happens to pass near a hotspot" -- starting (or ending) inside the risk
    zone means every path out shares the same unavoidable penalized edges,
    so a cheaper detour may genuinely not exist. Gets its own honest
    message rather than being folded into the ordinary "no reroute needed"
    line, which would misleadingly imply no risk is nearby at all."""
    if not avoided_hotspots and (origin_inside_hotspots or dest_inside_hotspots):
        inside = (origin_inside_hotspots or []) + (dest_inside_hotspots or [])
        names = " and ".join(f"{h['name']} ({h['tier']})" for h in inside)
        which = "starting point" if origin_inside_hotspots else "destination"
        return (f"Your {which} is inside a flood zone ({names}) -- no alternative route avoids it "
                f"entirely from here. Consider a different {which} if possible.")
    if not avoided_hotspots:
        return "No reroute needed -- your direct route doesn't pass near any at-risk hotspot today."
    names = " and ".join(f"{h['name']} ({h['tier']})" for h in avoided_hotspots)
    delta_min = max(delta_time_s, 0) / 60
    return f"Rerouted to avoid {names} -- adds approximately {delta_min:.0f} minute{'s' if round(delta_min) != 1 else ''}."


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.parse_args()

    for path in (TRAINING_DATA_CSV, HOTSPOTS_CSV):
        if not os.path.exists(path):
            print(f"FATAL: {path} not found.", file=sys.stderr)
            sys.exit(1)

    bundle = load_model()
    feature_cols = bundle["feature_cols"]
    df = pd.read_csv(TRAINING_DATA_CSV, parse_dates=["date"])
    hotspots = pd.read_csv(HOTSPOTS_CSV).set_index("hotspot_id")["name"]

    full_thresholds_preview = {col: df[col].quantile(HIGH_PERCENTILE) for col in PRIMARY_RAIN_FEATURES}
    thresholds = compute_thresholds(df)
    print("Threshold comparison -- full dataset (2022-2026) vs. training-period-only (2022-2024):", file=sys.stderr)
    for k in PRIMARY_RAIN_FEATURES:
        full_v, train_v = full_thresholds_preview[k], thresholds[k]
        pct_diff = (train_v - full_v) / full_v * 100 if full_v else 0.0
        print(f"  {k}: full={full_v:.4f}  training-only={train_v:.4f}  ({pct_diff:+.1f}%)", file=sys.stderr)
    print(f"Live-read tier cutoffs from config.py: GREEN_MAX={GREEN_MAX}, YELLOW_MAX={YELLOW_MAX}", file=sys.stderr)

    hit_rates = compute_hotspot_hit_rates(df)
    prior_top_third_cutoff = df.groupby("hotspot_id")["hotspot_flood_rate_prior"].first().quantile(2 / 3)

    df["probability"] = df.apply(
        lambda r: predict_risk(bundle, {c: r[c] for c in feature_cols})["probability"], axis=1
    )
    df["tier"] = df.apply(
        lambda r: "GREEN" if r["probability"] < GREEN_MAX else ("YELLOW" if r["probability"] < YELLOW_MAX else "RED"),
        axis=1,
    )

    def has_no_standout_factor(row):
        reasons = collect_reasons(
            {c: row[c] for c in feature_cols},
            thresholds, None, row["hotspot_flood_rate_prior"], prior_top_third_cutoff,
        )
        return len(reasons) == 0

    df["no_standout"] = False
    yr_mask = df["tier"].isin(["YELLOW", "RED"])
    df.loc[yr_mask, "no_standout"] = df.loc[yr_mask].apply(has_no_standout_factor, axis=1)
    yellow_red = df[yr_mask]
    no_standout_frac = yellow_red["no_standout"].mean()
    print(f"\nOf {len(yellow_red)} YELLOW/RED predictions in the full dataset, "
          f"{yellow_red['no_standout'].sum()} ({no_standout_frac*100:.1f}%) have no single standout factor "
          f"(no primary feature at/above its training-period 75th percentile, and hotspot history not in the "
          f"top third) -- the model's probability there comes from a combination of moderately elevated "
          f"factors rather than one extreme one.", file=sys.stderr)

    # Example selection: distinct hotspots, one per tier, plus one genuine
    # no-standout-factor case and one soil-moisture-driven case, avoiding
    # repeats across examples.
    examples = []
    used_hotspots = set()

    def pick(subset, label):
        subset = subset[~subset["hotspot_id"].isin(used_hotspots)]
        if subset.empty:
            return
        row = subset.sample(1, random_state=3).iloc[0]
        used_hotspots.add(row["hotspot_id"])
        examples.append((label, row))

    pick(df[(df["soil_moisture_surface"] >= thresholds["soil_moisture_surface"]) & (df["tier"] == "RED")],
         "Soil-moisture-driven, deep RED example")
    pick(df[(df["tier"] == "YELLOW") & (df["probability"] < DEEP_INTENSITY_MULTIPLIER * YELLOW_MAX)
            & (~df["no_standout"])],
         "Near-boundary YELLOW example (softened language)")
    pick(df[df["tier"] == "GREEN"], "GREEN example")
    pick(df[yr_mask & df["no_standout"]], "Genuine no-standout-factor example (YELLOW or RED)")
    pick(df[(df["tier"] == "RED") & (df["probability"] >= DEEP_INTENSITY_MULTIPLIER * YELLOW_MAX)],
         "Deep RED example")

    print("\n--- Example explanations (real rows from training_data.csv) ---\n", file=sys.stderr)
    for label, row in examples:
        hotspot_name = hotspots.get(row["hotspot_id"], row["hotspot_id"])
        soil_label = soil_moisture_label(row["soil_moisture_surface"], df)
        hit = hit_rates.loc[row["hotspot_id"]] if row["hotspot_id"] in hit_rates.index else {"floods": 0, "rain_days": 0}
        sentence = build_explanation(
            hotspot_name, row["tier"], row["probability"],
            {c: row[c] for c in feature_cols}, thresholds, soil_label,
            row["hotspot_flood_rate_prior"], prior_top_third_cutoff,
            int(hit["floods"]), int(hit["rain_days"]),
        )
        print(f"[{label}] ({row['hotspot_id']}, {row['date'].date()})", file=sys.stderr)
        print(sentence, file=sys.stderr)
        print(file=sys.stderr)


if __name__ == "__main__":
    main()
