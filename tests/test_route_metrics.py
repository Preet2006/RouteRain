import pytest

import config
from src.route_metrics import (added_drive_min, expected_delay_min, expected_saving_min,
                               expected_time_min, hotspot_delay_min, routes_identical)

D = config.FLOOD_DELAY_MIN  # the owner-approved, tier-independent assumption


def hs(hid, tier, p):
    return {"hotspot_id": hid, "tier": tier, "probability": p}


def test_config_delay_is_the_severity_mix_average():
    assert config.FLOOD_SEVERITY_DELAY_MIN == {"minor": 5, "disrupted": 20, "closed": 45}
    # flood_events.csv: 15 minor, 121 disrupted, 32 closed -> (75 + 2420 + 1440) / 168
    assert D == pytest.approx(3935 / 168)
    assert D == pytest.approx(23.4, abs=0.05)


def test_identical_routes_save_nothing():
    near = [hs("H01", "RED", 0.4), hs("H05", "GREEN", 0.02)]
    assert expected_saving_min(20.0, near, 20.0, near, D) == 0.0
    assert routes_identical([1, 2, 3], [1, 2, 3])
    assert not routes_identical([1, 2, 3], [1, 4, 3])


def test_no_hotspots_means_zero_saving_when_times_match():
    assert expected_saving_min(18.0, [], 18.0, [], D) == 0.0


def test_no_hotspots_detour_only_costs_time():
    assert expected_saving_min(18.0, [], 21.0, [], D) == pytest.approx(-3.0)


def test_red_on_normal_route_only_gives_positive_saving():
    # normal: 20 + 0.5*D; aware: 24 -> saves 0.5*D - 4
    saving = expected_saving_min(20.0, [hs("H01", "RED", 0.5)], 24.0, [], D)
    assert saving == pytest.approx(0.5 * D - 4.0) and saving > 0


def test_detour_not_worth_it_gives_negative_saving():
    assert expected_saving_min(20.0, [hs("H01", "RED", 0.1)], 45.0, [], D) < 0


def test_delay_does_not_depend_on_tier():
    for tier in ("GREEN", "YELLOW", "RED", "NOT_SCORED", None):
        assert hotspot_delay_min(hs("H01", tier, 0.2), D) == pytest.approx(0.2 * D)


def test_green_hotspots_add_delay_too():
    assert expected_time_min(10.0, [hs("H02", "GREEN", 0.04)], D) == pytest.approx(10.0 + 0.04 * D)


def test_flood_aware_faster_than_normal_is_rejected():
    with pytest.raises(ValueError):
        added_drive_min(20.0, 19.0)
    with pytest.raises(ValueError):
        expected_saving_min(20.0, [], 19.0, [], D)


def test_added_drive_never_negative_within_tolerance():
    assert added_drive_min(20.0, 20.0) == 0.0
    assert added_drive_min(20.0, 20.004) == pytest.approx(0.004)
    assert added_drive_min(20.0, 19.995) == 0.0  # float noise, not a real speed-up


def test_unscored_hotspot_adds_no_delay_and_invents_nothing():
    assert hotspot_delay_min({"hotspot_id": "H03", "tier": "NOT_SCORED", "probability": None}, D) == 0.0
    assert hotspot_delay_min({"hotspot_id": "H03", "tier": "GREEN"}, D) == 0.0


def test_bad_inputs_fail_loudly():
    with pytest.raises(ValueError):
        hotspot_delay_min(hs("H01", "RED", 1.5), D)
    with pytest.raises(ValueError):
        hotspot_delay_min(hs("H01", "RED", 0.5), -1)
    with pytest.raises(ValueError):
        hotspot_delay_min(hs("H01", "RED", 0.5), {"GREEN": 15})  # the old per-tier dict is no longer valid
    with pytest.raises(ValueError):
        expected_delay_min([hs("H01", "RED", 0.5), hs("H01", "RED", 0.5)], D)
    with pytest.raises(ValueError):
        expected_time_min(-1.0, [], D)


def test_two_hotspots_on_one_route_with_api_style_ids():
    near = [{"id": "H02", "tier": "RED", "probability": 0.4}, {"id": "H07", "tier": "YELLOW", "probability": 0.2}]
    assert expected_delay_min(near, D) == pytest.approx(0.6 * D)
    with pytest.raises(ValueError):
        expected_delay_min([near[0], near[0]], D)
