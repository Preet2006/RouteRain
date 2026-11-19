"""Phase 2: build and verify data/raw/hotspots.csv.

Reads a hardcoded candidate list (Tier A: documented chronic flooders anchoring
this project; Tier B: MCG-survey-adjacent locations with independent news
citations), forward-geocodes each via OpenStreetMap Nominatim, reverse-geocodes
the result as an independent sanity check, and flags any hotspot whose resolved
address doesn't plausibly match its name as NEEDS_MANUAL_CHECK.

Does NOT auto-correct flagged coordinates -- a flagged row must be confirmed or
corrected by a human before Phase 3 uses it.

Usage:
    python src/verify_hotspots.py

Reads:  nothing (candidate list is defined in this file, see CANDIDATES below)
Writes: data/raw/hotspots.csv       (hotspot_id, name, lat, lon, type, notes)
        data/raw/hotspots_verification.csv
                (hotspot_id, name, lat, lon, type, notes, resolved_address, flag)
"""

import argparse
import csv
import sys
import time

import requests

sys.path.insert(0, ".")
from config import BASE_DIR, HOTSPOTS_CSV, RAW_DIR
import os
from dotenv import load_dotenv

VERIFICATION_CSV = os.path.join(RAW_DIR, "hotspots_verification.csv")

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
load_dotenv(os.path.join(BASE_DIR, ".env"))
USER_AGENT = os.environ.get("NOMINATIM_USER_AGENT", "RouteRain-Research-Project/1.0")
REQUEST_DELAY_SECONDS = 1.1  # Nominatim usage policy: max 1 req/sec

# Each candidate: (hotspot_id, name, search_query, type, notes)
CANDIDATES = [
    # --- Tier A: documented, independently sourced in prior project research ---
    (
        "H01",
        "Bilaspur Chowk",
        "Bilaspur Chowk, NH-48, Gurugram, Haryana, India",
        "chowk/highway",
        "Chronic waterlogging tied to stalled flyover (approved 2015, foundation "
        "2022) and a choked drain; Amar Ujala, Dec 2025: "
        "https://www.amarujala.com/delhi-ncr/gurgaon/the-drain-at-bilaspur-chowk-is-choked-and-stinks-gurgaon-news-c-24-1-gur1002-73731-2025-12-04",
    ),
    (
        "H02",
        "Rajiv Chowk",
        "Rajiv Chowk, Gurugram, Haryana, India",
        "chowk/underpass",
        "Recurring underpass closures during heavy rain; PTI/The Week, Sep 2025: "
        "https://www.theweek.in/wire-updates/national/2025/09/02/des56-ncr-rain-waterlogging.html",
    ),
    (
        "H03",
        "Hero Honda Chowk",
        "Hero Honda Chowk, Gurugram, Haryana, India",
        "chowk/underpass",
        "Named hypercritical/recurring hotspot in MCG surveys and listed among "
        "50 monsoon-prone spots; Tribune: "
        "https://www.tribuneindia.com/news/haryana/50-key-spots-prone-to-waterlogging-identified-268042",
    ),
    (
        "H04",
        "Narsingpur",
        "Narsinghpur, NH-48, Gurugram, Haryana, India",
        "low-lying highway stretch",
        "Lowest point on Delhi-Gurugram Expressway, no stormwater outlet, 3-4 ft "
        "water reported July 2025; road cave-in July 2026; Tribune: "
        "https://www.tribuneindia.com/news/haryana/monsoon-woes-stormwater-drain-to-come-up-in-gurugrams-narsinghpur",
    ),
    (
        "H05",
        "IFFCO Chowk",
        "IFFCO Chowk, Gurugram, Haryana, India",
        "chowk/underpass",
        "High-traffic intersection, repeated underpass closures and a sinkhole "
        "from a collapsed sewer line, Aug 2026: "
        "https://www.newsbytesapp.com/news/india/sinkhole-swallows-gurugram-s-iffco-chowk-service-road-25-foot-crater-appears/story",
    ),
    # --- Tier B: filled from MCG-survey-era news coverage, each independently reported ---
    (
        "H06",
        "Basai Chowk",
        "Basai Chowk, Gurugram, Haryana, India",
        "chowk",
        "Repeatedly listed among flooded spots across multiple monsoons incl. "
        "July 2025 (133mm rain) and Aug 2024; Tribune/PTI coverage; a state "
        "minister personally inspected this site post-flood.",
    ),
    (
        "H07",
        "Subhash Chowk",
        "Subhash Chowk, Gurugram, Haryana, India",
        "chowk",
        "2.5 ft water accumulation reported July 2025 (jam till 2am); nine "
        "school buses with 300+ children stranded in a separate event; Aug "
        "2026 WFH advisory issued partly due to this spot: "
        "https://www.republicworld.com/india/heavy-rain-triggers-waterlogging-traffic-jams-in-gurugram-offices-schools-to-operate-from-home-2026-08-24-135492",
    ),
    (
        "H08",
        "Sohna Road",
        "Sohna Road, Gurugram, Haryana, India",
        "arterial road",
        "Described as resembling 'a choked canal' in Tribune coverage; 150mm+ "
        "rain event made it near-impassable, vehicles abandoned: "
        "https://www.tribuneindia.com/news/haryana/rain-leaves-gurugram-faridabad-in-troubled-waters-635148",
    ),
    (
        "H09",
        "Golf Course Road",
        "Golf Course Road, Gurugram, Haryana, India",
        "arterial road",
        "Recurring waterlogging linked to Aravalli creek runoff and poor "
        "drainage; multi-day downpour coverage, Tribune: "
        "https://www.tribuneindia.com/news/haryana/heavy-downpour-poor-drainage-turn-gurugram-into-jalgram-643287",
    ),
    (
        "H10",
        "Sheetla Mata Road",
        "Sheetla Mata Road, Gurugram, Haryana, India",
        "road",
        "Called out by MCG Commissioner as a specific technical challenge; CM's "
        "convoy seen wading through water near here, 2026; 97mm rain made it "
        "the worst-affected stretch citywide: "
        "https://www.tribuneindia.com/news/haryana/97mm-rainfall-floods-millennium-city-again-old-gurugram-areas-worst-hit/",
    ),
    (
        "H11",
        "Sadar Bazaar",
        "Sadar Bazar, Gurugram, Haryana, India",
        "market area",
        "Heavy waterlogging at Agrasen Chowk within Sadar Bazaar, Sep 2025 "
        "(Amar Ujala video report); also flooded in July 2025 133mm event.",
    ),
    (
        "H12",
        "Artemis Road",
        "Artemis Hospital, Sector 51, Gurugram, Haryana, India",
        "road near hospital",
        "Listed among 30+ vulnerable spots in MCG/GMDA civic roadmap; pumps "
        "activated here during 2022 flood event alongside Sheetla Mata Road "
        "and Narsinghpur.",
    ),
]


def geocode(query):
    resp = requests.get(
        NOMINATIM_SEARCH_URL,
        params={"q": query, "format": "json", "limit": 1},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Nominatim search failed ({resp.status_code}) for: {query}")
    results = resp.json()
    if not results:
        raise RuntimeError(f"Nominatim search returned zero results for: {query}")
    return float(results[0]["lat"]), float(results[0]["lon"])


def reverse_geocode(lat, lon):
    resp = requests.get(
        NOMINATIM_REVERSE_URL,
        params={"lat": lat, "lon": lon, "format": "json"},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Nominatim reverse failed ({resp.status_code}) for: {lat},{lon}")
    result = resp.json()
    if "display_name" not in result:
        raise RuntimeError(f"Nominatim reverse returned no address for: {lat},{lon}")
    return result["display_name"]


def name_tokens(name):
    stopwords = {"chowk", "road", "near", "the", "of"}
    return {
        tok.lower()
        for tok in name.replace(",", " ").split()
        if tok.lower() not in stopwords and len(tok) > 2
    }


def plausibility_flag(name, resolved_address):
    name_toks = name_tokens(name)
    addr_lower = resolved_address.lower()
    if any(tok in addr_lower for tok in name_toks):
        return "OK"
    return "NEEDS_MANUAL_CHECK"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    rows = []
    unresolved = []
    for hotspot_id, name, query, htype, notes in CANDIDATES:
        print(f"Geocoding {hotspot_id} ({name})...", file=sys.stderr)
        try:
            lat, lon = geocode(query)
        except RuntimeError as e:
            print(f"WARNING: {e} -- skipping, needs manual coordinate.", file=sys.stderr)
            unresolved.append((hotspot_id, name, htype, notes))
            time.sleep(REQUEST_DELAY_SECONDS)
            continue
        time.sleep(REQUEST_DELAY_SECONDS)

        print(f"Reverse-geocoding {hotspot_id} ({lat},{lon})...", file=sys.stderr)
        try:
            resolved_address = reverse_geocode(lat, lon)
        except RuntimeError as e:
            print(f"FATAL: {e}", file=sys.stderr)
            sys.exit(1)
        time.sleep(REQUEST_DELAY_SECONDS)

        flag = plausibility_flag(name, resolved_address)
        rows.append(
            {
                "hotspot_id": hotspot_id,
                "name": name,
                "lat": lat,
                "lon": lon,
                "type": htype,
                "notes": notes,
                "resolved_address": resolved_address,
                "flag": flag,
            }
        )

    if unresolved:
        print(f"\n{len(unresolved)} hotspot(s) could NOT be geocoded at all:", file=sys.stderr)
        for hotspot_id, name, htype, notes in unresolved:
            print(f"  {hotspot_id} {name}", file=sys.stderr)

    with open(VERIFICATION_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "hotspot_id", "name", "lat", "lon", "type", "notes",
                "resolved_address", "flag",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {VERIFICATION_CSV}", file=sys.stderr)

    with open(HOTSPOTS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=["hotspot_id", "name", "lat", "lon", "type", "notes"]
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {k: row[k] for k in ["hotspot_id", "name", "lat", "lon", "type", "notes"]}
            )
    print(f"Wrote {HOTSPOTS_CSV}", file=sys.stderr)

    flagged = [r for r in rows if r["flag"] != "OK"]
    print(f"\n{len(rows)} hotspots geocoded. {len(flagged)} flagged NEEDS_MANUAL_CHECK.", file=sys.stderr)
    for r in flagged:
        print(f"  {r['hotspot_id']} {r['name']}: resolved to '{r['resolved_address']}'", file=sys.stderr)


if __name__ == "__main__":
    main()
