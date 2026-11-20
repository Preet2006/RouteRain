import os
import re

import pytest
from fastapi.testclient import TestClient

import app.web_api as web
import config
import src.route_planner as rp
from app.api import app
from tests.test_route_planner import at, grid_with_pocket_and_island, hotspot, make_grid

client = TestClient(app)  # no "with": the startup warm-up (graph load) is not run


# ---- synthetic scoring + road grid -------------------------------------------------------------

def spec(tiers, probs=None):
    """12 hotspots on the grid: H03 sits on the direct row-3 corridor, the rest are far away."""
    probs = probs or {}
    spots = [("H03", 3, 3)] + [(f"H{n:02d}", 7, n % 8) for n in (1, 2, 4, 5, 6, 7, 8, 9, 10, 11)] + [("H12", 0, 7)]
    items = []
    for hid, i, j in spots:
        h = hotspot(hid, i, j, "x")
        tier = tiers.get(hid, "GREEN")
        items.append({"hotspot_id": hid, "name": f"Spot {hid}", "lat": h["lat"], "lon": h["lon"], "tier": tier,
                      "probability": None if tier == "LOW_RAIN" else probs.get(hid, 0.02),
                      "explanation": f"Spot {hid} - {tier}.", "flooded": hid == "H03"})
    return items


@pytest.fixture
def world(monkeypatch):
    state = {"graph": make_grid(), "items": spec({"H03": "RED"}, {"H03": 0.5})}
    monkeypatch.setattr(rp, "load_road_graph", lambda: state["graph"])
    monkeypatch.setattr(web, "_live_data", lambda: ([i for i in state["items"] if i["tier"] != "LOW_RAIN"],
                                                    "2026-08-07T00:00:00+00:00"))
    monkeypatch.setattr(web, "_all_hotspots", lambda: [{k: i[k] for k in ("hotspot_id", "name", "lat", "lon")}
                                                       for i in state["items"]])
    monkeypatch.setattr(web, "_replay_scenario", lambda d: (
        {"date": d, "hotspots": [i for i in state["items"] if i["tier"] != "LOW_RAIN"]} if d == "2026-08-07" else None))
    web._routes.clear()
    return state


def body(origin=(3, 0), dest=(3, 7), **kw):
    o, d = at(*origin), at(*dest)
    return {"origin": {"lat": o[0], "lon": o[1], "label": "A"}, "destination": {"lat": d[0], "lon": d[1], "label": "B"},
            "mode": "replay", "date": "2026-08-07", **kw}


# ---- /health, /scenarios, /places ---------------------------------------------------------------

def test_health_reports_model_and_graph_honestly():
    r = client.get("/api/v2/health").json()
    assert r["model_loaded"] == os.path.exists(web.MODEL_PATH) and r["graph_loaded"] == rp.graph_loaded()
    assert r["ok"] == (r["model_loaded"] and r["graph_loaded"]) and r["places"]["count"] >= 60
    assert r["flood_delay_min"] == 23.4


def test_scenarios_dates_only():
    r = client.get("/api/v2/scenarios").json()
    assert [s["date"] for s in r["scenarios"]] == config.MOBILE_REPLAY_DATES
    assert all(set(s) == {"date", "label"} for s in r["scenarios"]) and r["scenarios"][0]["label"] == "7 August 2026"


def test_places_search_and_validation():
    names = [p["name"] for p in client.get("/api/v2/places/search", params={"q": "cyber"}).json()["results"]]
    assert "Cyber Hub" in names
    assert client.get("/api/v2/places/search").status_code == 422
    assert client.get("/api/v2/places/search", params={"q": "x" * 81}).status_code == 422


def test_geocode_paths(monkeypatch):
    monkeypatch.setattr(web, "geocode_place", lambda q: {"lat": 28.46, "lon": 77.03, "label": q})
    assert client.post("/api/v2/places/geocode", json={"q": " X "}).json() == {"lat": 28.46, "lon": 77.03, "label": "X"}

    def nf(q):
        raise ValueError("FATAL: could not geocode")
    monkeypatch.setattr(web, "geocode_place", nf)
    r = client.post("/api/v2/places/geocode", json={"q": "x"})
    assert r.status_code == 404 and "FATAL" not in r.text

    def boom(q):
        raise RuntimeError("secret detail")
    monkeypatch.setattr(web, "geocode_place", boom)
    r = client.post("/api/v2/places/geocode", json={"q": "x"})
    assert r.status_code == 502 and "secret" not in r.text
    assert client.post("/api/v2/places/geocode", json={"q": ""}).status_code == 422


# ---- /hotspots ------------------------------------------------------------------------------------

def test_hotspots_live(world):
    r = client.get("/api/v2/hotspots").json()
    assert r["scenario"] == {"mode": "live", "date": None, "forecast_generated_at": "2026-08-07T00:00:00+00:00"}
    assert len(r["hotspots"]) == 12 and r["tiers"]["RED"] == 1
    assert set(r["hotspots"][0]) == {"id", "name", "lat", "lon", "tier", "probability", "explanation", "reported_outcome"}
    assert all(h["reported_outcome"] is None for h in r["hotspots"])


def test_hotspots_replay_low_rain_and_reported_outcome(world):
    world["items"] = spec({"H03": "RED", "H05": "LOW_RAIN"}, {"H03": 0.5})
    r = client.get("/api/v2/hotspots", params={"mode": "replay", "date": "2026-08-07"}).json()
    assert r["scenario"]["mode"] == "replay" and r["scenario"]["date"] == "2026-08-07" and len(r["hotspots"]) == 12
    by = {h["id"]: h for h in r["hotspots"]}
    assert by["H05"]["tier"] == "LOW_RAIN" and by["H05"]["probability"] is None
    assert by["H05"]["reported_outcome"] is None and "LOW RAIN: not scored" in by["H05"]["explanation"]
    assert by["H03"]["reported_outcome"] == "flooded" and by["H01"]["reported_outcome"] == "no_report"
    assert r["tiers"] == {"RED": 1, "YELLOW": 0, "GREEN": 10, "LOW_RAIN": 1}


def test_hotspots_input_errors(world):
    assert client.get("/api/v2/hotspots", params={"mode": "replay"}).status_code == 422
    assert client.get("/api/v2/hotspots", params={"mode": "replay", "date": "2020-01-01"}).status_code == 404
    assert client.get("/api/v2/hotspots", params={"mode": "bogus"}).status_code == 422
    assert client.get("/api/v2/hotspots", params={"mode": "replay", "date": "07-01-2020"}).status_code == 422


# ---- /route -----------------------------------------------------------------------------------------

def test_replay_route_avoids_red_hotspot_on_direct_path(world):
    r = client.post("/api/v2/route", json=body())
    assert r.status_code == 200
    j = r.json()
    assert j["scenario"]["mode"] == "replay" and not j["identical_routes"]
    assert [h["id"] for h in j["avoided_hotspots"]] == ["H03"] and j["avoided_hotspots"][0]["explanation"]
    assert [h["id"] for h in j["normal_route"]["near_hotspots"]] == ["H03"]
    assert "H03" not in [h["id"] for h in j["flood_aware_route"]["near_hotspots"]]
    assert j["flood_aware_route"]["drive_time_min"] >= j["normal_route"]["drive_time_min"]
    assert j["normal_route"]["expected_time_min"] == pytest.approx(
        j["normal_route"]["drive_time_min"] + 0.5 * config.FLOOD_DELAY_MIN, abs=0.1)
    assert j["expected_saving_min"] > 0
    assert j["template_advice"].startswith("On 7 August 2026, ") and "save" in j["template_advice"]
    assert len(j["normal_route"]["polyline"]) <= 300 and len(j["flood_aware_route"]["polyline"]) <= 300
    assert j["risk_zones"] == [{"id": "H03", "name": "Spot H03", "lat": at(3, 3)[0], "lon": at(3, 3)[1],
                                "tier": "RED", "radius_m": 500}]
    assert re.fullmatch(r"[0-9a-f]{12}", j["route_id"])


def test_route_passing_two_hotspots_is_scored(world):
    # H12 (row 0) and H03 (row 3) are both RED; a corridor trip along row 3 passes H03 only, so add a second
    # hotspot on the same corridor to cover the "two near hotspots" case that once failed in production.
    world["items"] = spec({"H03": "RED", "H05": "YELLOW"}, {"H03": 0.5, "H05": 0.2})
    for it in world["items"]:
        if it["hotspot_id"] == "H05":
            it["lat"], it["lon"] = at(3, 5)
    j = client.post("/api/v2/route", json=body()).json()
    assert {h["id"] for h in j["normal_route"]["near_hotspots"]} >= {"H03", "H05"}
    assert j["normal_route"]["expected_time_min"] == pytest.approx(
        j["normal_route"]["drive_time_min"] + (0.5 + 0.2) * config.FLOOD_DELAY_MIN, abs=0.1)


def test_identical_routes_say_no_detour(world):
    world["items"] = spec({})  # everything GREEN
    j = client.post("/api/v2/route", json=body()).json()
    assert j["identical_routes"] and j["expected_saving_min"] == 0 and j["added_drive_min"] == 0
    assert j["avoided_hotspots"] == [] and "no detour was needed" in j["template_advice"]
    j = client.post("/api/v2/route", json={**body(), "mode": "live", "date": None}).json()
    assert j["template_advice"].startswith("No detour needed today")


def test_detour_costing_more_than_it_saves_never_says_save(world):
    world["items"] = spec({"H03": "RED"}, {"H03": 0.01})
    j = client.post("/api/v2/route", json=body()).json()
    assert not j["identical_routes"] and j["expected_saving_min"] < 0 and j["added_drive_min"] > 0
    assert not re.search(r"\bsav", j["template_advice"], re.I) and "your call" in j["template_advice"].lower()


def test_low_rain_hotspot_adds_no_delay_and_counts_as_green(world):
    world["items"] = spec({"H03": "LOW_RAIN"})
    j = client.post("/api/v2/route", json=body()).json()
    assert j["identical_routes"] and j["risk_zones"] == []
    near = j["normal_route"]["near_hotspots"]
    assert near[0]["tier"] == "LOW_RAIN" and near[0]["probability"] is None
    assert j["normal_route"]["expected_time_min"] == j["normal_route"]["drive_time_min"]


def test_balanced_caution_ignores_yellow(world):
    world["items"] = spec({"H03": "YELLOW"}, {"H03": 0.2})
    cautious = client.post("/api/v2/route", json=body()).json()
    balanced = client.post("/api/v2/route", json=body(caution="balanced")).json()
    assert not cautious["identical_routes"] and balanced["identical_routes"] and balanced["caution"] == "balanced"


def test_route_cache_get_and_expiry(world):
    j = client.post("/api/v2/route", json=body()).json()
    got = client.get(f"/api/v2/route/{j['route_id']}")
    assert got.status_code == 200 and got.json() == j
    r = client.get("/api/v2/route/doesnotexist")
    assert r.status_code == 404 and r.json()["detail"] == "This route has expired, please plan it again."
    web._routes[j["route_id"]] = (0.0, j)  # already past its time
    assert client.get(f"/api/v2/route/{j['route_id']}").status_code == 404
    assert j["route_id"] not in web._routes


def test_outside_coverage_is_422(world):
    far = {"lat": 29.5, "lon": 77.0, "label": "far"}
    r = client.post("/api/v2/route", json={**body(), "origin": far})
    assert r.status_code == 422 and r.json()["detail"] == "That point is outside RouteRain's Gurugram coverage."


def test_no_drivable_route_is_422(world):
    world["graph"] = grid_with_pocket_and_island()
    node = world["graph"].nodes[2000]
    island = {"lat": node["y"], "lon": node["x"], "label": "island"}
    r = client.post("/api/v2/route", json={**body(), "destination": island})
    assert r.status_code == 422 and r.json()["detail"] == "No drivable route found between these points."


def test_route_input_validation(world):
    assert client.post("/api/v2/route", json={}).status_code == 422
    assert client.post("/api/v2/route", json={**body(), "caution": "reckless"}).status_code == 422
    assert client.post("/api/v2/route", json={**body(), "origin": {"lat": 99, "lon": 77}}).status_code == 422
    assert client.post("/api/v2/route", json={**body(), "date": None}).status_code == 422  # replay needs a date
    assert client.post("/api/v2/route", json={**body(), "date": "2020-01-01"}).status_code == 404


# ---- /narrate ----------------------------------------------------------------------------------------

def test_narrate_returns_template_advice(world, monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "none")  # never call a real provider from tests
    j = client.post("/api/v2/route", json=body()).json()
    r = client.post("/api/v2/narrate", json={"route_id": j["route_id"], "user_name": "Tanish", "language": "hi"})
    assert r.status_code == 200
    n = r.json()
    assert n["text"] == j["template_advice"] and n["source"] == "template" and n["language"] == "en"
    assert client.post("/api/v2/narrate", json={"route_id": "gone"}).status_code == 404
    assert client.post("/api/v2/narrate", json={"route_id": j["route_id"], "language": "fr"}).status_code == 422


# ---- the real model and data (skipped when the model file is absent) ---------------------------------

needs_model = pytest.mark.skipif(not os.path.exists(web.MODEL_PATH), reason="models/risk_model.pkl not present")


@needs_model
def test_health_with_the_real_model():
    assert client.get("/api/v2/health").json()["model_loaded"] is True


@needs_model
def test_real_replay_2025_07_09_has_one_low_rain_hotspot():
    r = client.get("/api/v2/hotspots", params={"mode": "replay", "date": "2025-07-09"}).json()
    low = [h for h in r["hotspots"] if h["tier"] == "LOW_RAIN"]
    assert len(r["hotspots"]) == 12 and [h["id"] for h in low] == ["H01"] and low[0]["probability"] is None
    scored = [h for h in r["hotspots"] if h["tier"] != "LOW_RAIN"]
    assert all(0 <= h["probability"] <= 1 and h["reported_outcome"] in ("flooded", "no_report") for h in scored)
    assert sum(h["reported_outcome"] == "flooded" for h in scored) == 9


# ---- existing web app untouched ---------------------------------------------------------------------------

def test_existing_routes_unchanged_and_v2_precedes_static_mount():
    from starlette.routing import Mount
    paths = [getattr(r, "path", None) for r in app.routes]
    for p in ("/api/dashboard", "/api/history", "/api/route"):
        assert p in paths
    included = [i for i, r in enumerate(app.routes) if type(r).__name__ == "_IncludedRouter"]
    assert len(included) == 1
    assert all(i > included[0] for i, r in enumerate(app.routes) if isinstance(r, Mount) and r.path in ("", "/"))
    assert client.post("/api/route", json={"origin": "", "destination": "x"}).status_code == 422
    assert client.get("/mobile/v1/health").status_code == 404  # old prefix is gone


def test_startup_can_be_skipped_and_survives_missing_graph(monkeypatch):
    monkeypatch.setenv("ROUTERAIN_SKIP_WARMUP", "1")
    called = []
    monkeypatch.setattr("app.api.warm_up", lambda: called.append(1))
    with TestClient(app) as c:
        assert c.get("/api/v2/scenarios").status_code == 200
    assert called == []
    monkeypatch.delenv("ROUTERAIN_SKIP_WARMUP")

    def missing():
        raise FileNotFoundError("no graph")
    monkeypatch.setattr("app.api.warm_up", missing)
    with TestClient(app) as c:
        assert c.get("/api/v2/scenarios").status_code == 200


@pytest.mark.slow
def test_real_startup_loads_the_graph():
    with TestClient(app) as c:
        assert c.get("/api/v2/health").json()["graph_loaded"] is True
