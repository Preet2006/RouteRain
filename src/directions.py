"""Phase U4: turn-by-turn directions computed from the SAME road-graph path RouteRain recommended.

No outside routing service is used, so the navigation always follows exactly the flood-aware route. Everything here
is deterministic templating (no LLM): a navigation prompt must be instant and must never be reworded wrongly.

    steps = build_steps(graph, node_path)             # list[Step], depart ... arrive
    geom  = build_nav_geometry(graph, node_path, steps)
    events = build_hotspot_events(geom, hotspots, avoided_ids=...)

How a step is built:
  * consecutive edges with the same road name (or `ref`, e.g. "NH-48", when the name is missing) form one road;
  * at a junction the compass bearing of the road before is compared with the road after:
    < 20 deg straight, 20-45 slight, 45-135 turn, > 135 sharp, >= 165 U-turn;
  * a turn is announced when the road changes, or when the node is a real intersection (3+ neighbours); a plain bend
    on the same road with no side roads is NOT a turn;
  * edges tagged junction=roundabout/circular become ONE step ("At the roundabout, take the 2nd exit onto X"); when
    the exit count cannot be worked out reliably it says "Go through the roundabout onto X";
  * unnamed roads never say "onto unnamed road";
  * steps shorter than MIN_STEP_M are merged into the one after them ("Turn left, then turn right onto X"), so the
    voice never fires twice within a second. A manoeuvre under MIN_STEP_M from the destination is dropped (its
    distance goes to the step before), so nobody hears "turn right" 7 m before arriving.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

from src.route_planner import _min_weight_edge_data

EARTH_RADIUS_M = 6371008.8
MIN_STEP_M = 25.0
STRAIGHT_MAX_DEG = 20.0
SLIGHT_MAX_DEG = 45.0
TURN_MAX_DEG = 135.0
UTURN_MIN_DEG = 165.0
BEARING_LOOKAHEAD_M = 10.0  # measure a road's direction over at least this much, so tiny kinks don't matter
MAX_RELIABLE_EXIT = 6
HOTSPOT_EVENT_RADIUS_M = 1000.0
ON_ROUTE_M = 15.0
SAMPLE_M = 20.0

COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
ORDINALS = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth"}


@dataclass
class Step:
    index: int
    maneuver: str  # depart | continue | turn | slight | sharp | uturn | roundabout | arrive
    modifier: str | None  # left | right | straight
    street: str | None
    distance_m: float  # from this manoeuvre to the next one
    duration_s: float
    location: list  # [lat, lon] of the manoeuvre
    bearing_before: float | None
    bearing_after: float | None
    exit_number: int | None
    instruction_en: str
    path_index: int  # position of the manoeuvre in the node path
    start_m: float  # distance along the route at the manoeuvre

    def to_dict(self):
        return asdict(self)


# ---- geometry helpers ------------------------------------------------------------------------------------------

def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(p, q):
    """Compass bearing 0-360 (0 = north, 90 = east) from p to q, both (lat, lon)."""
    p1, p2 = math.radians(p[0]), math.radians(q[0])
    dl = math.radians(q[1] - p[1])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def signed_turn_deg(before, after):
    """-180..180; positive = to the right (clockwise)."""
    return (after - before + 540.0) % 360.0 - 180.0


def _compass(bearing):
    return COMPASS[int(((bearing % 360) + 22.5) // 45) % 8]


def _end_bearing(pts):
    last = pts[-1]
    for p in reversed(pts[:-1]):
        if haversine_m(p[0], p[1], last[0], last[1]) >= BEARING_LOOKAHEAD_M:
            return bearing_deg(p, last)
    return bearing_deg(pts[0], last) if pts[0] != last else 0.0


def _start_bearing(pts):
    first = pts[0]
    for p in pts[1:]:
        if haversine_m(first[0], first[1], p[0], p[1]) >= BEARING_LOOKAHEAD_M:
            return bearing_deg(first, p)
    return bearing_deg(first, pts[-1]) if pts[0] != pts[-1] else 0.0


# ---- edge facts ------------------------------------------------------------------------------------------------

def _text(value, first_of_ref=False):
    if isinstance(value, (list, tuple)):
        value = next((v for v in value if isinstance(v, str) and v.strip()), None)
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    return value.split(";")[0].strip() if first_of_ref else value


def _is_roundabout(value):
    values = value if isinstance(value, (list, tuple)) else [value]
    return any(v in ("roundabout", "circular") for v in values)


def _edge_points(graph, u, v, data):
    """[(lat, lon), ...] running u -> v, following the road's real shape when the graph has it."""
    un, vn = graph.nodes[u], graph.nodes[v]
    geom = data.get("geometry")
    if geom is None:
        return [(un["y"], un["x"]), (vn["y"], vn["x"])]
    pts = [(y, x) for x, y in geom.coords]
    if ((pts[-1][0] - un["y"]) ** 2 + (pts[-1][1] - un["x"]) ** 2) < ((pts[0][0] - un["y"]) ** 2 + (pts[0][1] - un["x"]) ** 2):
        pts.reverse()
    return pts


def _edge_info(graph, u, v):
    data = _min_weight_edge_data(graph, u, v, "travel_time")
    pts = _edge_points(graph, u, v, data)
    name = _text(data.get("name"))
    ref = _text(data.get("ref"), first_of_ref=True)
    length = data.get("length")
    if length is None:
        length = sum(haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(pts[:-1], pts[1:]))
    return {"pts": pts, "length": float(length), "time": float(data.get("travel_time", 0.0)),
            "street": name or ref, "roundabout": _is_roundabout(data.get("junction")),
            "b_start": _start_bearing(pts), "b_end": _end_bearing(pts)}


def _is_intersection(graph, node):
    return len(set(graph.successors(node)) | set(graph.predecessors(node))) >= 3


def _roundabout_exit(graph, path, edges, k, m):
    """Exit number for a roundabout entered at path[k] and left at path[m] (None if it cannot be trusted)."""
    n_exit_edges = []
    for node in path[k + 1:m + 1]:
        count = 0
        for nxt in graph.successors(node):
            data = _min_weight_edge_data(graph, node, nxt, "travel_time")
            if not _is_roundabout(data.get("junction")):
                count += 1
        n_exit_edges.append(count)
    if not n_exit_edges or n_exit_edges[-1] != 1:  # more than one way off at the exit node: cannot tell which
        return None
    number = sum(n_exit_edges[:-1]) + 1
    return number if 1 <= number <= MAX_RELIABLE_EXIT else None


# ---- instructions ----------------------------------------------------------------------------------------------

def _classify(delta):
    a = abs(delta)
    side = "right" if delta > 0 else "left"
    if a < STRAIGHT_MAX_DEG:
        return "continue", "straight"
    if a < SLIGHT_MAX_DEG:
        return "slight", side
    if a < TURN_MAX_DEG:
        return "turn", side
    if a < UTURN_MIN_DEG:
        return "sharp", side
    return "uturn", side


def instruction(maneuver, modifier, street, exit_number=None, bearing_after=None):
    onto = f" onto {street}" if street else ""
    if maneuver == "depart":
        return f"Head {_compass(bearing_after or 0.0)}" + (f" on {street}" if street else "")
    if maneuver == "turn":
        return f"Turn {modifier}{onto}"
    if maneuver == "slight":
        return f"Bear {modifier}{onto}"
    if maneuver == "sharp":
        return f"Take a sharp {modifier}{onto}"
    if maneuver == "uturn":
        return f"Make a U-turn{onto}"
    if maneuver == "continue":
        return f"Continue{onto}"
    if maneuver == "roundabout":
        if exit_number:
            return f"At the roundabout, take the {ORDINALS[exit_number]} exit{onto}"
        return f"Go through the roundabout{onto}"
    if maneuver == "arrive":
        return "You have arrived at your destination"
    raise ValueError(f"unknown maneuver {maneuver!r}")


def _lower_first(text):
    return text[:1].lower() + text[1:]


# ---- steps -----------------------------------------------------------------------------------------------------

def build_steps(graph, node_path):
    """Turn a node path into steps (depart ... arrive). Step distances add up to the route length exactly."""
    path = list(node_path)
    if len(path) < 2:
        node = graph.nodes[path[0]]
        loc = [node["y"], node["x"]]
        return [Step(0, "arrive", None, None, 0.0, 0.0, loc, None, None, None, instruction("arrive", None, None), 0, 0.0)]

    edges = [_edge_info(graph, u, v) for u, v in zip(path[:-1], path[1:])]
    n_e = len(edges)
    cum_len, cum_time = [0.0], [0.0]
    for e in edges:
        cum_len.append(cum_len[-1] + e["length"])
        cum_time.append(cum_time[-1] + e["time"])

    def loc(k):
        node = graph.nodes[path[k]]
        return [round(float(node["y"]), 6), round(float(node["x"]), 6)]

    raw = [dict(k=0, maneuver="depart", modifier=None, street=edges[0]["street"], b_before=None,
                b_after=edges[0]["b_start"], exit=None)]
    k = 1
    while k < n_e:
        prev, nxt = edges[k - 1], edges[k]
        if nxt["roundabout"] and not prev["roundabout"]:
            m = k
            while m < n_e and edges[m]["roundabout"]:
                m += 1
            if m < n_e:
                street = edges[m]["street"]
                exit_number = _roundabout_exit(graph, path, edges, k, m)
                b_after = edges[m]["b_start"]
                _, modifier = _classify(signed_turn_deg(prev["b_end"], b_after))
            else:  # the trip ends inside the roundabout
                street, exit_number, b_after, modifier = None, None, edges[-1]["b_end"], "straight"
            raw.append(dict(k=k, maneuver="roundabout", modifier=modifier, street=street, b_before=prev["b_end"],
                            b_after=b_after, exit=exit_number))
            k = m + 1
            continue
        delta = signed_turn_deg(prev["b_end"], nxt["b_start"])
        changed = prev["street"] != nxt["street"]
        intersection = _is_intersection(graph, path[k])
        maneuver, modifier = _classify(delta)
        emit = None
        if maneuver in ("turn", "sharp", "uturn") and (changed or intersection):
            emit = (maneuver, modifier)
        elif maneuver == "slight" and changed and intersection:
            emit = (maneuver, modifier)
        elif changed and nxt["street"] is not None:
            emit = ("continue", "straight")  # same direction, but now on a differently named road
        if emit:
            raw.append(dict(k=k, maneuver=emit[0], modifier=emit[1], street=nxt["street"],
                            b_before=prev["b_end"], b_after=nxt["b_start"], exit=None))
        k += 1
    raw.append(dict(k=n_e, maneuver="arrive", modifier=None, street=None, b_before=edges[-1]["b_end"], b_after=None, exit=None))

    steps = []
    for i, r in enumerate(raw):
        nxt_k = raw[i + 1]["k"] if i + 1 < len(raw) else r["k"]
        start = round(cum_len[r["k"]], 1)
        steps.append(Step(
            index=i, maneuver=r["maneuver"], modifier=r["modifier"], street=r["street"],
            distance_m=round(round(cum_len[nxt_k], 1) - start, 1), duration_s=round(cum_time[nxt_k] - cum_time[r["k"]], 1),
            location=loc(r["k"]),
            bearing_before=None if r["b_before"] is None else round(r["b_before"], 1),
            bearing_after=None if r["b_after"] is None else round(r["b_after"], 1),
            exit_number=r["exit"], instruction_en=instruction(r["maneuver"], r["modifier"], r["street"], r["exit"], r["b_after"]),
            path_index=r["k"], start_m=start))
    return _merge_short_steps(steps)


def _merge_short_steps(steps):
    out = list(steps)
    i = 0
    while i < len(out) - 1:
        s, nxt = out[i], out[i + 1]
        if s.distance_m < MIN_STEP_M and nxt.maneuver != "arrive":
            s.distance_m = round(s.distance_m + nxt.distance_m, 1)
            s.duration_s = round(s.duration_s + nxt.duration_s, 1)
            s.bearing_after = nxt.bearing_after
            s.street = nxt.street
            s.instruction_en = f"{s.instruction_en}, then {_lower_first(nxt.instruction_en)}"
            del out[i + 1]
            continue  # the merged step may itself still be short
        i += 1
    # A manoeuvre less than MIN_STEP_M from the destination is not worth announcing ("turn right" 7 m before you
    # arrive): its distance goes to the step before it, so totals still add up.
    while len(out) >= 3 and out[-2].distance_m < MIN_STEP_M:
        short = out.pop(-2)
        out[-2].distance_m = round(out[-2].distance_m + short.distance_m, 1)
        out[-2].duration_s = round(out[-2].duration_s + short.duration_s, 1)
        out[-2].bearing_after = short.bearing_after
    for n, s in enumerate(out):
        s.index = n
    return out


# ---- navigation geometry ---------------------------------------------------------------------------------------

def build_nav_geometry(graph, node_path, steps=None):
    """Full route line with the cumulative distance (m) at every point. Each edge's own length is spread over its
    points, so the distance at every graph node equals the sum of edge lengths (and therefore the step distances)."""
    path = list(node_path)
    if len(path) < 2:
        node = graph.nodes[path[0]]
        coords = [[round(float(node["y"]), 6), round(float(node["x"]), 6)]]
        return {"coordinates": coords, "cumulative_m": [0.0], "node_index": [0], "total_m": 0.0,
                "step_point_index": [0] * len(steps or [])}
    coords, cum, node_index = [], [], []
    total = 0.0
    for u, v in zip(path[:-1], path[1:]):
        info = _edge_info(graph, u, v)
        pts = info["pts"]
        seg = [haversine_m(a[0], a[1], b[0], b[1]) for a, b in zip(pts[:-1], pts[1:])]
        scale = info["length"] / sum(seg) if sum(seg) > 0 else 0.0
        if not coords:
            coords.append(pts[0])
            cum.append(0.0)
            node_index.append(0)
        run = 0.0
        for p, s in zip(pts[1:], seg):
            run += s * scale
            coords.append(p)
            cum.append(total + run)
        total += info["length"]
        cum[-1] = total  # exact at the node
        node_index.append(len(coords) - 1)
    out = {"coordinates": [[round(float(y), 6), round(float(x), 6)] for y, x in coords],
           "cumulative_m": [round(c, 1) for c in cum], "node_index": node_index, "total_m": round(total, 1)}
    if steps is not None:
        out["step_point_index"] = [node_index[s.path_index] for s in steps]
    return out


# ---- hotspot proximity along the route -------------------------------------------------------------------------

def _local_xy(lat, lon, lat0, lon0):
    return (math.radians(lon - lon0) * math.cos(math.radians(lat0)) * EARTH_RADIUS_M,
            math.radians(lat - lat0) * EARTH_RADIUS_M)


def build_hotspot_events(geometry, hotspots, *, radius_m=HOTSPOT_EVENT_RADIUS_M, avoided_ids=()):
    """For every hotspot that comes within radius_m of the route: the distance along the route where the car first
    comes within radius_m, where it is closest (with how close, and on which side), and where it leaves again.
    passes_through = the route comes inside the hotspot's own risk buffer. Hotspots in avoided_ids are always
    included (within_radius False when the route stays farther than radius_m away).
    hotspots: dicts with hotspot_id, name, lat, lon, tier, buffer_m. Sorted by where the car meets them."""
    coords, cum = geometry["coordinates"], geometry["cumulative_m"]
    avoided_set = set(avoided_ids)
    events = []
    for h in hotspots:
        lat0, lon0 = h["lat"], h["lon"]
        pts = [_local_xy(lat, lon, lat0, lon0) for lat, lon in coords]  # hotspot is the origin (0, 0)
        best = (math.inf, 0.0, 0.0, 1.0, 0.0, 0.0)  # distance, along, heading x, heading y, point x, point y
        enter = leave = None
        for i in range(len(pts) - 1):
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            dx, dy = bx - ax, by - ay
            seg_sq = dx * dx + dy * dy
            seg_len = math.sqrt(seg_sq)
            seg_along = cum[i + 1] - cum[i]
            # closest point on this segment to the hotspot
            t = 0.0 if seg_sq == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg_sq))
            qx, qy = ax + t * dx, ay + t * dy
            d = math.hypot(qx, qy)
            if d < best[0]:
                best = (d, cum[i] + t * seg_along, dx / seg_len if seg_len else 0.0, dy / seg_len if seg_len else 1.0, qx, qy)
            # first / last point within the radius, sampled every SAMPLE_M
            n = max(1, math.ceil(seg_len / SAMPLE_M))
            for s in range(n + 1 if i == len(pts) - 2 else n):
                f = s / n
                if math.hypot(ax + f * dx, ay + f * dy) <= radius_m:
                    along = cum[i] + f * seg_along
                    if enter is None:
                        enter = along
                    leave = along
        within = best[0] <= radius_m and enter is not None
        if not within:
            if h["hotspot_id"] not in avoided_set:
                continue
            # An avoided hotspot is always reported (so the screen can say "avoiding X"), even when the detour keeps
            # more than radius_m away from it: it is announced where the route is closest to it.
            enter = leave = best[1]
        d, along, hx, hy, qx, qy = best
        # the hotspot is the origin and the car is at Q, so the vector car -> hotspot is -Q
        cross = hx * (-qy) - hy * (-qx)  # > 0: the hotspot is to the left of the direction of travel
        side = "on_route" if d <= ON_ROUTE_M else ("left" if cross > 0 else "right")
        buffer_m = h.get("buffer_m")
        passes = buffer_m is not None and d <= buffer_m
        events.append({
            "hotspot_id": h["hotspot_id"], "name": h["name"], "tier": h["tier"], "buffer_m": buffer_m,
            "approach_distance_m": round(enter, 1), "closest_distance_along_m": round(along, 1),
            "closest_distance_m": round(d, 1), "exit_distance_m": round(leave, 1), "side": side,
            "within_radius": bool(within),
            "passes_through": bool(passes), "avoided": h["hotspot_id"] in avoided_set and not passes,
        })
    events.sort(key=lambda e: (e["approach_distance_m"], e["hotspot_id"]))
    return events
