"""Turn-by-turn directions on small synthetic road graphs (no 1 GB graph needed)."""
import math

import networkx as nx
import pytest
from shapely.geometry import LineString

import src.directions as d
import src.route_planner as rp
from tests.test_route_planner import at, make_grid

LAT0, LON0 = 28.40, 77.00
M_PER_DEG_LAT = 111_195.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(LAT0))


def pos(east_m, north_m):
    return LAT0 + north_m / M_PER_DEG_LAT, LON0 + east_m / M_PER_DEG_LON


class Net:
    """Tiny hand-built road graph: nodes at (east, north) metres; edges with a name/ref/junction."""

    def __init__(self):
        self.g = nx.MultiDiGraph(crs="epsg:4326")

    def node(self, n, east, north):
        y, x = pos(east, north)
        self.g.add_node(n, y=y, x=x)

    def road(self, a, b, name=None, ref=None, junction=None, oneway=False, via=None, speed_ms=10.0):
        for u, v in ((a, b),) if oneway else ((a, b), (b, a)):
            pts = [self.g.nodes[u]] + ([] if via is None else [dict(zip("yx", pos(*p))) for p in (via if u == a else via[::-1])]) + [self.g.nodes[v]]
            line = LineString([(p["x"], p["y"]) for p in pts])
            length = sum(d.haversine_m(p["y"], p["x"], q["y"], q["x"]) for p, q in zip(pts[:-1], pts[1:]))
            attrs = {"length": length, "travel_time": length / speed_ms, "geometry": line}
            for key, val in (("name", name), ("ref", ref), ("junction", junction)):
                if val is not None:
                    attrs[key] = val
            self.g.add_edge(u, v, **attrs)


def length_of(g, path):
    return rp.route_metrics(g, path)[0]


def texts(steps):
    return [s.instruction_en for s in steps]


# ---- the plan's required cases ---------------------------------------------------------------------------------

def test_straight_path_has_only_depart_and_arrive():
    g = make_grid()
    path = [3 * 8 + j for j in range(8)]  # along row 3, east
    steps = d.build_steps(g, path)
    assert [s.maneuver for s in steps] == ["depart", "arrive"]
    assert steps[0].instruction_en == "Head east"
    assert steps[1].instruction_en == "You have arrived at your destination"


@pytest.mark.parametrize("rows, expected_side", [((3, 6), "left"), ((3, 0), "right")])
def test_l_shaped_path_gives_exactly_one_turn_on_the_correct_side(rows, expected_side):
    g = make_grid()
    r0, r1 = rows
    step_dir = 1 if r1 > r0 else -1
    path = [r0 * 8 + j for j in range(0, 5)] + [r * 8 + 4 for r in range(r0 + step_dir, r1 + step_dir, step_dir)]
    steps = d.build_steps(g, path)
    assert [s.maneuver for s in steps] == ["depart", "turn", "arrive"]
    assert steps[1].modifier == expected_side
    assert steps[1].instruction_en == f"Turn {expected_side}"  # unnamed road: no "onto"
    assert abs(abs(d.signed_turn_deg(steps[1].bearing_before, steps[1].bearing_after)) - 90) < 1
    assert math.isclose(steps[1].location[0], at(r0, 4)[0], abs_tol=1e-5)


def test_same_name_edges_merge_into_one_road():
    n = Net()
    for i in range(5):
        n.node(i, i * 200, 0)
    for i in range(4):
        n.road(i, i + 1, name="Main Road")
    steps = d.build_steps(n.g, [0, 1, 2, 3, 4])
    assert [s.maneuver for s in steps] == ["depart", "arrive"]
    assert steps[0].instruction_en == "Head east on Main Road"
    assert steps[0].distance_m == pytest.approx(length_of(n.g, [0, 1, 2, 3, 4]), abs=0.1)


def test_a_new_road_name_in_the_same_direction_says_continue_onto():
    n = Net()
    for i in range(5):
        n.node(i, i * 200, 0)
    n.road(0, 1, name="Alpha Road")
    n.road(1, 2, name="Alpha Road")
    n.road(2, 3, name="Beta Road")
    n.road(3, 4, ref="NH-48;SH-13")  # no name: the first ref is used
    steps = d.build_steps(n.g, [0, 1, 2, 3, 4])
    assert texts(steps) == ["Head east on Alpha Road", "Continue onto Beta Road", "Continue onto NH-48",
                            "You have arrived at your destination"]


def test_named_turn_says_onto_the_street_and_an_unnamed_turn_does_not():
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 300, 0)
    n.node(2, 300, 300)
    n.node(3, 300, -300)
    n.road(0, 1, name="Alpha Road")
    n.road(1, 2, name="Beta Road")
    n.road(1, 3)  # unnamed
    assert texts(d.build_steps(n.g, [0, 1, 2]))[1] == "Turn left onto Beta Road"
    unnamed = texts(d.build_steps(n.g, [0, 1, 3]))[1]
    assert unnamed == "Turn right"
    assert "unnamed" not in unnamed and "onto" not in unnamed


def test_a_bend_on_the_same_road_with_no_side_roads_is_not_a_turn():
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 300, 0)
    n.node(2, 300, 300)  # 90 degree bend, two neighbours only, same name
    n.road(0, 1, name="Curvy Road")
    n.road(1, 2, name="Curvy Road")
    assert [s.maneuver for s in d.build_steps(n.g, [0, 1, 2])] == ["depart", "arrive"]


def test_the_same_bend_at_a_real_junction_is_a_turn():
    n = Net()
    for i, (e, nn) in enumerate([(0, 0), (300, 0), (300, 300), (600, 0)]):
        n.node(i, e, nn)
    for a, b in ((0, 1), (1, 2), (1, 3)):
        n.road(a, b, name="Curvy Road")
    steps = d.build_steps(n.g, [0, 1, 2])
    assert [s.maneuver for s in steps] == ["depart", "turn", "arrive"] and steps[1].modifier == "left"


@pytest.mark.parametrize("angle, maneuver, side", [(-30, "slight", "left"), (30, "slight", "right"), (-90, "turn", "left"),
                                                   (90, "turn", "right"), (-150, "sharp", "left"), (150, "sharp", "right"),
                                                   (10, "continue", "straight"), (-10, "continue", "straight")])
def test_turn_angle_classes(angle, maneuver, side):
    """Heading east into the junction; `angle` degrees to the right (negative = left) onto a differently named road."""
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 400, 0)
    brg = math.radians(90 + angle)
    n.node(2, 400 + 400 * math.sin(brg), 400 * math.cos(brg))
    n.node(3, 400, 5000)  # side roads so the node is a real junction
    n.node(4, 400, -5000)
    n.road(0, 1, name="Alpha")
    n.road(1, 2, name="Beta")
    n.road(1, 3, name="Gamma")
    n.road(1, 4, name="Delta")
    steps = d.build_steps(n.g, [0, 1, 2])
    assert steps[1].maneuver == maneuver and steps[1].modifier == side
    assert steps[1].street == "Beta"


def test_u_turn():
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 400, 0)
    n.node(2, 0, 8)  # almost straight back
    n.node(3, 400, 300)
    n.road(0, 1, name="Alpha")
    n.road(1, 2, name="Beta", oneway=True)
    n.road(1, 3, name="Gamma")
    steps = d.build_steps(n.g, [0, 1, 2])
    assert steps[1].maneuver == "uturn" and steps[1].instruction_en == "Make a U-turn onto Beta"


def _roundabout(extra_exit=False):
    n = Net()
    r = 40.0
    n.node("W", -300, 0)
    n.node("S", 0, -300)
    n.node("E", 300, 0)
    n.node("N", 0, 300)
    n.node("R0", -r, 0)  # entry (west of the ring), the ring runs counter-clockwise: R0 -> R1 -> R2 -> R3
    n.node("R1", 0, -r)
    n.node("R2", r, 0)
    n.node("R3", 0, r)
    n.road("W", "R0", name="Entry Road")
    for a, b in (("R0", "R1"), ("R1", "R2"), ("R2", "R3"), ("R3", "R0")):
        n.road(a, b, name="Ring", junction="roundabout", oneway=True)
    n.road("R1", "S", name="South Road")
    n.road("R2", "E", name="East Road")
    n.road("R3", "N", name="North Road")
    if extra_exit:
        n.node("E2", 300, 60)
        n.road("R2", "E2", name="Second East Road")
    return n


def test_roundabout_is_one_step_with_the_exit_number():
    n = _roundabout()
    steps = d.build_steps(n.g, ["W", "R0", "R1", "R2", "E"])
    assert [s.maneuver for s in steps] == ["depart", "roundabout", "arrive"]
    assert steps[1].exit_number == 2
    assert steps[1].instruction_en == "At the roundabout, take the second exit onto East Road"
    assert steps[1].street == "East Road"


def test_roundabout_first_and_third_exit():
    n = _roundabout()
    assert d.build_steps(n.g, ["W", "R0", "R1", "S"])[1].instruction_en == "At the roundabout, take the first exit onto South Road"
    assert d.build_steps(n.g, ["W", "R0", "R1", "R2", "R3", "N"])[1].instruction_en == \
        "At the roundabout, take the third exit onto North Road"


def test_roundabout_with_an_ambiguous_exit_does_not_guess():
    n = _roundabout(extra_exit=True)
    step = d.build_steps(n.g, ["W", "R0", "R1", "R2", "E"])[1]
    assert step.exit_number is None
    assert step.instruction_en == "Go through the roundabout onto East Road"


def test_steps_under_25_m_are_merged_into_the_next_one():
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 300, 0)
    n.node(2, 300, 15)  # 15 m north: far too short to announce on its own
    n.node(3, 600, 15)
    n.node(4, 900, 15)
    n.road(0, 1, name="Alpha")
    n.road(1, 2, name="Beta")
    n.road(2, 3, name="Gamma")
    n.road(3, 4, name="Gamma")
    steps = d.build_steps(n.g, [0, 1, 2, 3, 4])
    assert [s.maneuver for s in steps] == ["depart", "turn", "arrive"]
    assert steps[1].instruction_en == "Turn left onto Beta, then turn right onto Gamma"
    assert steps[1].street == "Gamma" and steps[1].modifier == "left"
    assert all(s.distance_m >= d.MIN_STEP_M for s in steps[:-1])
    assert math.isclose(steps[1].start_m, steps[0].distance_m, abs_tol=0.1)


def test_a_manoeuvre_under_25_m_from_the_destination_is_dropped_and_its_distance_kept():
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 300, 0)
    n.node(2, 300, 15)
    n.road(0, 1, name="Alpha")
    n.road(1, 2, name="Beta")
    steps = d.build_steps(n.g, [0, 1, 2])
    assert [s.maneuver for s in steps] == ["depart", "arrive"]
    assert steps[0].distance_m == pytest.approx(length_of(n.g, [0, 1, 2]), abs=0.1)


def test_a_manoeuvre_25_m_or_more_from_the_destination_is_kept():
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 300, 0)
    n.node(2, 300, 40)
    n.road(0, 1, name="Alpha")
    n.road(1, 2, name="Beta")
    assert [s.maneuver for s in d.build_steps(n.g, [0, 1, 2])] == ["depart", "turn", "arrive"]


@pytest.mark.parametrize("build", ["l", "merged", "roundabout", "grid_diagonal"])
def test_step_distances_add_up_to_the_route_length_within_a_metre(build):
    if build == "l":
        g = make_grid()
        path = [3 * 8 + j for j in range(5)] + [r * 8 + 4 for r in range(4, 8)]
    elif build == "merged":
        n = Net()
        for i, (e, nn) in enumerate([(0, 0), (300, 0), (300, 15), (600, 15), (900, 15)]):
            n.node(i, e, nn)
        for a, b, nm in ((0, 1, "A"), (1, 2, "B"), (2, 3, "C"), (3, 4, "C")):
            n.road(a, b, name=nm)
        g, path = n.g, [0, 1, 2, 3, 4]
    elif build == "roundabout":
        g, path = _roundabout().g, ["W", "R0", "R1", "R2", "R3", "N"]
    else:
        g = make_grid()
        path = [0, 1, 9, 10, 18, 19, 27, 28, 36, 37, 45, 46, 54, 55, 63]  # staircase: many turns
    steps = d.build_steps(g, path)
    assert sum(s.distance_m for s in steps) == pytest.approx(length_of(g, path), abs=1.0)
    assert sum(s.duration_s for s in steps) == pytest.approx(rp.route_metrics(g, path)[1], abs=1.0)
    # steps are in order along the route
    assert [s.start_m for s in steps] == sorted(s.start_m for s in steps)
    assert [s.index for s in steps] == list(range(len(steps)))
    assert steps[0].maneuver == "depart" and steps[-1].maneuver == "arrive" and steps[-1].distance_m == 0


def test_a_single_node_path_is_just_an_arrival():
    g = make_grid()
    steps = d.build_steps(g, [5])
    assert [s.maneuver for s in steps] == ["arrive"]


def test_every_step_has_the_documented_fields():
    steps = d.build_steps(make_grid(), [24, 25, 26, 27, 28, 36, 44])
    keys = set(steps[0].to_dict())
    assert keys >= {"index", "maneuver", "modifier", "street", "distance_m", "duration_s", "location", "bearing_before",
                    "bearing_after", "exit_number", "instruction_en"}
    assert steps[0].bearing_before is None and steps[-1].bearing_after is None
    assert all(s.maneuver in {"depart", "continue", "turn", "slight", "sharp", "uturn", "roundabout", "arrive"} for s in steps)


def test_follows_a_curved_edge_geometry_not_just_the_end_points():
    n = Net()
    n.node(0, 0, 0)
    n.node(1, 400, 0)
    n.node(2, 400, 400)
    n.road(0, 1, name="Same", via=[(200, 150)])  # the road bows north before reaching node 1
    n.road(1, 2, name="Other")
    geo = d.build_nav_geometry(n.g, [0, 1, 2])
    assert len(geo["coordinates"]) == 4 and geo["coordinates"][1] == [pytest.approx(pos(200, 150)[0], abs=1e-6), pytest.approx(pos(200, 150)[1], abs=1e-6)]


# ---- navigation geometry ---------------------------------------------------------------------------------------

def test_nav_geometry_cumulative_distance_matches_the_graph_and_steps_point_at_their_locations():
    g = make_grid()
    path = [3 * 8 + j for j in range(5)] + [r * 8 + 4 for r in range(4, 8)]
    steps = d.build_steps(g, path)
    geo = d.build_nav_geometry(g, path, steps)
    coords, cum = geo["coordinates"], geo["cumulative_m"]
    assert len(coords) == len(cum) and cum[0] == 0 and cum == sorted(cum)
    assert geo["total_m"] == pytest.approx(length_of(g, path), abs=0.1) and cum[-1] == geo["total_m"]
    assert len(geo["step_point_index"]) == len(steps)
    for s, i in zip(steps, geo["step_point_index"]):
        assert coords[i] == pytest.approx(s.location, abs=1e-5)
        assert cum[i] == pytest.approx(s.start_m, abs=0.1)
    # the geometry has the full edge shape: at least one point per node
    assert len(coords) >= len(path)


# ---- hotspot proximity events ----------------------------------------------------------------------------------

def line_geometry(length_m=4000, step_m=100):
    coords = [[round(pos(e, 0)[0], 6), round(pos(e, 0)[1], 6)] for e in range(0, length_m + 1, step_m)]
    return {"coordinates": coords, "cumulative_m": [float(e) for e in range(0, length_m + 1, step_m)], "total_m": float(length_m)}


def spot(hid, east, north, tier="RED", buffer_m=500):
    lat, lon = pos(east, north)
    return {"hotspot_id": hid, "name": f"Spot {hid}", "lat": lat, "lon": lon, "tier": tier, "buffer_m": buffer_m}


def test_event_gives_distance_where_the_car_comes_within_1_km_and_the_side():
    geo = line_geometry()
    ev = d.build_hotspot_events(geo, [spot("N", 2000, 600), spot("S", 3000, -700, "YELLOW", 300)], avoided_ids=["N", "S"])
    by = {e["hotspot_id"]: e for e in ev}
    n = by["N"]  # 600 m north of an east-bound road: on the LEFT, enters the 1 km zone at x = 2000 - 800
    assert n["side"] == "left" and n["closest_distance_m"] == pytest.approx(600, abs=2)
    assert n["approach_distance_m"] == pytest.approx(2000 - math.sqrt(1000 ** 2 - 600 ** 2), abs=d.SAMPLE_M)
    assert n["closest_distance_along_m"] == pytest.approx(2000, abs=2)
    assert n["exit_distance_m"] == pytest.approx(2000 + 800, abs=d.SAMPLE_M)
    assert n["avoided"] is True and n["passes_through"] is False
    assert by["S"]["side"] == "right" and by["S"]["tier"] == "YELLOW" and by["S"]["avoided"] is True
    assert [e["hotspot_id"] for e in ev] == ["N", "S"]  # in order along the route


def test_a_hotspot_that_is_driven_through_is_not_called_avoided():
    ev = d.build_hotspot_events(line_geometry(), [spot("X", 1500, 100)], avoided_ids=["X"])
    assert ev[0]["passes_through"] is True and ev[0]["avoided"] is False and ev[0]["closest_distance_m"] == pytest.approx(100, abs=2)


def test_on_the_route_has_no_side_and_far_hotspots_are_ignored():
    geo = line_geometry()
    ev = d.build_hotspot_events(geo, [spot("A", 1000, 5), spot("FAR", 2000, 1500), spot("FAR2", 9000, 0)])
    assert [e["hotspot_id"] for e in ev] == ["A"] and ev[0]["side"] == "on_route" and ev[0]["within_radius"] is True


def test_an_avoided_hotspot_is_reported_even_when_the_detour_stays_over_1_km_away():
    geo = line_geometry()
    ev = d.build_hotspot_events(geo, [spot("FAR", 2000, 1500)], avoided_ids=["FAR"])
    assert len(ev) == 1 and ev[0]["within_radius"] is False and ev[0]["avoided"] is True and ev[0]["side"] == "left"
    assert ev[0]["closest_distance_m"] == pytest.approx(1500, abs=2)
    assert ev[0]["approach_distance_m"] == ev[0]["closest_distance_along_m"] == pytest.approx(2000, abs=2)


def test_a_route_that_starts_inside_the_zone_reports_distance_zero():
    ev = d.build_hotspot_events(line_geometry(), [spot("A", 300, 200)])
    assert ev[0]["approach_distance_m"] == 0.0


def test_event_distance_never_exceeds_the_route_length():
    geo = line_geometry()
    for e in d.build_hotspot_events(geo, [spot("A", 3900, 100), spot("B", 4100, -300)]):
        assert 0 <= e["approach_distance_m"] <= e["closest_distance_along_m"] <= e["exit_distance_m"] <= geo["total_m"]
