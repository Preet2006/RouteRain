"""RouteRain website API, mounted under /api/v2 (WEB_APP_PLAN.md section 6).

Endpoints: /health, /scenarios, /hotspots, /places/search, /places/geocode, /route (POST),
/route/{route_id}, /narrate. The scoring itself is reused from app.api (imported lazily, because
app.api includes this router).
"""
from __future__ import annotations

import os
from functools import lru_cache
import threading
import time
import uuid
from typing import Literal

import networkx as nx
import osmnx as ox
from fastapi import APIRouter, HTTPException, Query
from geopy.distance import geodesic
from pydantic import BaseModel, Field

from config import FLOOD_DELAY_MIN, MOBILE_REPLAY_DATES, ROUTE_CACHE_TTL_MIN
from src import narrate as narration
from src import directions, route_planner
from src.advice import build_advice, replay_date_label
from src.places import geocode_place, load_places, search_places
from src.predict import MODEL_PATH
from src.route_metrics import added_drive_min, expected_saving_min, expected_time_min, routes_identical

router = APIRouter(prefix="/api/v2", tags=["web"])

MAX_SNAP_TO_ROAD_M = 1000
COVERAGE_MESSAGE = "That point is outside RouteRain's Gurugram coverage."
EXPIRED_MESSAGE = "This route has expired, please plan it again."
LOW_RAIN_TEXT = ("LOW RAIN: not scored. Rainfall at this point was under 10 mm that day, below what the model "
                 "scores. It is treated like GREEN for routing.")


# ---- scoring providers (replaced in tests) ---------------------------------------------

def _api():
    from app import api  # lazy: app.api imports this module
    return api


def _live_data():
    """(hotspot dicts, forecast_generated_at). Reuses /api/dashboard's 10-minute cache."""
    data = _api().dashboard_data()
    return data["hotspots"], data["fetched_at"]


def _replay_scenario(date_iso):
    """The historical_scenarios() entry for a date, or None."""
    return next((s for s in _api().historical_scenarios()["scenarios"] if s["date"] == date_iso), None)


def _all_hotspots():
    import pandas as pd
    from config import HOTSPOTS_CSV
    return pd.read_csv(HOTSPOTS_CSV).to_dict("records")


def model_loaded() -> bool:
    try:
        _api().model_bundle()
        return True
    except Exception:
        return False


def llm_available() -> bool:
    return narration.llm_available()


# ---- scenario -> 12 hotspot items --------------------------------------------------------

def _item(h, reported=None):
    return {"id": h["hotspot_id"], "name": h["name"], "lat": float(h["lat"]), "lon": float(h["lon"]),
            "tier": h["tier"], "probability": h["probability"], "explanation": h["explanation"],
            "reported_outcome": reported, "type": h.get("type", "")}


def _types():
    return {h["hotspot_id"]: str(h.get("type") or "") for h in _all_hotspots()}


def load_scenario(mode, date_iso):
    """Returns (scenario meta, list of 12 hotspot items). Raises HTTPException for bad input."""
    types = _types()
    if mode == "live":
        rows, generated = _live_data()
        items = [_item({**h, "type": types.get(h["hotspot_id"], "")}) for h in sorted(rows, key=lambda r: r["hotspot_id"])]
        return {"mode": "live", "date": None, "forecast_generated_at": generated}, items

    if not date_iso:
        raise HTTPException(422, "A date is required for replay mode.")
    scenario = _replay_scenario(date_iso)
    if scenario is None:
        raise HTTPException(404, "No historical replay is available for that date.")
    scored = {h["hotspot_id"]: h for h in scenario["hotspots"]}
    items = []
    for hs in sorted(_all_hotspots(), key=lambda r: r["hotspot_id"]):
        row = scored.get(hs["hotspot_id"])
        if row is None:
            items.append({"id": hs["hotspot_id"], "name": hs["name"], "lat": float(hs["lat"]),
                          "lon": float(hs["lon"]), "tier": "LOW_RAIN", "probability": None,
                          "explanation": f"{hs['name']}: {LOW_RAIN_TEXT}", "reported_outcome": None,
                          "type": types.get(hs["hotspot_id"], "")})
        else:  # the real outcome sits in its own field and is never part of the prediction
            items.append(_item({**row, "type": types.get(hs["hotspot_id"], "")}, "flooded" if row["flooded"] else "no_report"))
    return {"mode": "replay", "date": date_iso, "forecast_generated_at": None}, items


# ---- /health, /scenarios -------------------------------------------------------------------

@router.get("/health")
def health():
    places = load_places()
    loaded, graph = model_loaded(), route_planner.graph_loaded()
    return {"ok": loaded and graph, "model_loaded": loaded, "graph_loaded": graph,
            "llm_available": llm_available(), "model_file_present": os.path.exists(MODEL_PATH),
            "places": {"count": len(places), "verified": sum(p["verified"] for p in places)},
            "flood_delay_min": round(FLOOD_DELAY_MIN, 1), "api_version": "v2"}


@router.get("/scenarios")
def scenarios():
    """Replay dates chosen for the demo. Dates and labels only."""
    return {"default_mode": "live",
            "scenarios": [{"date": d, "label": replay_date_label(d)} for d in MOBILE_REPLAY_DATES]}


# ---- /hotspots -------------------------------------------------------------------------------

@router.get("/hotspots")
def hotspots(mode: Literal["live", "replay"] = "live",
             date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    try:
        meta, items = load_scenario(mode, date)
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(503, "Project data is incomplete. Check the model and data files.") from exc
    except Exception as exc:
        raise HTTPException(502, "Hotspot scores could not be refreshed. Please try again shortly.") from exc
    counts = {t: sum(i["tier"] == t for i in items) for t in ("RED", "YELLOW", "GREEN", "LOW_RAIN")}
    return {"scenario": meta, "tiers": counts, "hotspots": items}


# ---- /hotspots/{id}: the detail page -----------------------------------------------------------

@lru_cache(maxsize=1)
def _static_facts():
    """Per-hotspot facts that do not depend on the day: terrain, number of recorded floods, infrastructure note."""
    import pandas as pd
    from config import PROCESSED_DIR, RAW_DIR
    terrain = pd.read_csv(os.path.join(PROCESSED_DIR, "terrain_features.csv")).set_index("hotspot_id")
    labels = pd.read_csv(os.path.join(PROCESSED_DIR, "flood_labels_clean.csv"), parse_dates=["date"])
    infra = pd.read_csv(os.path.join(RAW_DIR, "infrastructure_issues.csv"), keep_default_na=False).set_index("hotspot_id")
    out = {}
    for hid in terrain.index:
        t = terrain.loc[hid]
        mine = labels[labels["hotspot_id"] == hid]
        i = infra.loc[hid] if hid in infra.index else None
        out[hid] = {
            "terrain": {"elevation_m": float(t["elevation_m"]), "sink_depth_m": float(t["sink_depth_m"]),
                        "slope_deg": float(t["slope_deg"]), "catchment_cells": int(t["catchment_cells"])},
            "history": {"recorded_floods": int(len(mine)),
                        "first_date": mine["date"].min().date().isoformat() if len(mine) else None,
                        "last_date": mine["date"].max().date().isoformat() if len(mine) else None},
            "infrastructure": {"flagged": bool(int(i["has_infrastructure_issue"])) if i is not None else False,
                               "note": (str(i["evidence_note"]) or None) if i is not None else None,
                               "evidence_date": (str(i["evidence_date"]) or None) if i is not None else None,
                               "source_url": (str(i["source_url"]) or None) if i is not None else None},
        }
    return out


CONDITION_KEYS = ("rain_24h", "rain_max_1h", "rain_max_3h", "rain_prev_3d", "soil_moisture_surface", "rain_season_cumulative")


def _scenario_row(mode, date_iso, hotspot_id):
    """The raw scored row (with the model's input features) for one hotspot, or None when it was not scored."""
    if mode == "live":
        rows, _ = _live_data()
    else:
        scenario = _replay_scenario(date_iso)
        rows = scenario["hotspots"] if scenario else []
    return next((r for r in rows if r["hotspot_id"] == hotspot_id), None)


@router.get("/hotspots/{hotspot_id}")
def hotspot_detail(hotspot_id: str, mode: Literal["live", "replay"] = "live",
                   date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Everything the detail page shows: the same item as /hotspots, plus its buffer radius, terrain, the rain
    conditions the model saw that day, how many floods were recorded here, and any infrastructure issue."""
    try:
        meta, items = load_scenario(mode, date)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, "Hotspot details could not be loaded. Please try again shortly.") from exc
    item = next((i for i in items if i["id"] == hotspot_id), None)
    facts = _static_facts().get(hotspot_id)
    if item is None or facts is None:
        raise HTTPException(404, "No hotspot with that id.")
    row = _scenario_row(mode, date, hotspot_id)
    features = (row or {}).get("features") or {}
    conditions = {k: (float(features[k]) if features.get(k) is not None else None) for k in CONDITION_KEYS} if features else None
    buffer_m = route_planner.RED_BUFFER_M if item["tier"] == "RED" else route_planner.YELLOW_BUFFER_M
    return {"scenario": meta, "hotspot": item, "buffer_m": buffer_m, "conditions": conditions, **facts}


# ---- places ----------------------------------------------------------------------------------

@router.get("/places/search")
def places_search(q: str = Query(min_length=1, max_length=80)):
    """Search the curated list only (never calls Nominatim). Up to 8 matches."""
    return {"query": q, "results": search_places(q)}


class GeocodeRequest(BaseModel):
    q: str = Field(min_length=1, max_length=120)


@router.post("/places/geocode")
def places_geocode(body: GeocodeRequest):
    """One Nominatim lookup bounded to Gurugram, rate-limited (1 request/second) and cached."""
    try:
        return geocode_place(body.q.strip())
    except ValueError as exc:
        raise HTTPException(404, str(exc).replace("FATAL: ", "")) from exc
    except Exception as exc:
        raise HTTPException(502, "Place search is unavailable right now. Please try again shortly.") from exc


# ---- /route ----------------------------------------------------------------------------------

class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    label: str = Field(default="", max_length=120)


class RouteRequest(BaseModel):
    origin: Point
    destination: Point
    caution: Literal["cautious", "balanced"] = "cautious"
    mode: Literal["live", "replay"] = "live"
    date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


_routes: dict[str, tuple[float, dict]] = {}
# Navigation side of the route cache (same lifetime): the node path of each route, the ids of avoided hotspots and
# the risk zones, so /directions can rebuild the full edge geometry and the steps from the road graph. Kept apart
# from the payload so the public /route response is unchanged.
_nav: dict[str, dict] = {}
_routes_lock = threading.Lock()


def _store(payload, nav=None):
    route_id = uuid.uuid4().hex[:12]
    now = time.monotonic()
    with _routes_lock:
        for key in [k for k, (exp, _) in _routes.items() if exp <= now]:
            del _routes[key]
        for key in [k for k in _nav if k not in _routes]:
            del _nav[key]
        _routes[route_id] = (now + ROUTE_CACHE_TTL_MIN * 60, payload)
        if nav is not None:
            _nav[route_id] = nav
    return route_id


def _fetch(route_id):
    with _routes_lock:
        entry = _routes.get(route_id)
        if entry and entry[0] > time.monotonic():
            return entry[1]
        _routes.pop(route_id, None)
    raise HTTPException(404, EXPIRED_MESSAGE)


def _check_coverage(graph, point):
    node = ox.distance.nearest_nodes(graph, point.lon, point.lat)
    gap = geodesic((point.lat, point.lon), (graph.nodes[node]["y"], graph.nodes[node]["x"])).meters
    if gap > MAX_SNAP_TO_ROAD_M:
        raise HTTPException(422, COVERAGE_MESSAGE)


def _brief(items_by_id, h):
    full = items_by_id[h["hotspot_id"]]
    return {"id": full["id"], "name": full["name"], "tier": full["tier"], "probability": full["probability"]}


@router.post("/route")
def create_route(body: RouteRequest):
    try:
        meta, items = load_scenario(body.mode, body.date)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, "Hotspot scores could not be loaded, so the route was not planned.") from exc
    by_id = {i["id"]: i for i in items}
    # LOW_RAIN counts as GREEN for routing and never carries a probability.
    active = [{"hotspot_id": i["id"], "name": i["name"], "lat": i["lat"], "lon": i["lon"],
               "tier": "GREEN" if i["tier"] == "LOW_RAIN" else i["tier"]} for i in items]

    try:
        graph = route_planner.load_road_graph()
    except FileNotFoundError as exc:
        raise HTTPException(503, "The road network is not loaded on the server.") from exc
    _check_coverage(graph, body.origin)
    _check_coverage(graph, body.destination)

    kwargs = {"yellow_penalty": 1} if body.caution == "balanced" else {}
    try:
        plan = route_planner.plan_route((body.origin.lat, body.origin.lon),
                                        (body.destination.lat, body.destination.lon),
                                        active, include_proximity=True, graph=graph, **kwargs)
    except route_planner.NoDrivableRouteError as exc:
        raise HTTPException(422, route_planner.NO_ROUTE_MESSAGE) from exc
    except nx.NetworkXNoPath as exc:
        raise HTTPException(422, route_planner.NO_ROUTE_MESSAGE) from exc
    except Exception as exc:
        raise HTTPException(502, "Route could not be computed. Please try again.") from exc

    normal, aware = plan["normal_route"], plan["flood_aware_route"]
    n_min, a_min = normal["time_s"] / 60, aware["time_s"] / 60
    identical = routes_identical(normal["path"], aware["path"])
    n_near = [_brief(by_id, h) for h in plan["normal_near_hotspots"]]
    a_near = [_brief(by_id, h) for h in plan["flood_aware_near_hotspots"]]
    try:
        saving = 0.0 if identical else expected_saving_min(n_min, n_near, a_min, a_near, FLOOD_DELAY_MIN)
        added = 0.0 if identical else added_drive_min(n_min, a_min)
    except ValueError as exc:  # flood-aware faster than normal would be a bug upstream: fail loudly
        raise HTTPException(500, "Route comparison failed an internal check.") from exc

    def leg(route, near):
        return {"polyline": route_planner.route_polyline(graph, route["path"], 300),
                "drive_time_min": round(route["time_s"] / 60, 1), "distance_km": round(route["length_m"] / 1000, 2),
                "near_hotspots": near,
                "expected_time_min": round(expected_time_min(route["time_s"] / 60, near, FLOOD_DELAY_MIN), 1)}

    def tiered(hs):  # name + the scenario's own tier word, plus the reason shown under "Why"
        return [{"id": h["hotspot_id"], "name": h["name"], "tier": h["tier"],
                 "probability": by_id[h["hotspot_id"]]["probability"],
                 "explanation": by_id[h["hotspot_id"]]["explanation"]} for h in hs]

    avoided, still = tiered(plan["avoided_hotspots"]), tiered(plan["still_passes_through"])
    advice = build_advice(identical=identical, expected_saving_min=saving, added_drive_min=added,
                          avoided=avoided, still_passes=still,
                          origin_inside=plan["origin_inside_hotspots"], dest_inside=plan["dest_inside_hotspots"],
                          replay_date=meta["date"])
    red_yellow_buffers = {"RED": route_planner.RED_BUFFER_M, "YELLOW": route_planner.YELLOW_BUFFER_M}
    payload = {
        "scenario": meta,
        "origin": body.origin.model_dump(), "destination": body.destination.model_dump(),
        "caution": body.caution,
        "normal_route": leg(normal, n_near), "flood_aware_route": leg(aware, a_near),
        "identical_routes": identical,
        "expected_saving_min": round(saving, 1), "added_drive_min": round(added, 1),
        "flood_delay_min": round(FLOOD_DELAY_MIN, 1),
        "avoided_hotspots": avoided, "still_passes_through": still,
        "risk_zones": [{"id": i["id"], "name": i["name"], "lat": i["lat"], "lon": i["lon"], "tier": i["tier"],
                        "radius_m": red_yellow_buffers[i["tier"]]} for i in items if i["tier"] in red_yellow_buffers],
        "template_advice": advice,
    }
    nav = {"paths": {"normal": list(normal["path"]), "flood_aware": list(aware["path"])},
           "avoided_ids": [h["hotspot_id"] for h in plan["avoided_hotspots"]],
           "zones": [{"hotspot_id": z["id"], "name": z["name"], "lat": z["lat"], "lon": z["lon"], "tier": z["tier"],
                      "buffer_m": z["radius_m"]} for z in payload["risk_zones"]],
           "built": {}}
    payload["route_id"] = _store(payload, nav)
    return payload


@router.get("/route/{route_id}")
def get_route(route_id: str):
    return _fetch(route_id)


@router.get("/route/{route_id}/directions")
def route_directions(route_id: str, which: Literal["flood_aware", "normal"] = "flood_aware"):
    """Turn-by-turn steps, the full navigation line (with distance at every point) and the avoided-hotspot events
    for one of the two cached routes. Built from the same road-graph path the route used."""
    _fetch(route_id)  # 404 with the expiry message when the route is gone
    with _routes_lock:
        nav = _nav.get(route_id)
    if nav is None:
        raise HTTPException(404, EXPIRED_MESSAGE)
    if which in nav["built"]:
        return nav["built"][which]
    try:
        graph = route_planner.load_road_graph()
        path = nav["paths"][which]
        steps = directions.build_steps(graph, path)
        geometry = directions.build_nav_geometry(graph, path, steps)
        events = directions.build_hotspot_events(geometry, nav["zones"], avoided_ids=nav["avoided_ids"])
        _, time_s = route_planner.route_metrics(graph, path)
    except FileNotFoundError as exc:
        raise HTTPException(503, "The road network is not loaded on the server.") from exc
    except Exception as exc:
        raise HTTPException(502, "Directions could not be built for this route.") from exc
    result = {"route_id": route_id, "which": which, "language": "en",
              "total_distance_m": geometry["total_m"], "total_duration_s": round(time_s, 1),
              "steps": [s.to_dict() for s in steps],
              "geometry": {k: geometry[k] for k in ("coordinates", "cumulative_m", "step_point_index")},
              "hotspot_events": events}
    nav["built"][which] = result
    return result


# ---- /narrate --------------------------------------------------------------------------------

class NarrateRequest(BaseModel):
    route_id: str = Field(min_length=1, max_length=64)
    user_name: str | None = Field(default=None, max_length=40)
    language: Literal["en", "hi"] = "en"


@router.post("/narrate")
def narrate(body: NarrateRequest):
    """Spoken advice for a cached route. The LLM (if configured) only phrases the backend's facts and
    every number it writes is checked; on any problem the template sentence comes back instead.
    `language` is the language of the returned text (Hindi falls back to English templates)."""
    route = _fetch(body.route_id)
    result = narration.narrate(body.route_id, route, body.language, body.user_name)
    return {"text": result["text"], "source": result["source"], "language": result["language"],
            "scenario": route["scenario"]}
