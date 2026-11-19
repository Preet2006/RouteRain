import time

import pytest

import src.places as places


def names(q, **kw):
    return [p["name"] for p in places.search_places(q, **kw)]


def test_cyber_finds_cyber_hub_fast():
    places.load_places()  # warm the one-time load
    t = time.perf_counter()
    out = names("cyber")
    assert time.perf_counter() - t < 0.1
    assert "Cyber Hub" in out


def test_alias_and_case_insensitive():
    assert names("MDI")[0] == "Management Development Institute"
    assert "HUDA City Centre Metro" in names("huda")


def test_results_are_capped_and_carry_verified_flag():
    out = places.search_places("sector")
    assert 0 < len(out) <= places.MAX_RESULTS
    assert all(set(p) == {"place_id", "name", "category", "lat", "lon", "verified"} for p in out)


def test_short_or_unknown_queries_return_nothing():
    assert places.search_places("a") == []
    assert places.search_places("   ") == []
    assert places.search_places("zzzzqqqq") == []


def test_exact_name_ranks_first():
    assert names("sector 29")[0] == "Sector 29"


def test_all_draft_rows_are_unverified():
    assert {p["verified"] for p in places.load_places()} == {0}


def test_geocode_is_cached(monkeypatch):
    import src.route_planner as rp
    calls = []
    monkeypatch.setattr(rp, "geocode_bounded", lambda q: calls.append(q) or (28.46, 77.03))
    places._geocode_cache.clear()
    a = places.geocode_place("Some Place, Gurugram")
    b = places.geocode_place("some place gurugram")
    assert a == b and len(calls) == 1
    places._geocode_cache.clear()


def test_geocode_not_found_is_not_cached(monkeypatch):
    import src.route_planner as rp

    def fail(q):
        raise ValueError("not found")
    monkeypatch.setattr(rp, "geocode_bounded", fail)
    places._geocode_cache.clear()
    with pytest.raises(ValueError):
        places.geocode_place("nowhere")
    assert places._geocode_cache == {}
