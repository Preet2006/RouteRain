import os

import pandas as pd
import pytest
from starlette.routing import Mount

import app.mobile_api as mobile_api
import config
import src.route_planner as rp
from app.api import app
from tests.asgi_client import ASGIClient

client = ASGIClient(app)  # no "with": the startup warm-up (graph load) is not run


# --- /health ---------------------------------------------------------------------

def test_health_reports_model_not_loaded_honestly():
    r = client.get("/mobile/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["model_loaded"] is False
    assert body["ok"] is False  # ok needs the model AND the graph
    assert body["llm_available"] is False
    assert body["graph_loaded"] == rp.graph_loaded()
    assert body["model_file_present"] == os.path.exists(mobile_api.MODEL_PATH)
    assert body["places"]["count"] >= 60 and body["places"]["verified"] == 0


# --- /places/search --------------------------------------------------------------

def test_places_search_finds_cyber_hub():
    r = client.get("/mobile/v1/places/search", params={"q": "cyber"})
    assert r.status_code == 200
    names = [p["name"] for p in r.json()["results"]]
    assert "Cyber Hub" in names and len(names) <= 8


def test_places_search_unknown_and_invalid_queries():
    assert client.get("/mobile/v1/places/search", params={"q": "zzzzqqqq"}).json()["results"] == []
    assert client.get("/mobile/v1/places/search").status_code == 422
    assert client.get("/mobile/v1/places/search", params={"q": ""}).status_code == 422
    assert client.get("/mobile/v1/places/search", params={"q": "x" * 81}).status_code == 422


# --- /places/geocode (Nominatim is always mocked: no network in tests) ---------------

def test_geocode_returns_a_point(monkeypatch):
    monkeypatch.setattr(mobile_api, "geocode_place",
                        lambda q: {"lat": 28.46, "lon": 77.03, "label": q})
    r = client.post("/mobile/v1/places/geocode", json={"q": "  Some Place  "})
    assert r.status_code == 200 and r.json() == {"lat": 28.46, "lon": 77.03, "label": "Some Place"}


def test_geocode_not_found_is_404_with_clean_message(monkeypatch):
    def not_found(q):
        raise ValueError("FATAL: could not geocode 'x' within the Gurugram/NCR area.")
    monkeypatch.setattr(mobile_api, "geocode_place", not_found)
    r = client.post("/mobile/v1/places/geocode", json={"q": "x"})
    assert r.status_code == 404 and "FATAL" not in r.json()["detail"]


def test_geocode_upstream_failure_is_502(monkeypatch):
    def boom(q):
        raise RuntimeError("connection reset")
    monkeypatch.setattr(mobile_api, "geocode_place", boom)
    r = client.post("/mobile/v1/places/geocode", json={"q": "x"})
    assert r.status_code == 502 and "connection reset" not in r.text


def test_geocode_validation():
    assert client.post("/mobile/v1/places/geocode", json={}).status_code == 422
    assert client.post("/mobile/v1/places/geocode", json={"q": ""}).status_code == 422
    assert client.post("/mobile/v1/places/geocode", json={"q": "x" * 121}).status_code == 422


# --- /scenarios ------------------------------------------------------------------

def test_scenarios_lists_the_owner_chosen_dates_without_scores():
    r = client.get("/mobile/v1/scenarios")
    assert r.status_code == 200
    body = r.json()
    assert [s["date"] for s in body["scenarios"]] == ["2026-08-07", "2026-07-08", "2025-07-31", "2025-07-09"]
    assert body["scenarios"][0]["label"] == "7 August 2026"
    assert all(set(s) == {"date", "label"} for s in body["scenarios"])
    assert body["default_mode"] == "live"


def test_every_replay_date_is_a_recorded_flood_day_in_the_test_period():
    t = pd.read_csv(os.path.join(config.PROCESSED_DIR, "training_data.csv"), parse_dates=["date"])
    flood_days = set(t.loc[t["flooded"] == 1, "date"].dt.strftime("%Y-%m-%d"))
    for d in config.MOBILE_REPLAY_DATES:
        assert d in flood_days and d >= "2025-01-01"


# --- existing web app is untouched -------------------------------------------------

def test_existing_routes_are_unchanged_and_mobile_precedes_static_mount():
    paths = [getattr(r, "path", None) for r in app.routes]
    for p in ("/api/dashboard", "/api/history", "/api/route", "/openapi.json"):
        assert p in paths
    # newer FastAPI keeps an included router as one opaque entry, so check its position
    included = [i for i, r in enumerate(app.routes) if type(r).__name__ == "_IncludedRouter"]
    assert len(included) == 1
    mounts = [i for i, r in enumerate(app.routes) if isinstance(r, Mount) and r.path in ("", "/")]
    assert all(m > included[0] for m in mounts)


def test_existing_route_endpoint_still_validates_input():
    assert client.post("/api/route", json={"origin": "", "destination": "x"}).status_code == 422
    assert client.post("/api/route", json={}).status_code == 422


def test_unbuilt_mobile_endpoints_do_not_exist_yet():
    for path in ("/mobile/v1/hotspots", "/mobile/v1/route", "/mobile/v1/narrate"):
        assert client.get(path).status_code in (404, 405)


# --- startup ---------------------------------------------------------------------

def test_startup_can_be_skipped(monkeypatch):
    monkeypatch.setenv("ROUTERAIN_SKIP_WARMUP", "1")
    called = []
    monkeypatch.setattr("app.api.warm_up", lambda: called.append(1))
    with ASGIClient(app) as c:
        assert c.get("/mobile/v1/health").status_code == 200
    assert called == []


def test_missing_graph_does_not_stop_the_server(monkeypatch):
    monkeypatch.delenv("ROUTERAIN_SKIP_WARMUP", raising=False)

    def missing():
        raise FileNotFoundError("FATAL: road_graph.graphml not found")
    monkeypatch.setattr("app.api.warm_up", missing)
    with ASGIClient(app) as c:
        assert c.get("/mobile/v1/health").status_code == 200


@pytest.mark.slow
def test_real_startup_loads_the_graph():
    if not os.path.exists(rp.ROAD_GRAPH_PATH):
        pytest.skip("road graph not present")
    with ASGIClient(app) as c:
        assert c.get("/mobile/v1/health").json()["graph_loaded"] is True
