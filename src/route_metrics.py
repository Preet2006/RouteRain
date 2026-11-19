"""Expected-time maths for the RouteRain mobile app (MOBILE_APP_PLAN.md section 2.1).

Pure functions only: no I/O, no model, no graph. Inputs are plain numbers and
lists of hotspot dicts, so everything here is unit-testable on its own.

    expected_time(route) = drive_time(route)
                         + sum over hotspots h near the route of p_h * FLOOD_DELAY_MIN[tier_h]

    expected_saving = expected_time(normal route) - expected_time(flood-aware route)

A "hotspot near a route" is a dict with at least 'hotspot_id', 'tier' and
'probability' (the calibrated probability from predict.py). A hotspot with no
probability (for example a replay-day hotspot that was not scored because rain
was under 10 mm) contributes 0 delay: no probability is ever invented.

FLOOD_DELAY_MIN is an ASSUMPTION about how long a flooded hotspot delays a
driver, not data. It is passed in by the caller (it will live in config.py).
"""

import math

DRIVE_TIME_TOLERANCE_MIN = 0.01  # float noise allowed when checking aware >= normal


def hotspot_delay_min(hotspot, flood_delay_min):
    """Expected delay (minutes) contributed by one nearby hotspot: p * delay[tier]."""
    p = hotspot.get("probability")
    if p is None:
        return 0.0
    if not 0.0 <= p <= 1.0:
        raise ValueError(f"probability out of range for {hotspot.get('hotspot_id')}: {p}")
    tier = hotspot.get("tier")
    if tier not in flood_delay_min:
        raise ValueError(f"no FLOOD_DELAY_MIN entry for tier {tier!r} (hotspot {hotspot.get('hotspot_id')})")
    return p * flood_delay_min[tier]


def expected_delay_min(near_hotspots, flood_delay_min):
    """Sum of hotspot_delay_min over the hotspots near one route."""
    ids = [h.get("hotspot_id") for h in near_hotspots]
    if len(ids) != len(set(ids)):
        raise ValueError(f"a hotspot is listed twice for one route: {ids}")
    return math.fsum(hotspot_delay_min(h, flood_delay_min) for h in near_hotspots)


def expected_time_min(drive_time_min, near_hotspots, flood_delay_min):
    """Drive time plus the expected flood delay of the hotspots near the route."""
    if drive_time_min < 0:
        raise ValueError("drive_time_min must be >= 0")
    return drive_time_min + expected_delay_min(near_hotspots, flood_delay_min)


def added_drive_min(normal_drive_min, aware_drive_min):
    """Extra driving time of the flood-aware route (>= 0). A flood-aware route
    that is genuinely faster than the normal one is a bug upstream (PLAN.md
    Phase 9 forbids it), so this raises instead of returning a negative number."""
    diff = aware_drive_min - normal_drive_min
    if diff < -DRIVE_TIME_TOLERANCE_MIN:
        raise ValueError(
            f"flood-aware drive time {aware_drive_min:.2f} min is below normal {normal_drive_min:.2f} min")
    return max(diff, 0.0)


def expected_saving_min(normal_drive_min, normal_near, aware_drive_min, aware_near, flood_delay_min):
    """expected_time(normal) - expected_time(flood-aware). Positive means the
    detour is expected to save time overall; zero or negative means it is not."""
    added_drive_min(normal_drive_min, aware_drive_min)  # validates aware >= normal
    return (expected_time_min(normal_drive_min, normal_near, flood_delay_min)
            - expected_time_min(aware_drive_min, aware_near, flood_delay_min))


def routes_identical(normal_path, aware_path):
    """True when both routes use exactly the same node sequence."""
    return list(normal_path) == list(aware_path)
