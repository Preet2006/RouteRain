"""Print real narrations next to the facts they came from (W2 sanity check).

Needs the server running (uvicorn app.api:app) and LLM settings in .env.
Usage:  python scripts/narrate_demo.py [http://127.0.0.1:8000]
Prints, for 3 replay trips x English/Hindi: the facts sent to the model, the narration, its source
(llm/template), latency, and finally the fallback rate and median latency.
"""
import json
import statistics
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, ".")
sys.stdout.reconfigure(encoding="utf-8")  # Hindi output on Windows consoles
from src.narrate import build_facts, llm_config  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000") + "/api/v2"
TRIPS = [("2026-08-07", "Cyber Hub", "Medanta The Medicity"), ("2025-07-31", "MG Road Metro", "Sector 47"),
         ("2026-07-08", "Ambience Mall", "Sohna")]


def call(path, body=None):
    req = urllib.request.Request(BASE + path, None if body is None else json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def place(q):
    return call("/places/search?q=" + urllib.parse.quote(q))["results"][0]


cfg = llm_config()
print(f"provider={cfg['provider']} models={cfg['models']}\n")
latencies, sources = [], []
for date, a, b in TRIPS:
    o, d = place(a), place(b)
    route = call("/route", {"origin": {"lat": o["lat"], "lon": o["lon"], "label": a},
                            "destination": {"lat": d["lat"], "lon": d["lon"], "label": b}, "mode": "replay", "date": date})
    for lang in ("en", "hi"):
        facts = build_facts(route, lang, "Tanish")
        t = time.perf_counter()
        n = call("/narrate", {"route_id": route["route_id"], "user_name": "Tanish", "language": lang})
        ms = (time.perf_counter() - t) * 1000
        latencies.append(ms)
        sources.append(n["source"])
        print(f"=== {date} {a} -> {b} [{lang}]")
        print("facts:", json.dumps(facts, ensure_ascii=False))
        print(f"{n['source'].upper()} ({ms:.0f} ms, language={n['language']}): {n['text']}\n")
print(f"fallback rate: {sources.count('template')}/{len(sources)}   median latency: {statistics.median(latencies):.0f} ms")
