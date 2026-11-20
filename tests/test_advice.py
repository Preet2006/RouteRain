import re

import pytest

from src.advice import build_advice

R = {"name": "Bilaspur Chowk", "tier": "RED"}
Y = {"name": "Rajiv Chowk", "tier": "YELLOW"}


def adv(**kw):
    base = dict(identical=False, expected_saving_min=5.0, added_drive_min=4.0, avoided=[R], still_passes=[])
    return build_advice(**{**base, **kw})


def test_positive_saving_uses_save_and_both_numbers():
    assert adv() == ("This route adds about 4 minutes of driving but is expected to save about 5 minutes overall "
                     "by avoiding Bilaspur Chowk (RED).")


@pytest.mark.parametrize("saving", [0.0, -0.1, -7.5])
def test_non_positive_saving_never_says_save(saving):
    t = adv(expected_saving_min=saving)
    assert not re.search(r"\bsav", t, re.I)
    assert "Bilaspur Chowk (RED)" in t and "about 4 minutes" in t and "your call" in t.lower()


def test_tiny_saving_does_not_say_zero_minutes():
    t = adv(expected_saving_min=0.2, added_drive_min=0.1)
    assert "under a minute" in t and "0 minute" not in t


def test_identical_routes_say_no_detour():
    t = adv(identical=True, avoided=[], expected_saving_min=0, added_drive_min=0)
    assert t.startswith("No detour needed today")


def test_replay_prefixes_the_date_everywhere():
    for t in (adv(replay_date="2025-07-09"),
              adv(replay_date="2025-07-09", expected_saving_min=-1),
              adv(replay_date="2025-07-09", identical=True, avoided=[], expected_saving_min=0, added_drive_min=0)):
        assert t.startswith("On 9 July 2025, ")


def test_multiple_avoided_and_still_passing():
    t = adv(avoided=[R, Y], still_passes=[{"name": "Narsingpur", "tier": "RED"}])
    assert "Bilaspur Chowk (RED) and Rajiv Chowk (YELLOW)" in t and "still passes near Narsingpur (RED)" in t


def test_inside_a_risk_zone_is_its_own_message():
    t = adv(avoided=[], origin_inside=[R])
    assert t.startswith("Your starting point is inside a flood risk zone (Bilaspur Chowk (RED))")
