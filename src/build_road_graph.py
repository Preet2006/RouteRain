"""Phase 9: download and cache Gurugram/NCR's drivable road network.

One-time, slow step (can take several minutes). Downloads the full
drivable road network for Gurugram via OpenStreetMap (osmnx) and caches it
to data/external/road_graph.graphml. The Streamlit app and route_planner.py
load this cached file and never re-download automatically -- re-run this
script explicitly (or pass --force) only if the file is missing or you want
a fresh pull.

Usage:
    python src/build_road_graph.py            # skip if cache already exists
    python src/build_road_graph.py --force     # re-download even if cached

Reads:  nothing (downloads from OpenStreetMap via osmnx)
Writes: data/external/road_graph.graphml
"""

import argparse
import sys

import osmnx as ox

sys.path.insert(0, ".")
from config import EXTERNAL_DIR
import os

ROAD_GRAPH_PATH = os.path.join(EXTERNAL_DIR, "road_graph.graphml")
PLACE_NAME = "Gurugram, Haryana, India"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-download even if the cache already exists")
    args = parser.parse_args()

    if os.path.exists(ROAD_GRAPH_PATH) and not args.force:
        print(f"Cache already exists at {ROAD_GRAPH_PATH} -- skipping download. Use --force to refresh.", file=sys.stderr)
        sys.exit(0)

    print(f"Downloading drivable road network for '{PLACE_NAME}' via OpenStreetMap "
          f"(this can take several minutes)...", file=sys.stderr)
    graph = ox.graph_from_place(PLACE_NAME, network_type="drive")
    print(f"Downloaded graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges.", file=sys.stderr)

    print("Adding travel_time edge attribute (via free-flow speed estimate)...", file=sys.stderr)
    graph = ox.add_edge_speeds(graph)
    graph = ox.add_edge_travel_times(graph)

    os.makedirs(EXTERNAL_DIR, exist_ok=True)
    ox.save_graphml(graph, ROAD_GRAPH_PATH)
    print(f"Wrote {ROAD_GRAPH_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
