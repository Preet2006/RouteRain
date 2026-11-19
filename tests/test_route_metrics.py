import pytest

from src.route_metrics import (added_drive_min, expected_delay_min, expected_saving_min,
                               expected_time_min, hotspot_delay_min, routes_identical)

# Test values only: the real FLOOD_DELAY_MIN is an owner-approved assumption in config.py.
DELAY = {"GREEN": 15, "YELLOW": 20, "RED": 30}


def hs(hid, tier, p):
    return {"hotspot_id": hid, "tier": tier, "probability": p}


def test_identical_routes_save_nothing():
    near = [hs("H01", "RED", 0.4), hs("H05", "GREEN", 0.02)]
    assert expected_saving_min(20.0, near, 20.0, near, DELAY) == 0.0
    assert routes_identical([1, 2, 3], [1, 2, 3])
    assert not routes_identical([1, 2, 3], [1, 4, 3])


def test_no_hotspots_means_zero_saving_when_times_match():
    assert expected_saving_min(18.0, [], 18.0, [], DELAY) == 0.0


def test_no_hotspots_detour_only_costs_time():
    assert expected_saving_min(18.0, [], 21.0, [], DELAY) == pytest.approx(-3.0)


def test_red_on_normal_route_only_gives_positive_saving():
    # normal: 20 + 0.5*30 = 35; aware: 24 + 0 = 24 -> saves 11
    saving = expected_saving_min(20.0, [hs("H01", "RED", 0.5)], 24.0, [], DELAY)
    assert saving == pytest.approx(11.0) and saving > 0


def test_detour_not_worth_it_gives_negative_saving():
    # normal: 20 + 0.1*30 = 23; aware: 45 -> -22
    assert expected_saving_min(20.0, [hs("H01", "RED", 0.1)], 45.0, [], DELAY) < 0


def test_flood_aware_faster_than_normal_is_rejected():
    with pytest.raises(ValueError):
        added_drive_min(20.0, 19.0)
    with pytest.raises(ValueError):
        expected_saving_min(20.0, [], 19.0, [], DELAY)


def test_added_drive_never_negative_within_tolerance():
    assert added_drive_min(20.0, 20.0) == 0.0
    assert added_drive_min(20.0, 20.004) == pytest.approx(0.004)
    assert added_drive_min(20.0, 19.995) == 0.0  # float noise, not a real speed-up


def test_green_hotspots_add_delay_too():
    assert hotspot_delay_min(hs("H02", "GREEN", 0.04), DELAY) == pytest.approx(0.6)
    assert expected_time_min(10.0, [hs("H02", "GREEN", 0.04)], DELAY) == pytest.approx(10.6)


def test_unscored_hotspot_adds_no_delay_and_invents_nothing():
    assert hotspot_delay_min({"hotspot_id": "H03", "tier": "NOT_SCORED", "probability": None}, DELAY) == 0.0
    assert hotspot_delay_min({"hotspot_id": "H03", "tier": "GREEN"}, DELAY) == 0.0


def test_bad_inputs_fail_loudly():
    with pytest.raises(ValueError):
        hotspot_delay_min(hs("H01", "PURPLE", 0.5), DELAY)
    with pytest.raises(ValueError):
        hotspot_delay_min(hs("H01", "RED", 1.5), DELAY)
    with pytest.raises(ValueError):
        expected_delay_min([hs("H01", "RED", 0.5), hs("H01", "RED", 0.5)], DELAY)
    with pytest.raises(ValueError):
        expected_time_min(-1.0, [], DELAY)
