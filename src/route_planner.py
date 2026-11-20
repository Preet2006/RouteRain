"""Phase 9 Part B: flood-aware rerouting on top of the cached road graph.

Loads the cached Gurugram road graph (built once by build_road_graph.py --
never re-downloaded here), buffers each RED/YELLOW hotspot's coordinate
(500m for RED, 300m for YELLOW), finds every graph edge intersecting that
buffer, and builds a PENALIZED copy of the graph where those edges'
travel_time and length are multiplied (x15 RED, x3 YELLOW) -- never
deleted, so the real road stays usable as a last resort if there's truly
no alternative.

Given an origin and destination, resolve_location() turns free-text input
into coordinates in three steps:
  1. Fuzzy-match against the 12 known hotspot names (data/raw/hotspots.csv)
     first -- "Golf Course Road" or "Golf Course Rd" resolves directly to
     H09's verified coordinate, never an ambiguous external search result.
  2. If no hotspot match, geocode via Nominatim, bounded to the Gurugram/NCR
     area (a viewbox derived from hotspots.csv's min/max lat/lon + buffer)
     so an ambiguous place name can't resolve somewhere far away.
  3. Reject the result if its nearest road-graph node is implausibly far
     (> OUT_OF_AREA_THRESHOLD_KM) -- catches both bad geocodes and genuinely
     out-of-area requests (e.g. "Indore") rather than silently routing
     through nonsense.

Then computes both:
  normal_route       -- shortest path on the unmodified graph
  flood_aware_route   -- shortest path on the penalized graph
and reports distance, travel time, and which hotspot(s) (if any) the
flood-aware route avoided relative to the normal route.

Usage:
    python src/route_planner.py --origin "Sector 29, Gurugram" --destination "Sector 54, Gurugram"
    python src/route_planner.py --origin_lat 28.47 --origin_lon 77.07 \\
        --dest_lat 28.45 --dest_lon 77.10

Reads:  data/external/road_graph.graphml (via build_road_graph.py)
        data/raw/hotspots.csv
        data/processed/terrain_features.csv
        data/processed/training_data.csv
        models/risk_model.pkl, config.py
        data/processed/weather_forecast.csv (today's live tiers)
Writes: nothing
"""

import argparse
import difflib
import sys
import threading
import weakref

import geopandas as gpd
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
from scipy.spatial import cKDTree
from dotenv import load_dotenv
from geopy.distance import geodesic
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter
from shapely.geometry import Point

sys.path.insert(0, ".")
from config import BASE_DIR, EXTERNAL_DIR, HOTSPOTS_CSV, GREEN_MAX, YELLOW_MAX
from src.polyline import simplify_polyline
import os

ROAD_GRAPH_PATH = os.path.join(EXTERNAL_DIR, "road_graph.graphml")
METRIC_CRS = "EPSG:32643"  # UTM zone 43N, metres
RED_BUFFER_M = 500
YELLOW_BUFFER_M = 300
RED_PENALTY = 15
YELLOW_PENALTY = 3
load_dotenv(os.path.join(BASE_DIR, ".env"))
# Nominatim requires an identifying User-Agent; the contact lives in .env, not in code.
USER_AGENT = os.environ.get("NOMINATIM_USER_AGENT", "RouteRain-Research-Project/1.0")

HOTSPOT_MATCH_CUTOFF = 0.8  # difflib similarity ratio, 0-1 -- 0.6 was tried first and
    # produced a real false positive ("Jaipur" matched "Narsingpur" at 0.625); legitimate
    # matches (including abbreviations like "Golf Course Rd") score 0.93-1.0, so 0.8 keeps
    # a comfortable margin above every false positive found during testing (max 0.625)
    # while still accepting every real near-match tried.
GEOCODE_BBOX_BUFFER_DEG = 0.15  # wider than the Phase 3 DEM buffer (0.05) -- routing
                                 # needs to cover addresses well beyond the hotspots themselves
OUT_OF_AREA_THRESHOLD_KM = 15

_graph_cache = None
_hotspots_cache = None


def _load_hotspots():
    global _hotspots_cache
    if _hotspots_cache is None:
        _hotspots_cache = pd.read_csv(HOTSPOTS_CSV)
    return _hotspots_cache


def _geocode_bbox():
    hotspots = _load_hotspots()
    buf = GEOCODE_BBOX_BUFFER_DEG
    min_lat, max_lat = hotspots["lat"].min() - buf, hotspots["lat"].max() + buf
    min_lon, max_lon = hotspots["lon"].min() - buf, hotspots["lon"].max() + buf
    return min_lat, max_lat, min_lon, max_lon


def load_road_graph():
    """Loads the cached graph. Never downloads -- fails loudly if missing."""
    global _graph_cache
    if _graph_cache is not None:
        return _graph_cache
    if not os.path.exists(ROAD_GRAPH_PATH):
        raise FileNotFoundError(
            f"FATAL: {ROAD_GRAPH_PATH} not found. Run src/build_road_graph.py once first -- "
            f"this is a slow one-time download, never triggered automatically."
        )
    _graph_cache = ox.load_graphml(ROAD_GRAPH_PATH)
    return _graph_cache


def match_hotspot(text):
    """Fuzzy-matches free text against the 12 known hotspot names. Returns
    the matching hotspots.csv row (as a dict) or None if nothing clears
    HOTSPOT_MATCH_CUTOFF. Case-insensitive, tolerant of minor wording
    differences ("Golf Course Rd" vs "Golf Course Road")."""
    hotspots = _load_hotspots()
    names = hotspots["name"].str.lower().tolist()
    matches = difflib.get_close_matches(text.strip().lower(), names, n=1, cutoff=HOTSPOT_MATCH_CUTOFF)
    if not matches:
        return None
    row = hotspots[hotspots["name"].str.lower() == matches[0]].iloc[0]
    return row.to_dict()


NOMINATIM_MIN_DELAY_S = 1.1  # Nominatim usage policy: at most 1 request/second
_geocode_lock = threading.Lock()
_limited_geocode = None


def _get_limited_geocode():
    """One process-wide rate-limited Nominatim geocoder (created lazily, reused
    by every call -- the limit is only enforced if the limiter object persists)."""
    global _limited_geocode
    if _limited_geocode is None:
        geolocator = Nominatim(user_agent=USER_AGENT)
        _limited_geocode = RateLimiter(geolocator.geocode, min_delay_seconds=NOMINATIM_MIN_DELAY_S)
    return _limited_geocode


def geocode_bounded(address):
    """Nominatim geocode, bounded to the Gurugram/NCR area (hotspots.csv's
    bounding box + buffer) so an ambiguous place name can't resolve
    somewhere far outside the coverage area."""
    min_lat, max_lat, min_lon, max_lon = _geocode_bbox()
    # geopy's Nominatim.geocode expects viewbox as two (lat, lon) point tuples.
    # The lock serialises callers (FastAPI runs sync endpoints in a thread pool) so
    # the single shared limiter really enforces the 1 request/second policy.
    with _geocode_lock:
        location = _get_limited_geocode()(
            address,
            viewbox=[(max_lat, min_lon), (min_lat, max_lon)],
            bounded=True,
        )
    if location is None:
        raise ValueError(f"FATAL: could not geocode '{address}' within the Gurugram/NCR area.")
    return location.latitude, location.longitude


def resolve_location(text):
    """Three-step resolution: hotspot fuzzy-match -> bounded Nominatim
    geocode -> out-of-area distance check against the road graph. Returns
    {"lat", "lon", "label", "source"} or raises ValueError with a plain
    message if the point is implausibly far from the covered road network."""
    hotspot = match_hotspot(text)
    if hotspot is not None:
        lat, lon = hotspot["lat"], hotspot["lon"]
        label = f"{hotspot['name']} hotspot"
        source = "hotspot_match"
    else:
        lat, lon = geocode_bounded(text)
        label = text
        source = "geocoded"

    graph = load_road_graph()
    nearest_node = ox.distance.nearest_nodes(graph, lon, lat)
    node_lat, node_lon = graph.nodes[nearest_node]["y"], graph.nodes[nearest_node]["x"]
    distance_km = geodesic((lat, lon), (node_lat, node_lon)).km
    if distance_km > OUT_OF_AREA_THRESHOLD_KM:
        raise ValueError(
            f"'{text}' appears to be outside RouteRain's coverage area (Gurugram/NCR). "
            f"This demo only covers the 12 monitored hotspots and surrounding roads."
        )

    return {"lat": lat, "lon": lon, "label": label, "source": source}


def geocode(address):
    """Kept for the simple CLI path (--origin/--destination without the
    hotspot-match/bounding logic) -- prefer resolve_location() elsewhere."""
    return geocode_bounded(address)


def build_penalized_graph(graph, active_hotspots):
    """active_hotspots: list of dicts {hotspot_id, name, lat, lon, tier}.
    Returns a copy of `graph` with edges inside each RED/YELLOW hotspot's
    buffer penalized (length and travel_time multiplied), never deleted."""
    penalized = graph.copy()
    edges_gdf = ox.graph_to_gdfs(graph, nodes=False, edges=True)
    # Project to a local metric CRS so buffer distances are in real meters,
    # not degrees -- UTM zone 43N covers Gurugram (77E).
    edges_proj = ox.projection.project_gdf(edges_gdf)
    crs = edges_proj.crs

    touched_edges_by_hotspot = {}
    for hs in active_hotspots:
        if hs["tier"] not in ("RED", "YELLOW"):
            continue
        buffer_m = RED_BUFFER_M if hs["tier"] == "RED" else YELLOW_BUFFER_M
        penalty = RED_PENALTY if hs["tier"] == "RED" else YELLOW_PENALTY

        point_gdf = ox.projection.project_gdf(
            gpd.GeoDataFrame(geometry=[Point(hs["lon"], hs["lat"])], crs="EPSG:4326")
        )
        buffer_geom = point_gdf.geometry.iloc[0].buffer(buffer_m)
        intersecting = edges_proj[edges_proj.geometry.intersects(buffer_geom)]
        touched = list(intersecting.index)
        touched_edges_by_hotspot[hs["hotspot_id"]] = touched

        for u, v, k in touched:
            edge = penalized.edges[u, v, k]
            edge["length"] = edge.get("length", 1.0) * penalty
            edge["travel_time"] = edge.get("travel_time", 1.0) * penalty

    return penalized, touched_edges_by_hotspot


_graph_caches = weakref.WeakKeyDictionary()  # graph -> {"geoms": projected edge geometries, "buffers": {...}}
_cache_lock = threading.RLock()


def _edge_cache(graph):
    """Projected edge geometries (geometry only, built once per graph per process)
    plus a cache of buffer -> edge-id sets. Replaces the old per-request graph copy."""
    with _cache_lock:
        cache = _graph_caches.get(graph)
        if cache is None:
            # Project to a local metric CRS so buffer distances are real metres
            # (UTM zone 43N covers Gurugram).
            # Fixed UTM zone 43N: osmnx's project_gdf would union all 124k road lines just to pick the zone
            # (slow, and it spikes memory). Gurugram (77 E) is always zone 43N, the same CRS it would choose.
            edges = ox.graph_to_gdfs(graph, nodes=False, edges=True).to_crs(METRIC_CRS)
            cache = {"geoms": edges.geometry, "buffers": {}}
            _graph_caches[graph] = cache
        return cache


def buffer_edges(graph, lat, lon, buffer_m):
    """frozenset of (u, v, k) edge ids whose geometry intersects a circle of
    buffer_m metres around (lat, lon). Depends only on the location and radius,
    never on the day's tier, so it is computed once and reused across requests
    and scenarios."""
    cache = _edge_cache(graph)
    key = (round(float(lat), 7), round(float(lon), 7), float(buffer_m))
    with _cache_lock:
        hit = cache["buffers"].get(key)
        if hit is None:
            geoms = cache["geoms"]
            point = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(geoms.crs)
            positions = geoms.sindex.query(point.iloc[0].buffer(buffer_m), predicate="intersects")
            hit = frozenset(geoms.index[positions])
            cache["buffers"][key] = hit
        return hit


def build_edge_penalties(graph, active_hotspots, *, red_buffer_m=RED_BUFFER_M, yellow_buffer_m=YELLOW_BUFFER_M,
                         red_penalty=RED_PENALTY, yellow_penalty=YELLOW_PENALTY):
    """Returns (penalties, touched_by_hotspot). penalties maps an edge id to the
    tuple of factors to apply, in hotspot order (an edge inside two buffers is
    multiplied twice, exactly as build_penalized_graph does). No graph copy."""
    penalties = {}
    touched_by_hotspot = {}
    for hs in active_hotspots:
        if hs["tier"] not in ("RED", "YELLOW"):
            continue
        is_red = hs["tier"] == "RED"
        touched = buffer_edges(graph, hs["lat"], hs["lon"], red_buffer_m if is_red else yellow_buffer_m)
        touched_by_hotspot[hs["hotspot_id"]] = touched
        factor = red_penalty if is_red else yellow_penalty
        for edge_id in touched:
            penalties.setdefault(edge_id, []).append(factor)
    return penalties, touched_by_hotspot


def penalty_weight_function(penalties):
    """networkx weight function: travel_time x penalties, minimum over parallel
    edges (the same rule nx applies for a string weight on a MultiDiGraph)."""
    def weight(u, v, parallel_edges):
        best = float("inf")
        for k, data in parallel_edges.items():
            w = data.get("travel_time", 1.0)
            for factor in penalties.get((u, v, k), ()):
                w = w * factor
            if w < best:
                best = w
        return best
    return weight


def hotspots_near_path(graph, path, hotspots, *, red_buffer_m=RED_BUFFER_M, yellow_buffer_m=YELLOW_BUFFER_M,
                       other_buffer_m=None):
    """Every hotspot (GREEN and unscored included, not just RED/YELLOW) whose
    buffer touches the route's edges. RED uses red_buffer_m, YELLOW uses
    yellow_buffer_m and every other tier uses other_buffer_m (default: the
    YELLOW buffer). Returns copies of the hotspot dicts plus 'buffer_m'."""
    other = yellow_buffer_m if other_buffer_m is None else other_buffer_m
    path_pairs = set(zip(path[:-1], path[1:]))
    near = []
    for hs in hotspots:
        buffer_m = red_buffer_m if hs["tier"] == "RED" else (yellow_buffer_m if hs["tier"] == "YELLOW" else other)
        touched = buffer_edges(graph, hs["lat"], hs["lon"], buffer_m)
        touched_pairs = {(u, v) for u, v, k in touched} | {(v, u) for u, v, k in touched}
        if touched_pairs & path_pairs:
            near.append({**hs, "buffer_m": buffer_m})
    return near


def _min_weight_edge_data(graph, u, v, attr):
    """graph is a MultiDiGraph -- pick the parallel edge (u, v, k) with the
    lowest `attr`, matching what nx.shortest_path's weight actually used."""
    parallel = graph.get_edge_data(u, v)
    return min(parallel.values(), key=lambda d: d.get(attr, float("inf")))


def route_metrics(graph, path):
    length_m = sum(_min_weight_edge_data(graph, path[i], path[i + 1], "travel_time").get("length", 0)
                   for i in range(len(path) - 1))
    time_s = sum(_min_weight_edge_data(graph, path[i], path[i + 1], "travel_time").get("travel_time", 0)
                 for i in range(len(path) - 1))
    return length_m, time_s


def point_inside_hotspot_buffer(lat, lon, hotspot, red_buffer_m=RED_BUFFER_M, yellow_buffer_m=YELLOW_BUFFER_M):
    """True if (lat, lon) itself falls within hotspot's RED/YELLOW buffer
    radius. Used to distinguish 'you're starting inside a flood zone, there's
    nowhere better to go from here' from the ordinary 'no reroute needed'
    case -- those are very different situations and must not share a message."""
    if hotspot["tier"] not in ("RED", "YELLOW"):
        return False
    buffer_m = red_buffer_m if hotspot["tier"] == "RED" else yellow_buffer_m
    return geodesic((lat, lon), (hotspot["lat"], hotspot["lon"])).meters <= buffer_m


NO_ROUTE_MESSAGE = "No drivable route found between these points."
MAX_SNAP_M = 1000  # a point may be moved at most this far when snapping to the main road network


class NoDrivableRouteError(nx.NetworkXNoPath):
    """No drivable route exists, even after snapping to the main road network.
    Deliberately NOT a ValueError, so the existing web /api/route keeps returning
    the generic 502 it always did; the mobile endpoint catches this class for its 422."""


_scc_caches = weakref.WeakKeyDictionary()


def _scc_index(graph):
    """Largest strongly connected component of the graph, plus a KD-tree for nearest-node
    lookups inside it. Built once per graph (about a second for the Gurugram graph)."""
    with _cache_lock:
        index = _scc_caches.get(graph)
        if index is None:
            ids = list(max(nx.strongly_connected_components(graph), key=len))
            lats = np.array([graph.nodes[n]["y"] for n in ids])
            lons = np.array([graph.nodes[n]["x"] for n in ids])
            lon_scale = float(np.cos(np.radians(lats.mean())))
            index = {"ids": ids, "members": frozenset(ids), "lon_scale": lon_scale,
                     "tree": cKDTree(np.column_stack([lats, lons * lon_scale]))}
            _scc_caches[graph] = index
        return index


def _node_distance_m(graph, node, latlon):
    return geodesic(latlon, (graph.nodes[node]["y"], graph.nodes[node]["x"])).meters


def _snap_to_main_component(graph, origin_latlon, dest_latlon, max_snap_m):
    index = _scc_index(graph)
    snapped = []
    for lat, lon in (origin_latlon, dest_latlon):
        node = ox.distance.nearest_nodes(graph, lon, lat)
        if node not in index["members"]:
            _, i = index["tree"].query([lat, lon * index["lon_scale"]])
            node = index["ids"][int(i)]
            if _node_distance_m(graph, node, (lat, lon)) > max_snap_m:
                raise NoDrivableRouteError(NO_ROUTE_MESSAGE)
        snapped.append(node)
    return snapped[0], snapped[1]


def path_coordinates(graph, path, use_edge_geometry=True):
    """[[lat, lon], ...] along the route. With use_edge_geometry the line follows each road's
    real shape (osmnx edge 'geometry'); edges without one fall back to a straight node-to-node
    segment. Parallel edges are resolved the same way route_metrics does (lowest travel_time)."""
    if len(path) == 1:
        node = graph.nodes[path[0]]
        return [[node["y"], node["x"]]]
    coords = []
    for u, v in zip(path[:-1], path[1:]):
        un, vn = graph.nodes[u], graph.nodes[v]
        geom = _min_weight_edge_data(graph, u, v, "travel_time").get("geometry") if use_edge_geometry else None
        if geom is None:
            pts = [(un["y"], un["x"]), (vn["y"], vn["x"])]
        else:
            pts = [(y, x) for x, y in geom.coords]
            if ((pts[-1][0] - un["y"]) ** 2 + (pts[-1][1] - un["x"]) ** 2
                    < (pts[0][0] - un["y"]) ** 2 + (pts[0][1] - un["x"]) ** 2):
                pts.reverse()  # make sure the segment runs u -> v
        coords.extend(pts if not coords else pts[1:])  # drop the duplicated joint
    return [[float(y), float(x)] for y, x in coords]


def route_polyline(graph, path, max_points=300):
    """Edge-geometry polyline simplified (Douglas-Peucker) to at most max_points points."""
    return simplify_polyline(path_coordinates(graph, path), max_points)


def graph_loaded():
    return _graph_cache is not None


def warm_up():
    """Server startup: load the road graph and build everything the first request would
    otherwise pay for -- projected edge geometries, the main strongly connected component
    and the buffer edge sets of the 12 hotspots at both radii."""
    graph = load_road_graph()
    _edge_cache(graph)
    _scc_index(graph)
    for hs in _load_hotspots().itertuples():
        for radius in (RED_BUFFER_M, YELLOW_BUFFER_M):
            buffer_edges(graph, hs.lat, hs.lon, radius)
    return graph


def plan_route(origin_latlon, dest_latlon, active_hotspots, *, red_buffer_m=RED_BUFFER_M,
               yellow_buffer_m=YELLOW_BUFFER_M, red_penalty=RED_PENALTY, yellow_penalty=YELLOW_PENALTY,
               include_proximity=False, graph=None, max_snap_m=MAX_SNAP_M):
    """Buffers and penalties default to the module constants, so existing callers
    (the web /api/route) behave exactly as before. Per-request overrides (e.g.
    yellow_penalty=1 for 'balanced') never touch module state. include_proximity
    adds 'normal_near_hotspots' / 'flood_aware_near_hotspots' (every hotspot,
    GREEN included, near each route) for the expected-time maths."""
    if graph is None:
        graph = load_road_graph()
    orig_node = ox.distance.nearest_nodes(graph, origin_latlon[1], origin_latlon[0])
    dest_node = ox.distance.nearest_nodes(graph, dest_latlon[1], dest_latlon[0])

    try:
        normal_path = nx.shortest_path(graph, orig_node, dest_node, weight="travel_time")
    except nx.NetworkXNoPath:
        # The graph is directed: a point can snap to a one-way pocket. Only now (so every
        # route that used to work is unchanged) snap to the largest strongly connected part.
        orig_node, dest_node = _snap_to_main_component(graph, origin_latlon, dest_latlon, max_snap_m)
        try:
            normal_path = nx.shortest_path(graph, orig_node, dest_node, weight="travel_time")
        except nx.NetworkXNoPath as exc:
            raise NoDrivableRouteError(NO_ROUTE_MESSAGE) from exc
    normal_length_m, normal_time_s = route_metrics(graph, normal_path)

    # No graph copy: precomputed buffer edge sets + a weight function (see 5c in MOBILE_APP_PLAN).
    penalties, touched_edges_by_hotspot = build_edge_penalties(
        graph, active_hotspots, red_buffer_m=red_buffer_m, yellow_buffer_m=yellow_buffer_m,
        red_penalty=red_penalty, yellow_penalty=yellow_penalty)
    flood_aware_path = nx.shortest_path(graph, orig_node, dest_node, weight=penalty_weight_function(penalties))
    # Report real-world (unpenalized) cost of the flood-aware path for an honest comparison.
    flood_aware_length_m, flood_aware_time_s = route_metrics(graph, flood_aware_path)

    normal_edge_set = set(zip(normal_path[:-1], normal_path[1:]))
    flood_aware_edge_set = set(zip(flood_aware_path[:-1], flood_aware_path[1:]))

    avoided_hotspots = []
    still_passes_through = []
    for hs in active_hotspots:
        if hs["tier"] not in ("RED", "YELLOW"):
            continue
        touched = touched_edges_by_hotspot.get(hs["hotspot_id"], [])
        touched_pairs = {(u, v) for u, v, k in touched} | {(v, u) for u, v, k in touched}
        normal_passes = bool(touched_pairs & normal_edge_set)
        flood_aware_passes = bool(touched_pairs & flood_aware_edge_set)
        if normal_passes and not flood_aware_passes:
            avoided_hotspots.append(hs)
        elif flood_aware_passes:
            still_passes_through.append(hs)

    # Origin/destination sitting INSIDE a hotspot's own buffer is a distinct
    # situation from "the route happens to pass near a hotspot mid-route":
    # there, a genuinely nearby alternative may not exist at all, since every
    # path out shares the same unavoidable first/last penalized edges. This
    # is reported separately so the product can give an honest message
    # ("you're starting inside the risk, not just near it") instead of a
    # plain "no reroute needed" that would misleadingly imply no risk nearby.
    origin_inside = [hs for hs in active_hotspots
                     if point_inside_hotspot_buffer(*origin_latlon, hs, red_buffer_m, yellow_buffer_m)]
    dest_inside = [hs for hs in active_hotspots
                   if point_inside_hotspot_buffer(*dest_latlon, hs, red_buffer_m, yellow_buffer_m)]

    result = {
        "normal_route": {"path": normal_path, "length_m": normal_length_m, "time_s": normal_time_s},
        "flood_aware_route": {"path": flood_aware_path, "length_m": flood_aware_length_m, "time_s": flood_aware_time_s},
        "avoided_hotspots": avoided_hotspots,
        "still_passes_through": still_passes_through,
        "origin_inside_hotspots": origin_inside,
        "dest_inside_hotspots": dest_inside,
        # Additive keys (the web API ignores them): how far each point is from the road node used.
        "origin_node_distance_m": _node_distance_m(graph, orig_node, origin_latlon),
        "dest_node_distance_m": _node_distance_m(graph, dest_node, dest_latlon),
    }
    if include_proximity:
        near_kwargs = {"red_buffer_m": red_buffer_m, "yellow_buffer_m": yellow_buffer_m}
        result["normal_near_hotspots"] = hotspots_near_path(graph, normal_path, active_hotspots, **near_kwargs)
        result["flood_aware_near_hotspots"] = hotspots_near_path(graph, flood_aware_path, active_hotspots, **near_kwargs)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--origin")
    parser.add_argument("--destination")
    parser.add_argument("--origin_lat", type=float)
    parser.add_argument("--origin_lon", type=float)
    parser.add_argument("--dest_lat", type=float)
    parser.add_argument("--dest_lon", type=float)
    args = parser.parse_args()

    if args.origin and args.destination:
        origin_resolved = resolve_location(args.origin)
        dest_resolved = resolve_location(args.destination)
        origin_latlon = (origin_resolved["lat"], origin_resolved["lon"])
        dest_latlon = (dest_resolved["lat"], dest_resolved["lon"])
        print(f"Origin resolved to: {origin_resolved['label']} ({origin_resolved['lat']:.6f}, "
              f"{origin_resolved['lon']:.6f}) via {origin_resolved['source']}", file=sys.stderr)
        print(f"Destination resolved to: {dest_resolved['label']} ({dest_resolved['lat']:.6f}, "
              f"{dest_resolved['lon']:.6f}) via {dest_resolved['source']}", file=sys.stderr)
    elif all(v is not None for v in (args.origin_lat, args.origin_lon, args.dest_lat, args.dest_lon)):
        origin_latlon = (args.origin_lat, args.origin_lon)
        dest_latlon = (args.dest_lat, args.dest_lon)
        print(f"Origin: {origin_latlon}  Destination: {dest_latlon}", file=sys.stderr)
    else:
        print("FATAL: provide either --origin/--destination (addresses) or all four --origin_lat/lon --dest_lat/lon.", file=sys.stderr)
        sys.exit(1)

    # Minimal standalone demo: treat all hotspots as GREEN unless this
    # script is given an explicit override via --force_tier (used only for
    # Phase 9's mandatory sanity-check test cases, documented in the report).
    hotspots = pd.read_csv(HOTSPOTS_CSV)
    active_hotspots = [
        {"hotspot_id": r["hotspot_id"], "name": r["name"], "lat": r["lat"], "lon": r["lon"], "tier": "GREEN"}
        for _, r in hotspots.iterrows()
    ]

    result = plan_route(origin_latlon, dest_latlon, active_hotspots)
    print(f"Normal route: {result['normal_route']['length_m']:.0f}m, {result['normal_route']['time_s']/60:.1f} min", file=sys.stderr)
    print(f"Flood-aware route: {result['flood_aware_route']['length_m']:.0f}m, {result['flood_aware_route']['time_s']/60:.1f} min", file=sys.stderr)
    print(f"Avoided: {[h['name'] for h in result['avoided_hotspots']]}", file=sys.stderr)
    print(f"Still passes through: {[h['name'] for h in result['still_passes_through']]}", file=sys.stderr)


if __name__ == "__main__":
    main()
