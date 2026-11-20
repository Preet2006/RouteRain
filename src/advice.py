"""Template advice sentences for a planned route (WEB_APP_PLAN.md section 3.1).

Pure function, no I/O. Wording rules:
  * Routes identical (nothing at risk on the direct path) -> "No detour needed".
  * expected_saving > 0  -> may say "save".
  * expected_saving <= 0 -> NEVER uses the word "save": states what the detour avoids and what it
    costs, and leaves the decision to the user.
  * Replay days start with the date, so a replay is never mistaken for live.
Every number comes from the arguments (the backend's computed route data).
"""
import datetime as dt


def _minutes(x):
    """'under a minute', 'about 1 minute', 'about 5 minutes' (never '0 minutes')."""
    if x < 0.5:
        return "under a minute"
    n = round(x)
    return f"about {n} minute{'' if n == 1 else 's'}"


def _names(hotspots):
    parts = [f"{h['name']} ({h['tier']})" for h in hotspots]
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def replay_date_label(date_iso):
    d = dt.date.fromisoformat(date_iso)
    return f"{d.day} {d:%B %Y}"


def build_advice(*, identical, expected_saving_min, added_drive_min, avoided, still_passes,
                 origin_inside=(), dest_inside=(), replay_date=None):
    """avoided / still_passes / origin_inside / dest_inside: lists of dicts with 'name' and 'tier'."""
    on = f"On {replay_date_label(replay_date)}, " if replay_date else ""

    def sentence(text):  # capitalise the first letter only when nothing was prefixed
        return on + (text if on else text[0].upper() + text[1:])

    if not avoided and (origin_inside or dest_inside):
        inside = list(origin_inside) + list(dest_inside)
        which = "starting point" if origin_inside else "destination"
        return sentence(f"your {which} is inside a flood risk zone ({_names(inside)}), so no other road avoids it "
                        f"entirely. Consider a different {which} if you can.")

    if not avoided:
        if replay_date:
            text = sentence("no detour was needed: the direct route doesn't pass near any RED or YELLOW hotspot.")
        else:
            text = "No detour needed today: your direct route doesn't pass near any RED or YELLOW hotspot."
        if still_passes:
            text = sentence(f"no road avoids {_names(still_passes)} from here, so the direct route is also the "
                            f"flood-aware route. Allow extra time.")
        return text

    adds = _minutes(added_drive_min)
    if expected_saving_min > 0:
        text = sentence(f"this route adds {adds} of driving but is expected to save {_minutes(expected_saving_min)} "
                        f"overall by avoiding {_names(avoided)}.")
    else:
        text = sentence(f"this detour avoids {_names(avoided)} but adds {adds} of driving, more than the flood delay "
                        f"it is expected to avoid. It's your call.")
    if still_passes:
        text += f" It still passes near {_names(still_passes)}, because no other road avoids it."
    return text
