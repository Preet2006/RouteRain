"""Phase U4 sanity check: print the full turn-by-turn step list for real replay trips against a running server, so a
person can compare them with Google Maps by eye. Also reports the share of steps that have a street name and flags
things that look wrong (a "turn" onto the same street name, very short steps, distance mismatches).

Usage:  python scripts/print_directions.py http://127.0.0.1:8001
"""
import json
import sys
import urllib.parse
import urllib.request

BASE = (next((a for a in sys.argv[1:] if a.startswith("http")), "http://127.0.0.1:8000")).rstrip("/") + "/api/v2"

# (from, to, replay date, caution, what to look at)
TRIPS = [
    ("Cyber Hub", "Medanta The Medicity", "2026-08-07", "cautious", "detour around a RED hotspot"),
    ("MG Road Metro", "Badshahpur", "2026-07-08", "cautious", "YELLOW day"),
    ("Sector 29", "Huda City Centre", "2026-08-07", "cautious", "another trip on the RED day"),
]


def call(path, body=None):
    req = urllib.request.Request(BASE + path, None if body is None else json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def place(q):
    results = call("/places/search?q=" + urllib.parse.quote(q))["results"]
    if not results:
        raise SystemExit(f"no place found for {q!r}")
    return results[0]


def fmt_m(m):
    return f"{m / 1000:.1f} km" if m >= 1000 else f"{round(m)} m"


def show(title, route, which):
    d = call(f"/route/{route['route_id']}/directions?which={which}")
    steps = d["steps"]
    print(f"\n--- {title}: {which} route, {fmt_m(d['total_distance_m'])}, {d['total_duration_s'] / 60:.1f} min, {len(steps)} steps ---")
    for s in steps:
        print(f"{s['index']:>3}. {s['instruction_en']:<62} {fmt_m(s['distance_m']):>8}   [{s['maneuver']}{'/' + s['modifier'] if s['modifier'] else ''}"
              f"{' exit ' + str(s['exit_number']) if s['exit_number'] else ''}]")
    for e in d["hotspot_events"]:
        state = "DRIVES THROUGH" if e["passes_through"] else ("avoided" if e["avoided"] else "passes near")
        where = "on the route" if e["side"] == "on_route" else f"on the {e['side']}"
        reach = (f"within 1 km from {fmt_m(e['approach_distance_m'])}" if e["within_radius"] else "never within 1 km")
        print(f"     hotspot {e['name']} ({e['tier']}): {reach}, closest {fmt_m(e['closest_distance_m'])} "
              f"at {fmt_m(e['closest_distance_along_m'])}, {where} -> {state}")
    problems = []
    if abs(sum(s["distance_m"] for s in steps) - d["total_distance_m"]) > 1:
        problems.append("step distances do not add up to the route length")
    g = d["geometry"]
    if abs(g["cumulative_m"][-1] - d["total_distance_m"]) > 0.2:
        problems.append("geometry length differs from the total")
    for a, b in zip(steps, steps[1:]):
        merged = ", then " in b["instruction_en"]  # the street shown is the LAST one of the merged manoeuvres
        if not merged and b["maneuver"] in ("turn", "slight", "sharp") and a["street"] and a["street"] == b["street"]:
            problems.append(f"step {b['index']}: a {b['maneuver']} onto the same street name as before ({b['street']}); a curve on one road?")
        if b["maneuver"] != "arrive" and b["distance_m"] < 40:
            problems.append(f"step {b['index']}: only {b['distance_m']} m long")
    return steps, problems


def main():
    all_steps = []
    for a, b, date, caution, why in TRIPS:
        o, dst = place(a), place(b)
        route = call("/route", {"origin": {"lat": o["lat"], "lon": o["lon"], "label": a},
                                "destination": {"lat": dst["lat"], "lon": dst["lon"], "label": b},
                                "caution": caution, "mode": "replay", "date": date})
        print(f"\n==================== {a} -> {b} on {date} ({why}) ====================")
        print(f"avoided: {[h['name'] for h in route['avoided_hotspots']] or 'none'}; identical routes: {route['identical_routes']}; "
              f"usual {route['normal_route']['distance_km']} km / {route['normal_route']['drive_time_min']} min; "
              f"detour {route['flood_aware_route']['distance_km']} km / {route['flood_aware_route']['drive_time_min']} min")
        for which in ("flood_aware", "normal") if not route["identical_routes"] else ("flood_aware",):
            steps, problems = show(f"{a} -> {b}", route, which)
            all_steps += [s for s in steps if s["maneuver"] not in ("depart", "arrive")]
            for p in problems:
                print("     PROBLEM:", p)
    named = sum(1 for s in all_steps if s["street"])
    print(f"\nShare of manoeuvre steps (excluding depart/arrive) that name a street: {named}/{len(all_steps)} = "
          f"{(100 * named / len(all_steps)) if all_steps else 0:.0f}%")
    kinds = {}
    for s in all_steps:
        kinds[s["maneuver"]] = kinds.get(s["maneuver"], 0) + 1
    print("Manoeuvres:", kinds)


if __name__ == "__main__":
    main()
