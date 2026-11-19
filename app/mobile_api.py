"""RouteRain mobile API, mounted under /mobile/v1 (MOBILE_APP_PLAN.md section 4).

Implemented so far: /health, /places/search, /places/geocode and /scenarios.
/hotspots, /route and /narrate come later, once the model can be loaded.

Nothing in this module loads the risk model or scores anything.
"""
from __future__ import annotations

import datetime as dt
import os

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from config import MOBILE_REPLAY_DATES
from src import route_planner
from src.places import geocode_place, load_places, search_places
from src.predict import MODEL_PATH

router = APIRouter(prefix="/mobile/v1", tags=["mobile"])


def model_loaded() -> bool:
    """Honest answer: this build of the mobile API never loads the risk model, so it is False.
    (model_file_present below says whether the file is on disk.)"""
    return False


def llm_available() -> bool:
    return False  # no LLM narration yet (Phase M2)


@router.get("/health")
def health():
    places = load_places()
    graph_ready = route_planner.graph_loaded()
    return {
        "ok": model_loaded() and graph_ready,
        "model_loaded": model_loaded(),
        "graph_loaded": graph_ready,
        "llm_available": llm_available(),
        "model_file_present": os.path.exists(MODEL_PATH),
        "places": {"count": len(places), "verified": sum(p["verified"] for p in places)},
        "api_version": "mobile/v1",
    }


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


def _label(date_iso: str) -> str:
    day = dt.date.fromisoformat(date_iso)
    return f"{day.day} {day:%B %Y}"


@router.get("/scenarios")
def scenarios():
    """The replay dates chosen for the demo. Dates and labels only, no scores."""
    return {
        "default_mode": "live",
        "scenarios": [{"date": d, "label": _label(d)} for d in MOBILE_REPLAY_DATES],
    }
