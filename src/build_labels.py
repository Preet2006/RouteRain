"""Phase 5: turn data/raw/flood_events.csv into clean, deduplicated labels.

Loads the manually-collected flood_events.csv and collapses rows that
describe the same real-world event at the same hotspot: rows with the same
hotspot_id whose dates fall within config.DATE_MATCH_TOLERANCE_DAYS of each
other are merged into one event, keeping the highest reported severity and
concatenating all source_urls. Deduplication is scoped per hotspot_id, so
different hotspots flooding on the same citywide rain day are never merged
into each other.

Severity 1-3 all count as flooded=1 for the primary label; the original
(post-merge, max) severity is kept as a separate column for later use.

Usage:
    python src/build_labels.py

Reads:  data/raw/flood_events.csv
Writes: data/processed/flood_labels_clean.csv
            (hotspot_id, date, flooded, severity, duration_hours, sources)
"""

import argparse
import sys

import pandas as pd

sys.path.insert(0, ".")
from config import FLOOD_EVENTS_CSV, PROCESSED_DIR, DATE_MATCH_TOLERANCE_DAYS
import os

OUTPUT_CSV = os.path.join(PROCESSED_DIR, "flood_labels_clean.csv")


def dedupe_hotspot_events(group):
    """Collapse rows within DATE_MATCH_TOLERANCE_DAYS of each other, per hotspot."""
    group = group.sort_values("date").reset_index(drop=True)
    merges = []  # list of (kept_row_dict, [original indices merged])
    clusters = []  # list of list-of-row-indices

    current_cluster = [0]
    for i in range(1, len(group)):
        prev_date = group.loc[current_cluster[-1], "date"]
        this_date = group.loc[i, "date"]
        if (this_date - prev_date).days <= DATE_MATCH_TOLERANCE_DAYS:
            current_cluster.append(i)
        else:
            clusters.append(current_cluster)
            current_cluster = [i]
    clusters.append(current_cluster)

    for cluster in clusters:
        rows = group.loc[cluster]
        merged = {
            "hotspot_id": rows.iloc[0]["hotspot_id"],
            "date": rows.loc[rows["severity"].idxmax(), "date"],
            "severity": rows["severity"].max(),
            "duration_hours": rows["duration_hours"].max(),
            "sources": ";".join(rows["source_url"].tolist()),
        }
        merges.append((merged, rows["date"].tolist(), len(cluster)))

    return merges


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    if not os.path.exists(FLOOD_EVENTS_CSV):
        print(f"FATAL: {FLOOD_EVENTS_CSV} not found.", file=sys.stderr)
        sys.exit(1)

    raw = pd.read_csv(FLOOD_EVENTS_CSV, parse_dates=["date"])
    if raw.empty:
        print("FATAL: flood_events.csv has no rows.", file=sys.stderr)
        sys.exit(1)

    raw_count = len(raw)
    merged_rows = []
    collapsed_log = []

    for hotspot_id, group in raw.groupby("hotspot_id"):
        merges = dedupe_hotspot_events(group)
        for merged, dates, n in merges:
            merged_rows.append(merged)
            if n > 1:
                collapsed_log.append((hotspot_id, dates, merged["severity"], merged["sources"]))

    clean = pd.DataFrame(merged_rows)
    clean["flooded"] = 1
    clean = clean[["hotspot_id", "date", "flooded", "severity", "duration_hours", "sources"]]
    clean = clean.sort_values(["hotspot_id", "date"]).reset_index(drop=True)
    clean.to_csv(OUTPUT_CSV, index=False)

    print(f"Raw events: {raw_count}", file=sys.stderr)
    print(f"Deduplicated events: {len(clean)}", file=sys.stderr)
    print(f"Collapsed groups: {len(collapsed_log)}", file=sys.stderr)
    for hotspot_id, dates, severity, sources in collapsed_log:
        date_strs = [d.strftime("%Y-%m-%d") for d in dates]
        print(f"  {hotspot_id}: merged {date_strs} -> severity {severity}", file=sys.stderr)

    print("\nPer-hotspot counts after dedup:", file=sys.stderr)
    print(clean.groupby("hotspot_id").size().to_string(), file=sys.stderr)
    print(f"\nWrote {OUTPUT_CSV} ({len(clean)} rows)", file=sys.stderr)


if __name__ == "__main__":
    main()
