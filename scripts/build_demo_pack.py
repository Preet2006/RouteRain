"""Build the offline demo pack (frontend/src/demo/pack.json) from the REAL running backend.

Two saved replay trips with their routes, narrations and hotspot scores, plus the curated places, so the website can
run with no internet and no server ("Demo mode (offline)" in Settings) if the network fails during a presentation.

Needs the server running:   python -m uvicorn app.api:app --port 8000
Usage:                      python scripts/build_demo_pack.py [http://127.0.0.1:8000]

The pack is a snapshot: re-run this after the model, the places list or the replay dates change.
"""
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from src.places import load_places  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/") + "/api/v2"
OUT = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "demo", "pack.json")

# (id, from, to, replay date, why this trip)
TRIPS = [
    ("demo-trip-1", "Cyber Hub", "Medanta The Medicity", "2026-08-07",
     "A RED hotspot (Rajiv Chowk) sits on the direct road; the detour adds about a minute and is expected to save about 8."),
    ("demo-trip-2", "MG Road Metro", "Badshahpur", "2026-07-08",
     "A YELLOW day where the detour costs more than it is expected to save, so the app says so and leaves it to the user."),
]


def call(path, body=None):
    req = urllib.request.Request(BASE + path, None if body is None else json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def place(q):
    return call("/places/search?q=" + urllib.parse.quote(q))["results"][0]


def main():
    scenarios = {s["date"]: s for s in call("/scenarios")["scenarios"]}
    dates = sorted({t[3] for t in TRIPS})
    pack = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "note": "Snapshot of real backend output for the offline demo. Regenerate with scripts/build_demo_pack.py.",
        "scenarios": [scenarios[d] for d in dates],
        "hotspots": {d: call(f"/hotspots?mode=replay&date={d}") for d in dates},
        "trips": [],
        "places": [{k: p[k] for k in ("place_id", "name", "category", "lat", "lon", "verified")} for p in load_places()],
    }
    for trip_id, a, b, date, why in TRIPS:
        o, d = place(a), place(b)
        route = call("/route", {"origin": {"lat": o["lat"], "lon": o["lon"], "label": a},
                                "destination": {"lat": d["lat"], "lon": d["lon"], "label": b},
                                "caution": "cautious", "mode": "replay", "date": date})
        narration = call("/narrate", {"route_id": route["route_id"], "user_name": None, "language": "en"})
        route["route_id"] = trip_id
        pack["trips"].append({"id": trip_id, "from": a, "to": b, "date": date, "why": why, "route": route,
                              "narration": {k: narration[k] for k in ("text", "source", "language", "scenario")}})
        print(f"{trip_id}: {a} -> {b} ({date}) saving {route['expected_saving_min']} added {route['added_drive_min']} "
              f"| {narration['source']}: {narration['text']}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {os.path.normpath(OUT)} ({os.path.getsize(OUT) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
