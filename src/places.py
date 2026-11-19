"""Curated place search for the mobile app (MOBILE_APP_PLAN.md section 2.2).

Search-as-you-type filters ONLY the local CSV, so it never calls Nominatim.
Uses data/raw/places_gurugram.csv when it exists (the team-verified list),
otherwise the unverified places_gurugram_DRAFT.csv. Every result carries its
`verified` flag so the app can tell the difference.

The one-shot "search the full map" fallback is geocode_place(): a single
Nominatim request, bounded to Gurugram, rate-limited by route_planner's shared
limiter, and cached so a repeated query never hits the network twice.
"""

import os
import re
import threading

import pandas as pd

from config import RAW_DIR

PLACES_CSV = os.path.join(RAW_DIR, "places_gurugram.csv")
PLACES_DRAFT_CSV = os.path.join(RAW_DIR, "places_gurugram_DRAFT.csv")
MAX_RESULTS = 8

_places = None
_geocode_cache = {}
_geocode_lock = threading.Lock()


def _norm(text):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", str(text).lower())).strip()


def load_places(path=None):
    """Load and index the places file once. Returns a list of dicts."""
    global _places
    if path is None:
        if _places is None:
            _places = _read_places(PLACES_CSV if os.path.exists(PLACES_CSV) else PLACES_DRAFT_CSV)
        return _places
    return _read_places(path)


def _read_places(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"FATAL: places file not found: {path}")
    df = pd.read_csv(path, keep_default_na=False)
    rows = []
    for r in df.to_dict("records"):
        names = [_norm(r["name"])] + [_norm(a) for a in str(r.get("aliases", "")).split(";") if a.strip()]
        rows.append({
            "place_id": r["place_id"], "name": r["name"], "category": r["category"],
            "lat": float(r["lat"]), "lon": float(r["lon"]), "verified": int(r["verified"]),
            "_names": names,
        })
    return rows


def _score(query, names):
    """Lower is better; None means no match. 0 exact, 1 prefix, 2 word-prefix, 3 substring."""
    best = None
    for n in names:
        if n == query:
            s = 0
        elif n.startswith(query):
            s = 1
        elif any(w.startswith(query) for w in n.split()):
            s = 2
        elif query in n:
            s = 3
        else:
            continue
        best = s if best is None else min(best, s)
    return best


def search_places(query, limit=MAX_RESULTS, places=None):
    """Up to `limit` matches, best first. Empty or one-character queries return []."""
    q = _norm(query)
    if len(q) < 2:
        return []
    hits = []
    for p in (places if places is not None else load_places()):
        s = _score(q, p["_names"])
        if s is not None:
            hits.append((s, p["name"].lower(), p))
    hits.sort(key=lambda t: (t[0], t[1]))
    return [{k: v for k, v in p.items() if not k.startswith("_")} for _, _, p in hits[:limit]]


def geocode_place(query):
    """One bounded, rate-limited, cached Nominatim lookup. Returns {lat, lon, label}
    or raises ValueError (not found). Only successful lookups are cached."""
    from src.route_planner import geocode_bounded  # imported lazily: pulls in osmnx/geopandas

    key = _norm(query)
    if not key:
        raise ValueError("Empty search text.")
    with _geocode_lock:
        if key in _geocode_cache:
            return dict(_geocode_cache[key])
    lat, lon = geocode_bounded(query)
    result = {"lat": lat, "lon": lon, "label": query.strip()}
    with _geocode_lock:
        _geocode_cache[key] = result
    return dict(result)
