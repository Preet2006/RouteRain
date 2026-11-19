"""Phase 3: compute terrain features for every verified hotspot.

For each hotspot in data/raw/hotspots.csv, opens the SRTM DEM tile and
extracts a radius-based window (config.TERRAIN_RADIUS_CELLS cells) around
the hotspot's pixel, then derives:

  elevation_m     -- DEM value at the hotspot's own pixel
  slope_deg       -- local slope. richdem is unavailable on this machine
                     (see Phase 1 report), so this uses the numpy-only
                     fallback: degrees(arctan(nanstd(window) / pixel_size_m)),
                     treating the local elevation standard deviation as a
                     proxy for rise-over-run against the DEM's ~30m pixel size.
  sink_depth_m    -- how far below its surroundings the hotspot sits:
                     mean(window) - elevation_at_point. Positive means the
                     point is a local depression (sink) relative to its
                     neighborhood -- exactly what you'd expect for a
                     waterlogging-prone spot.
  catchment_cells -- count of window cells strictly higher than the
                     hotspot's own elevation, i.e. cells that could
                     physically drain toward this point. A simple proxy
                     for contributing catchment area, not a real flow-
                     accumulation algorithm (that needs richdem).

Usage:
    python src/build_terrain.py

Reads:  data/raw/hotspots.csv
        data/external/dem/gurugram_ncr.tif
Writes: data/processed/terrain_features.csv
"""

import argparse
import sys

import numpy as np
import pandas as pd
import rasterio

sys.path.insert(0, ".")
from config import HOTSPOTS_CSV, DEM_PATH, PROCESSED_DIR, TERRAIN_RADIUS_CELLS
import os

OUTPUT_CSV = os.path.join(PROCESSED_DIR, "terrain_features.csv")


def get_window(data, row, col, radius, nodata):
    row_lo, row_hi = max(0, row - radius), min(data.shape[0], row + radius + 1)
    col_lo, col_hi = max(0, col - radius), min(data.shape[1], col + radius + 1)
    window = data[row_lo:row_hi, col_lo:col_hi].astype(float)
    if nodata is not None:
        window = np.where(window == nodata, np.nan, window)
    return window


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    if not os.path.exists(HOTSPOTS_CSV):
        print(f"FATAL: {HOTSPOTS_CSV} not found.", file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(DEM_PATH):
        print(f"FATAL: {DEM_PATH} not found. Run the DEM download step first.", file=sys.stderr)
        sys.exit(1)

    hotspots = pd.read_csv(HOTSPOTS_CSV)
    if hotspots.empty:
        print("FATAL: hotspots.csv has no rows.", file=sys.stderr)
        sys.exit(1)

    with rasterio.open(DEM_PATH) as dem:
        data = dem.read(1)
        nodata = dem.nodata
        # SRTM 1-arc-second pixel size in meters, used by the slope fallback.
        pixel_size_m = dem.res[0] * 111320.0  # ~30m at this latitude

        rows = []
        for _, hs in hotspots.iterrows():
            row, col = dem.index(hs["lon"], hs["lat"])
            if not (0 <= row < data.shape[0] and 0 <= col < data.shape[1]):
                print(
                    f"FATAL: hotspot {hs['hotspot_id']} ({hs['name']}) falls outside "
                    f"the DEM extent -- check its coordinates or the DEM bounding box.",
                    file=sys.stderr,
                )
                sys.exit(1)

            elevation_m = float(data[row, col])
            if nodata is not None and elevation_m == nodata:
                print(
                    f"FATAL: hotspot {hs['hotspot_id']} ({hs['name']}) landed on a "
                    f"NODATA DEM pixel.",
                    file=sys.stderr,
                )
                sys.exit(1)

            window = get_window(data, row, col, TERRAIN_RADIUS_CELLS, nodata)

            slope_deg = float(np.degrees(np.arctan(np.nanstd(window) / pixel_size_m)))
            sink_depth_m = float(np.nanmean(window) - elevation_m)
            catchment_cells = int(np.sum(window > elevation_m))

            rows.append(
                {
                    "hotspot_id": hs["hotspot_id"],
                    "name": hs["name"],
                    "elevation_m": elevation_m,
                    "slope_deg": slope_deg,
                    "sink_depth_m": sink_depth_m,
                    "catchment_cells": catchment_cells,
                }
            )

    out = pd.DataFrame(rows)
    out.to_csv(OUTPUT_CSV, index=False)
    print(f"Wrote {OUTPUT_CSV} ({len(out)} rows)", file=sys.stderr)
    print(out.to_string(index=False), file=sys.stderr)


if __name__ == "__main__":
    main()
