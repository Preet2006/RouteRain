"""Project-wide constants and file paths for RouteRain.

Single source of truth for hotspot/flood-event file locations, DEM path,
processed-data directory, and thresholds used across later phases.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATA_DIR = os.path.join(BASE_DIR, "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")
EXTERNAL_DIR = os.path.join(DATA_DIR, "external")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")

HOTSPOTS_CSV = os.path.join(RAW_DIR, "hotspots.csv")
FLOOD_EVENTS_CSV = os.path.join(RAW_DIR, "flood_events.csv")

DEM_PATH = os.path.join(EXTERNAL_DIR, "dem", "gurugram_ncr.tif")
RAINFALL_RAW_DIR = os.path.join(EXTERNAL_DIR, "rainfall_raw")

# Phase 3 — terrain feature extraction
TERRAIN_RADIUS_CELLS = 17

# Phase 4/6 — rainfall threshold (mm) above which a day is a "rain day" candidate
RAIN_THRESHOLD_MM = 10

# Phase 5/6 — days of tolerance when matching a reported flood event to a rain day
DATE_MATCH_TOLERANCE_DAYS = 1

# Phase 7 — risk tier thresholds, recalibrated from the trained model's own
# predicted-probability distribution on the 2025-2026 test set (50th and
# 85th percentiles), replacing the original placeholder 0.30/0.60 which
# predated this model and left YELLOW/RED barely distinguishable.
GREEN_MAX = 0.0657
YELLOW_MAX = 0.2838

# Mobile app (MOBILE_APP_PLAN.md section 2.1) -------------------------------
# ASSUMPTION, not measured data: minutes a driver loses when a hotspot they pass
# actually floods, by reported severity (flood_events.csv: 1 = minor pooling,
# 2 = traffic disrupted, 3 = road closed). Owner decision (M0): do NOT change
# FLOOD_SEVERITY_DELAY_MIN or FLOOD_DELAY_MIN after routes have been scored
# without asking the project owner.
FLOOD_SEVERITY_DELAY_MIN = {"minor": 5, "disrupted": 20, "closed": 45}


def _severity_weighted_delay_min():
    """Tier-independent delay: average of FLOOD_SEVERITY_DELAY_MIN weighted by how
    often each severity appears in data/raw/flood_events.csv."""
    import csv

    names = {"1": "minor", "2": "disrupted", "3": "closed"}
    counts = {"minor": 0, "disrupted": 0, "closed": 0}
    with open(FLOOD_EVENTS_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = names.get(str(row["severity"]).strip())
            if key is None:
                raise ValueError(f"FATAL: unexpected severity {row['severity']!r} in {FLOOD_EVENTS_CSV}")
            counts[key] += 1
    total = sum(counts.values())
    if total == 0:
        raise ValueError(f"FATAL: no flood events in {FLOOD_EVENTS_CSV}")
    return sum(FLOOD_SEVERITY_DELAY_MIN[k] * n for k, n in counts.items()) / total


FLOOD_DELAY_MIN = _severity_weighted_delay_min()

# Replay days for the mobile Scenario switch (all in the 2025-2026 test period).
MOBILE_REPLAY_DATES = ["2026-08-07", "2026-07-08", "2025-07-31", "2025-07-09"]

# How long /mobile/v1/route results stay cached for /narrate.
ROUTE_CACHE_TTL_MIN = 30
