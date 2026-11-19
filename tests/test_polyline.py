import math

import pytest

from src.polyline import simplify_polyline


def wiggly(n):
    return [[28.4 + i * 1e-4, 77.0 + 0.001 * math.sin(i / 7)] for i in range(n)]


def test_short_lines_are_unchanged():
    pts = wiggly(50)
    assert simplify_polyline(pts, 300) == pts


@pytest.mark.parametrize("n", [301, 1000, 5000])
def test_long_lines_are_cut_to_the_limit_and_keep_endpoints(n):
    pts = wiggly(n)
    out = simplify_polyline(pts, 300)
    assert 2 <= len(out) <= 300
    assert out[0] == pts[0] and out[-1] == pts[-1]
    assert all(p in pts for p in out)  # Douglas-Peucker only keeps original vertices


def test_straight_line_collapses_to_endpoints():
    pts = [[28.4 + i * 1e-4, 77.0 + i * 1e-4] for i in range(500)]
    assert len(simplify_polyline(pts, 300)) == 2


def test_limit_validation():
    with pytest.raises(ValueError):
        simplify_polyline([[0, 0], [1, 1]], 1)
