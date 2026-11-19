"""RouteRain JSON API and production static-file host."""
from __future__ import annotations

import datetime as dt
import math
import os
import sys
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path

import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from config import HOTSPOTS_CSV, PROCESSED_DIR, GREEN_MAX, YELLOW_MAX
from src.collect_weather import collect_forecast
from src.explain import (build_explanation, compute_hotspot_hit_rates,
                         compute_thresholds, explain_reroute, soil_moisture_label)
from src.predict import (compute_forecast_season_cumulative, load_flood_rate_priors,
                         load_infrastructure_flags, load_model, predict_for_hotspot,
                         predict_risk)
from src.route_planner import load_road_graph, plan_route, resolve_location, warm_up
from app.mobile_api import router as mobile_router

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIST = ROOT / "frontend" / "dist"
WEATHER = os.path.join(PROCESSED_DIR, "weather_features.csv")
TERRAIN = os.path.join(PROCESSED_DIR, "terrain_features.csv")
TRAINING = os.path.join(PROCESSED_DIR, "training_data.csv")


@asynccontextmanager
async def lifespan(_app):
    """Load the road graph and build the routing caches at startup (about 10 s) so the first
    request is not slow. A missing graph file does not stop the server: /health reports
    graph_loaded=false and routing endpoints fail with their usual clear message.
    Set ROUTERAIN_SKIP_WARMUP=1 to skip this (faster dev restarts)."""
    if os.environ.get("ROUTERAIN_SKIP_WARMUP") != "1":
        try:
            warm_up()
        except FileNotFoundError as exc:
            print(f"WARNING: startup warm-up skipped: {exc}", file=sys.stderr)
    yield


app = FastAPI(title="RouteRain API", version="1.0.0", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; script-src 'self'; "
        "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    )
    return response


@lru_cache(maxsize=1)
def static_bundle():
    hotspots = pd.read_csv(HOTSPOTS_CSV)
    terrain = pd.read_csv(TERRAIN).set_index("hotspot_id")
    training = pd.read_csv(TRAINING, parse_dates=["date"])
    priors, infra = load_flood_rate_priors(), load_infrastructure_flags()
    return (hotspots, terrain, training, priors, infra, compute_thresholds(training),
            compute_hotspot_hit_rates(training),
            training.groupby("hotspot_id")["hotspot_flood_rate_prior"].first().quantile(2 / 3))


@lru_cache(maxsize=1)
def model_bundle():
    return load_model()


_forecast_cache: dict = {"at": None, "rows": None}


def to_json_safe(value):
    """Convert pandas/NumPy values into strict JSON primitives before returning API data."""
    if isinstance(value, dict):
        return {str(key): to_json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return to_json_safe(value.item())
    if isinstance(value, (dt.datetime, dt.date, pd.Timestamp)):
        return value.isoformat()
    if pd.isna(value):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def dashboard_data():
    now = dt.datetime.now(dt.timezone.utc)
    if _forecast_cache["rows"] is None or (now - _forecast_cache["at"]).total_seconds() > 600:
        hotspots, terrain, training, priors, infra, thresholds, hits, cutoff = static_bundle()
        forecast = collect_forecast(hotspots)
        forecast["date"] = pd.to_datetime(forecast["date"])
        weather_history = pd.read_csv(WEATHER, parse_dates=["date"])
        forecast = compute_forecast_season_cumulative(weather_history, forecast)
        bundle, results = model_bundle(), []
        for _, hs in hotspots.iterrows():
            rows = forecast[forecast.hotspot_id == hs.hotspot_id].sort_values("date")
            if rows.empty:
                continue
            row = rows.iloc[0]
            result = predict_for_hotspot(bundle, terrain.loc[hs.hotspot_id], priors.loc[hs.hotspot_id],
                infra.loc[hs.hotspot_id], hs.hotspot_id, row.date, row.rain_24h, row.rain_max_1h,
                row.rain_max_3h, row.rain_prev_3d, row.rain_season_cumulative, row.soil_moisture_surface)
            result.update(name=hs.name, lat=float(hs.lat), lon=float(hs.lon))
            soil = soil_moisture_label(result["features"]["soil_moisture_surface"], training)
            hit = hits.loc[hs.hotspot_id] if hs.hotspot_id in hits.index else {"floods": 0, "rain_days": 0}
            result["explanation"] = build_explanation(hs.name, result["tier"], result["probability"],
                result["features"], thresholds, soil, result["features"]["hotspot_flood_rate_prior"], cutoff,
                int(hit["floods"]), int(hit["rain_days"]))
            results.append(result)
        _forecast_cache.update(at=now, rows=results)
    return to_json_safe({"hotspots": _forecast_cache["rows"], "fetched_at": _forecast_cache["at"].isoformat(),
            "tiers": {tier: sum(r["tier"] == tier for r in _forecast_cache["rows"])
                      for tier in ("GREEN", "YELLOW", "RED")},
            "thresholds": {"green_max": GREEN_MAX, "yellow_max": YELLOW_MAX}})


@app.get("/api/dashboard")
def get_dashboard():
    try:
        return dashboard_data()
    except FileNotFoundError as exc:
        raise HTTPException(503, "Project data is incomplete. Check model, terrain, training, and road graph setup.") from exc
    except Exception as exc:
        raise HTTPException(502, "Forecast could not be refreshed. Please try again shortly.") from exc


@lru_cache(maxsize=1)
def historical_scenarios():
    hotspots, _, training, _, _, thresholds, hits, prior_cutoff = static_bundle()
    bundle = model_bundle()
    hotspot_info = hotspots.set_index("hotspot_id")
    flood_dates = set(training.loc[training["flooded"] == 1, "date"].dt.date)
    historical = training[training["date"].dt.date.isin(flood_dates)].copy()
    cols = bundle["feature_cols"]
    scenarios = {}
    for _, row in historical.iterrows():
        result = predict_risk(bundle, {c: row[c] for c in cols})
        hid = row.hotspot_id
        hs = hotspot_info.loc[hid]
        hit = hits.loc[hid] if hid in hits.index else {"floods": 0, "rain_days": 0}
        features = result["features"]
        soil = soil_moisture_label(features["soil_moisture_surface"], training)
        explanation = build_explanation(hs["name"], result["tier"], result["probability"], features,
            thresholds, soil, features["hotspot_flood_rate_prior"], prior_cutoff,
            int(hit["floods"]), int(hit["rain_days"]))
        date = row.date.date().isoformat()
        scenario = scenarios.setdefault(date, {"date": date, "hotspots": [], "flood_reports": 0})
        scenario["hotspots"].append({"hotspot_id": hid, "name": hs["name"], "lat": hs["lat"],
            "lon": hs["lon"], "date": date, "tier": result["tier"],
            "probability": result["probability"], "features": features,
            "flooded": bool(row["flooded"]), "explanation": explanation})
        scenario["flood_reports"] += int(row["flooded"] == 1)
    results = list(scenarios.values())
    for scenario in results:
        scenario["tiers"] = {tier: sum(h["tier"] == tier for h in scenario["hotspots"])
                              for tier in ("GREEN", "YELLOW", "RED")}
        scenario["locations"] = len(scenario["hotspots"])
    results.sort(key=lambda s: (s["tiers"]["RED"], s["tiers"]["YELLOW"], s["flood_reports"], s["date"]), reverse=True)
    return to_json_safe({"scenarios": results})


@app.get("/api/history")
def get_history():
    try:
        return historical_scenarios()
    except Exception as exc:
        raise HTTPException(503, "Historical replay data is unavailable.") from exc


class RouteRequest(BaseModel):
    origin: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=1, max_length=120)
    scenario_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


@app.post("/api/route")
def create_route(body: RouteRequest):
    try:
        origin, destination = resolve_location(body.origin.strip()), resolve_location(body.destination.strip())
        if body.scenario_date:
            scenarios = historical_scenarios()["scenarios"]
            scenario = next((item for item in scenarios if item["date"] == body.scenario_date), None)
            if scenario is None:
                raise ValueError("No historical flood replay is available for that date.")
            scenario_hotspots = scenario["hotspots"]
        else:
            scenario_hotspots = dashboard_data()["hotspots"]
        active = [{k: row[k] for k in ("hotspot_id", "name", "lat", "lon", "tier")} for row in scenario_hotspots]
        result = plan_route((origin["lat"], origin["lon"]), (destination["lat"], destination["lon"]), active)
        graph = load_road_graph()
        def coords(path):
            return [[float(graph.nodes[n]["y"]), float(graph.nodes[n]["x"])] for n in path]
        delta_time = result["flood_aware_route"]["time_s"] - result["normal_route"]["time_s"]
        return to_json_safe({"origin": origin, "destination": destination,
            "normal_route": {k: v for k, v in result["normal_route"].items() if k != "path"} | {"coordinates": coords(result["normal_route"]["path"])},
            "flood_aware_route": {k: v for k, v in result["flood_aware_route"].items() if k != "path"} | {"coordinates": coords(result["flood_aware_route"]["path"])},
            "avoided_hotspots": result["avoided_hotspots"], "still_passes_through": result["still_passes_through"],
            "explanation": explain_reroute(result["avoided_hotspots"], delta_time,
                result.get("origin_inside_hotspots"), result.get("dest_inside_hotspots"))})
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(422, str(exc).replace("FATAL: ", "")) from exc
    except Exception as exc:
        raise HTTPException(502, "Route could not be computed. Check the address and try again.") from exc


# Must come BEFORE the static "/" mount below, which would otherwise swallow /mobile/v1/*.
app.include_router(mobile_router)

if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
