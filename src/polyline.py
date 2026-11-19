"""Polyline simplification for mobile route responses (Douglas-Peucker via shapely)."""

from shapely.geometry import LineString


def simplify_polyline(coords, max_points=300):
    """Reduce [[lat, lon], ...] to at most max_points points with Douglas-Peucker,
    keeping the first and last point. Lists already within the limit are returned
    unchanged (as new lists of lists). The tolerance is found by bisection, so the
    result keeps as much detail as the limit allows."""
    if max_points < 2:
        raise ValueError("max_points must be >= 2")
    pts = [[float(lat), float(lon)] for lat, lon in coords]
    if len(pts) <= max_points:
        return pts
    line = LineString([(lon, lat) for lat, lon in pts])  # shapely is (x=lon, y=lat)
    lo, hi = 0.0, 0.05  # tolerance in degrees (0.05 deg is about 5 km: always enough)
    best = None
    for _ in range(40):
        mid = (lo + hi) / 2
        out = list(line.simplify(mid, preserve_topology=False).coords)
        if len(out) <= max_points:
            best, hi = out, mid
        else:
            lo = mid
    if best is None:  # cannot happen with the upper bound above, but never return too many points
        step = (len(pts) - 1) / (max_points - 1)
        return [pts[round(i * step)] for i in range(max_points)]
    return [[lat, lon] for lon, lat in best]
