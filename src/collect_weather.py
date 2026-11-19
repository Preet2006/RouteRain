"""Phase 4: build data/processed/weather_features.csv from Open-Meteo.

For each verified hotspot, pulls hourly precipitation AND soil moisture
(soil_moisture_0_to_7cm) for the monsoon months (June 1 - September 30) of
every year 2022-2026 from the Open-Meteo Archive API, derives daily
features, and writes one row per (hotspot_id, date) where rain_24h > 0.

Soil moisture was added after a Phase 7 exploratory round found it carries
a genuinely different, non-redundant saturation signal compared to the
rainfall-as-proxy features already in the dataset (direct ground-moisture
reading vs. rainfall total), ranking ~2nd in feature importance and lifting
test ROC-AUC by +0.059 -- well outside this project's ~0.02-0.03 run-to-run
noise margin. It is now a permanent part of every normal run, fetched in
the same API call as precipitation (no new key, no extra request).

(A March 1 - November 30 widening of the date window was tried separately
and reverted: it added 90 training-period negative rows but zero new
positives, diluting the training signal and dropping test ROC-AUC from
0.593 to 0.56. Unrelated to the soil-moisture addition above.)

Daily features (derived from the hourly series, per hotspot-year):
  rain_24h              -- sum of hourly precipitation for that calendar date
  rain_max_1h           -- max single-hour precipitation that date
  rain_max_3h           -- max rolling 3-hour precipitation sum that date
  rain_prev_3d          -- trailing 3-day rain_24h sum, shifted by 1 day so
                           the current day is excluded from its own
                           antecedent window. Computed within a single
                           year's monsoon season only -- it does not bridge
                           across the ~8 month gap between one year's Sep 30
                           and the next year's Jun 1.
  soil_moisture_surface -- same-day mean of soil_moisture_0_to_7cm (m3/m3),
                           analogous to rain_24h being a same-day reading.

Raw hourly API responses are cached to data/external/rainfall_raw/ as
{hotspot_id}_{year}.json before processing, so reprocessing doesn't require
re-fetching. Already-cached hotspot-years are read from disk, not re-pulled,
unless --refresh is passed.

A --forecast run instead hits the Open-Meteo Forecast API for the next 7
days and writes the same five features per hotspot (used by Phase 9's live
demo, not by training). Soil moisture is confirmed available for the full
7-day forecast horizon with real, non-flat variation (verified against a
live pull before this was adopted).

Usage:
    python src/collect_weather.py                  # build historical weather_features.csv
    python src/collect_weather.py --refresh         # ignore cache, re-fetch everything
    python src/collect_weather.py --forecast        # fetch 7-day forecast features instead

Reads:  data/raw/hotspots.csv
Writes: data/external/rainfall_raw/{hotspot_id}_{year}.json  (historical mode)
        data/processed/weather_features.csv                  (historical mode)
        data/processed/weather_forecast.csv                   (--forecast mode)
"""

import argparse
import datetime
import json
import sys
import time

import pandas as pd
import requests

sys.path.insert(0, ".")
from config import HOTSPOTS_CSV, PROCESSED_DIR, RAINFALL_RAW_DIR
import os

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEZONE = "Asia/Kolkata"
YEARS = [2022, 2023, 2024, 2025, 2026]
SEASON_START_MD = "06-01"
SEASON_END_MD = "09-30"
REQUEST_DELAY_SECONDS = 1.0
WEATHER_FEATURES_CSV = os.path.join(PROCESSED_DIR, "weather_features.csv")
WEATHER_FORECAST_CSV = os.path.join(PROCESSED_DIR, "weather_forecast.csv")


def fetch_with_retry(url, params, label):
    last_error = None
    for attempt in (1, 2):
        try:
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code == 200:
                return resp.json()
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
        except requests.RequestException as e:
            last_error = str(e)
        print(f"  attempt {attempt} failed for {label}: {last_error}", file=sys.stderr)
        if attempt == 1:
            time.sleep(REQUEST_DELAY_SECONDS)
    raise RuntimeError(f"FATAL: API call failed twice for {label}: {last_error}")


def hourly_to_daily_features(times, precip, soil_moisture_0_7):
    df = pd.DataFrame({"time": pd.to_datetime(times), "precip": precip})
    df["precip"] = df["precip"].fillna(0.0)
    df["date"] = df["time"].dt.date

    daily = df.groupby("date")["precip"].sum().rename("rain_24h")
    max_1h = df.groupby("date")["precip"].max().rename("rain_max_1h")

    df_sorted = df.sort_values("time").reset_index(drop=True)
    df_sorted["roll_3h"] = df_sorted["precip"].rolling(window=3, min_periods=1).sum()
    max_3h = df_sorted.groupby("date")["roll_3h"].max().rename("rain_max_3h")

    out = pd.concat([daily, max_1h, max_3h], axis=1).reset_index()
    out = out.sort_values("date").reset_index(drop=True)
    out["rain_prev_3d"] = out["rain_24h"].rolling(window=3, min_periods=1).sum().shift(1)
    out["rain_prev_3d"] = out["rain_prev_3d"].fillna(0.0)

    sm_df = pd.DataFrame({"time": pd.to_datetime(times), "sm": soil_moisture_0_7})
    sm_df["date"] = sm_df["time"].dt.date
    daily_sm = sm_df.groupby("date")["sm"].mean().rename("soil_moisture_surface").reset_index()
    out = out.merge(daily_sm, on="date", how="left")
    return out


def collect_historical(hotspots, refresh):
    all_rows = []
    os.makedirs(RAINFALL_RAW_DIR, exist_ok=True)
    for _, hs in hotspots.iterrows():
        for year in YEARS:
            cache_path = os.path.join(RAINFALL_RAW_DIR, f"{hs['hotspot_id']}_{year}.json")
            label = f"{hs['hotspot_id']} ({hs['name']}) {year}"

            if os.path.exists(cache_path) and not refresh:
                print(f"Using cached: {label}", file=sys.stderr)
                with open(cache_path, "r", encoding="utf-8") as f:
                    payload = json.load(f)
            else:
                print(f"Fetching: {label}", file=sys.stderr)
                end_month, end_day = (int(x) for x in SEASON_END_MD.split("-"))
                requested_end = datetime.date(year, end_month, end_day)
                # archive API lags behind the current date by a day or more
                latest_available = datetime.date.today() - datetime.timedelta(days=2)
                end_date = min(requested_end, latest_available)
                if end_date < requested_end:
                    print(f"  NOTE: {year} season end clipped to {end_date} "
                          f"(archive data unavailable past today).", file=sys.stderr)
                params = {
                    "latitude": hs["lat"],
                    "longitude": hs["lon"],
                    "start_date": f"{year}-{SEASON_START_MD}",
                    "end_date": end_date.isoformat(),
                    "hourly": "precipitation,soil_moisture_0_to_7cm",
                    "timezone": TIMEZONE,
                }
                payload = fetch_with_retry(ARCHIVE_URL, params, label)
                with open(cache_path, "w", encoding="utf-8") as f:
                    json.dump(payload, f)
                time.sleep(REQUEST_DELAY_SECONDS)

            hourly = payload.get("hourly", {})
            times = hourly.get("time", [])
            precip = hourly.get("precipitation", [])
            soil_moisture = hourly.get("soil_moisture_0_to_7cm", [])
            if not times or not precip or not soil_moisture:
                raise RuntimeError(f"FATAL: empty hourly data for {label} -- check API response/cache.")

            daily = hourly_to_daily_features(times, precip, soil_moisture)
            daily["hotspot_id"] = hs["hotspot_id"]
            all_rows.append(daily)

    full = pd.concat(all_rows, ignore_index=True)
    full["month"] = pd.to_datetime(full["date"]).dt.month
    result = full[full["rain_24h"] > 0].copy()
    result = result[["hotspot_id", "date", "rain_24h", "rain_max_1h", "rain_max_3h", "rain_prev_3d", "soil_moisture_surface"]]
    result = result.sort_values(["hotspot_id", "date"]).reset_index(drop=True)
    return result


def collect_forecast(hotspots):
    all_rows = []
    for _, hs in hotspots.iterrows():
        label = f"{hs['hotspot_id']} ({hs['name']}) forecast"
        print(f"Fetching: {label}", file=sys.stderr)
        params = {
            "latitude": hs["lat"],
            "longitude": hs["lon"],
            "hourly": "precipitation,soil_moisture_0_to_7cm",
            "forecast_days": 7,
            "timezone": TIMEZONE,
        }
        payload = fetch_with_retry(FORECAST_URL, params, label)
        time.sleep(REQUEST_DELAY_SECONDS)

        hourly = payload.get("hourly", {})
        times = hourly.get("time", [])
        precip = hourly.get("precipitation", [])
        soil_moisture = hourly.get("soil_moisture_0_to_7cm", [])
        if not times or not precip or not soil_moisture:
            raise RuntimeError(f"FATAL: empty hourly forecast data for {label}.")

        daily = hourly_to_daily_features(times, precip, soil_moisture)
        daily["hotspot_id"] = hs["hotspot_id"]
        daily["name"] = hs["name"]
        all_rows.append(daily)

    full = pd.concat(all_rows, ignore_index=True)
    full = full[["hotspot_id", "name", "date", "rain_24h", "rain_max_1h", "rain_max_3h", "rain_prev_3d", "soil_moisture_surface"]]
    full = full.sort_values(["hotspot_id", "date"]).reset_index(drop=True)
    return full


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="ignore rainfall_raw cache, re-fetch everything")
    parser.add_argument("--forecast", action="store_true", help="fetch 7-day forecast features instead of historical")
    args = parser.parse_args()

    if not os.path.exists(HOTSPOTS_CSV):
        print(f"FATAL: {HOTSPOTS_CSV} not found.", file=sys.stderr)
        sys.exit(1)
    hotspots = pd.read_csv(HOTSPOTS_CSV)
    if hotspots.empty:
        print("FATAL: hotspots.csv has no rows.", file=sys.stderr)
        sys.exit(1)

    if args.forecast:
        result = collect_forecast(hotspots)
        result.to_csv(WEATHER_FORECAST_CSV, index=False)
        print(f"\nWrote {WEATHER_FORECAST_CSV} ({len(result)} rows)", file=sys.stderr)
        print(result.to_string(index=False), file=sys.stderr)
    else:
        result = collect_historical(hotspots, args.refresh)
        result.to_csv(WEATHER_FEATURES_CSV, index=False)
        print(f"\nWrote {WEATHER_FEATURES_CSV} ({len(result)} rows)", file=sys.stderr)

        print("\nDistinct rainy days per hotspot:", file=sys.stderr)
        counts = result.groupby("hotspot_id").size().reindex(hotspots["hotspot_id"], fill_value=0)
        for hid, count in counts.items():
            flag = " <-- SUSPICIOUSLY LOW" if count < 20 else ""
            print(f"  {hid}: {count}{flag}", file=sys.stderr)

        max_row = result.loc[result["rain_24h"].idxmax()]
        print(f"\nMax single-day rain_24h observed: {max_row['rain_24h']:.1f}mm "
              f"({max_row['hotspot_id']} on {max_row['date']})", file=sys.stderr)
        print(f"soil_moisture_surface range: [{result['soil_moisture_surface'].min():.4f}, "
              f"{result['soil_moisture_surface'].max():.4f}], mean: {result['soil_moisture_surface'].mean():.4f}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
