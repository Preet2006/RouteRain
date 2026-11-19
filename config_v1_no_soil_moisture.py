"""ARCHIVAL -- not imported by any script, not the live config.

This is the pre-soil-moisture Phase 7 baseline (RandomForest, calibrated,
test ROC-AUC 0.5873), kept for the paper's model-comparison section. The
live config is config.py, which reflects the final RandomForest + soil
moisture model (test ROC-AUC 0.6463 experimental / 0.6380 regenerated
through the production pipeline -- see the Phase 7 Report for the small,
explained discrepancy).

Original docstring below, preserved as-is:
---
Project-wide constants and file paths for RouteRain.

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
GREEN_MAX = 0.1025
YELLOW_MAX = 0.3173
