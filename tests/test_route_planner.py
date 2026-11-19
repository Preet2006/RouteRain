"""Route planner tests on a small synthetic road grid (no 1 GB graph needed).

The weight-function router in plan_route() must agree with the original
copy-the-graph implementation (build_penalized_graph), which is kept as the
reference. A real-graph comparison is reported separately.
"""
import networkx as nx
import pytest
from shapely.geometry import LineString

import src.route_planner as rp

LAT0, LON0, STEP = 28.40, 77.00, 0.002  # about 220 m between grid nodes


def make_grid(n=8):
    G = nx.MultiDiGraph(crs="epsg:4326")
    for i in range(n):
        for j in range(n):
            G.add_node(i * n + j, y=LAT0 + i * STEP, x=LON0 + j * STEP)

    def add(a, b):
        ya, xa, yb, xb = G.nodes[a]["y"], G.nodes[a]["x"], G.nodes[b]["y"], G.nodes[b]["x"]
        for u, v in ((a, b), (b, a)):
            G.add_edge(u, v, length=220.0, travel_time=20.0,
                       geometry=LineString([(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])]))
    for i in range(n):
        for j in range(n):
            if j + 1 < n:
                add(i * n + j, i * n + j + 1)
            if i + 1 < n:
                add(i * n + j, (i + 1) * n + j)
    return G


def hotspot(hid, i, j, tier):
    return {"hotspot_id": hid, "name": hid, "lat": LAT0 + i * STEP, "lon": LON0 + j * STEP, "tier": tier}


def run_both(G, origin, dest, hotspots, **kw):
    new = rp.plan_route(origin, dest, hotspots, graph=G, **kw)
    # reference: the original implementation (graph copy + attribute weights)
    pen, touched = rp.build_penalized_graph(G, hotspots)
    on = rp.ox.distance.nearest_nodes(G, origin[1], origin[0])
    dn = rp.ox.distance.nearest_nodes(G, dest[1], dest[0])
    ref_path = nx.shortest_path(pen, on, dn, weight="travel_time")
    return new, ref_path


def at(i, j):
    return (LAT0 + i * STEP, LON0 + j * STEP)


def test_matches_graph_copy_reference_with_hand_set_tiers():
    G = make_grid()
    hotspots = [hotspot("A", 3, 3, "RED"), hotspot("B", 5, 2, "YELLOW"), hotspot("C", 1, 5, "GREEN")]
    for origin, dest in [(at(3, 0), at(3, 7)), (at(0, 0), at(7, 7)), (at(6, 1), at(2, 6))]:
        new, ref_path = run_both(G, origin, dest, hotspots)
        assert new["flood_aware_route"]["path"] == ref_path


def test_red_hotspot_forces_a_detour_that_is_never_faster():
    G = make_grid()
    hotspots = [hotspot("A", 3, 3, "RED")]
    r = rp.plan_route(at(3, 0), at(3, 7), hotspots, graph=G)
    assert r["normal_route"]["path"] != r["flood_aware_route"]["path"]
    assert [h["hotspot_id"] for h in r["avoided_hotspots"]] == ["A"]
    assert r["flood_aware_route"]["time_s"] >= r["normal_route"]["time_s"]


def test_all_green_means_identical_routes():
    G = make_grid()
    r = rp.plan_route(at(3, 0), at(3, 7), [hotspot("A", 3, 3, "GREEN")], graph=G)
    assert r["normal_route"]["path"] == r["flood_aware_route"]["path"]


def test_per_request_penalty_overrides_do_not_leak_into_module_state():
    G = make_grid()
    hotspots = [hotspot("Y", 3, 3, "YELLOW")]
    before = (rp.RED_PENALTY, rp.YELLOW_PENALTY, rp.RED_BUFFER_M, rp.YELLOW_BUFFER_M)
    balanced = rp.plan_route(at(3, 0), at(3, 7), hotspots, graph=G, yellow_penalty=1)
    cautious = rp.plan_route(at(3, 0), at(3, 7), hotspots, graph=G)
    assert balanced["normal_route"]["path"] == balanced["flood_aware_route"]["path"]  # x1 penalty: no detour
    assert cautious["normal_route"]["path"] != cautious["flood_aware_route"]["path"]
    assert (rp.RED_PENALTY, rp.YELLOW_PENALTY, rp.RED_BUFFER_M, rp.YELLOW_BUFFER_M) == before


def test_smaller_buffer_touches_fewer_edges():
    G = make_grid()
    h = hotspot("A", 3, 3, "RED")
    big = rp.buffer_edges(G, h["lat"], h["lon"], 500)
    small = rp.buffer_edges(G, h["lat"], h["lon"], 100)
    assert small < big


def test_proximity_lists_every_tier_including_green():
    G = make_grid()
    hotspots = [hotspot("R", 3, 3, "RED"), hotspot("G", 3, 5, "GREEN"), hotspot("FAR", 7, 0, "GREEN")]
    r = rp.plan_route(at(3, 0), at(3, 7), hotspots, graph=G, include_proximity=True)
    normal_ids = {h["hotspot_id"] for h in r["normal_near_hotspots"]}
    assert {"R", "G"} <= normal_ids and "FAR" not in normal_ids
    assert all("buffer_m" in h for h in r["normal_near_hotspots"])
    assert {h["buffer_m"] for h in r["normal_near_hotspots"] if h["tier"] == "GREEN"} == {rp.YELLOW_BUFFER_M}
    # off by default so the web /api/route payload is unchanged
    assert "normal_near_hotspots" not in rp.plan_route(at(3, 0), at(3, 7), hotspots, graph=G)


def test_nominatim_limiter_is_shared_and_spaces_calls(monkeypatch):
    import time
    stamps = []

    class FakeNominatim:
        def __init__(self, user_agent):
            self.user_agent = user_agent

        def geocode(self, address, **kw):
            stamps.append(time.monotonic())
            return type("Loc", (), {"latitude": 28.46, "longitude": 77.03})()

    monkeypatch.setattr(rp, "Nominatim", FakeNominatim)
    monkeypatch.setattr(rp, "_limited_geocode", None)
    first = rp._get_limited_geocode()
    assert rp._get_limited_geocode() is first  # one limiter for the whole process
    rp.geocode_bounded("a")
    rp.geocode_bounded("b")
    assert stamps[1] - stamps[0] >= rp.NOMINATIM_MIN_DELAY_S - 0.05
    monkeypatch.setattr(rp, "_limited_geocode", None)


# --- unreachable routes, edge geometry, polylines ---------------------------------

def grid_with_pocket_and_island():
    G = make_grid()
    # one-way pocket: you can leave P (to grid node 31 = (3, 7)) but never enter it
    G.add_node(1000, y=LAT0 + 3 * STEP, x=LON0 + 7 * STEP + 0.0005)
    G.add_edge(1000, 31, length=60.0, travel_time=5.0)
    # island: a separate two-way chain about 5 km away, smaller than the main grid
    for i in range(3):
        G.add_node(2000 + i, y=LAT0 + 0.05, x=LON0 + 0.05 + i * STEP)
    for i in range(2):
        G.add_edge(2000 + i, 2001 + i, length=220.0, travel_time=20.0)
        G.add_edge(2001 + i, 2000 + i, length=220.0, travel_time=20.0)
    return G


def test_one_way_pocket_falls_back_to_main_component():
    G = grid_with_pocket_and_island()
    pocket = (G.nodes[1000]["y"], G.nodes[1000]["x"])
    # without the fallback this is NetworkXNoPath (nothing can enter the pocket)
    with pytest.raises(nx.NetworkXNoPath):
        nx.shortest_path(G, 24, 1000, weight="travel_time")
    r = rp.plan_route(at(3, 0), pocket, [], graph=G)
    assert r["normal_route"]["path"][-1] == 31
    assert r["dest_node_distance_m"] < rp.MAX_SNAP_M


def test_routes_that_already_worked_are_not_resnapped():
    G = grid_with_pocket_and_island()
    # leaving the pocket works, so the original nearest nodes must be kept
    pocket = (G.nodes[1000]["y"], G.nodes[1000]["x"])
    r = rp.plan_route(pocket, at(3, 0), [], graph=G)
    assert r["normal_route"]["path"][0] == 1000


def test_point_too_far_from_main_network_raises_no_drivable_route():
    G = grid_with_pocket_and_island()
    island = (G.nodes[2000]["y"], G.nodes[2000]["x"])
    with pytest.raises(rp.NoDrivableRouteError) as exc:
        rp.plan_route(at(3, 0), island, [], graph=G)
    assert str(exc.value) == "No drivable route found between these points."
    assert not isinstance(exc.value, ValueError)  # keeps the web /api/route on its old 502 path


def bendy_grid():
    G = make_grid()
    a, b = G.nodes[0], G.nodes[1]
    bend = (b["x"] - 0.0005, a["y"] + 0.0006)
    G.edges[0, 1, 0]["geometry"] = LineString([(a["x"], a["y"]), bend, (b["x"], b["y"])])
    # stored the wrong way round on purpose: runs node 0 -> node 1 although the edge is 1 -> 0
    G.edges[1, 0, 0]["geometry"] = LineString([(a["x"], a["y"]), bend, (b["x"], b["y"])])
    return G, bend


def test_path_coordinates_follow_edge_geometry():
    G, bend = bendy_grid()
    pts = rp.path_coordinates(G, [0, 1])
    assert len(pts) == 3 and pts[1] == [bend[1], bend[0]]
    straight = rp.path_coordinates(G, [0, 1], use_edge_geometry=False)
    assert len(straight) == 2


def test_path_coordinates_orient_reversed_geometry_and_drop_joints():
    G, bend = bendy_grid()
    pts = rp.path_coordinates(G, [1, 0])
    assert pts[0] == [G.nodes[1]["y"], G.nodes[1]["x"]] and pts[-1] == [G.nodes[0]["y"], G.nodes[0]["x"]]
    long_pts = rp.path_coordinates(G, [0, 1, 2])
    assert len(long_pts) == 4  # 3 points on the bendy edge + 1 new point, joint not repeated


def test_route_polyline_is_capped_at_300_points():
    G = make_grid()
    a, b = G.nodes[0], G.nodes[1]
    xs = [a["x"] + (b["x"] - a["x"]) * i / 999 for i in range(1000)]
    ys = [a["y"] + 0.0004 * ((i % 10) / 10) for i in range(1000)]
    G.edges[0, 1, 0]["geometry"] = LineString(list(zip(xs, ys)))
    out = rp.route_polyline(G, [0, 1], 300)
    assert 2 <= len(out) <= 300
    assert out[0] == [ys[0], xs[0]] and out[-1] == [ys[-1], xs[-1]]
