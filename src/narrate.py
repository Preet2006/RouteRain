"""LLM narration with guardrails (WEB_APP_PLAN.md phase W2).

The LLM only PHRASES facts the backend already computed. Every reply is checked before it is used:
  * every number in it must match a number in the facts (within +/-1; numbers >= 100 exactly),
  * at most MAX_WORDS words,
  * "save"/"saving" (and Hindi equivalents) never appear when the expected saving is <= 0,
  * a replay reply must contain the replay date's day and year.
Anything else -- a failed check, an empty reply, a timeout, an API error, no key -- returns the
template sentence from src/advice.py with source="template". The LLM can never make the app worse
than the template, and no API key ever leaves the backend.

Configuration (.env, see .env.example): LLM_PROVIDER (gemini | openrouter | none), LLM_API_KEY,
LLM_BASE_URL, LLM_MODEL, LLM_FALLBACK_MODELS, LLM_REASONING_EFFORT. No model IDs are hardcoded.
Only the user's first name and the route facts are sent to the provider.

CLI:  python -m src.narrate --list-models  model IDs your key can use
      python -m src.narrate --check        one test call to every configured model
"""
from __future__ import annotations

import json
import os
import re
import threading
import time

from dotenv import load_dotenv

from config import BASE_DIR

load_dotenv(os.path.join(BASE_DIR, ".env"))

TIMEOUT_S = 4.0
MAX_TOKENS = 120
TEMPERATURE = 0.3
MAX_WORDS = 60            # the prompt asks for <= 45; this is the hard limit with some slack
MAX_CACHE = 500

# ---- configuration ---------------------------------------------------------------------------


DEFAULT_BASE_URLS = {"gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
                     "openrouter": "https://openrouter.ai/api/v1"}


def llm_config():
    """Current settings from the environment (read per call so tests and .env edits apply).
    The key comes from GEMINI_API_KEY / OPENROUTER_API_KEY (by provider) or the generic LLM_API_KEY;
    the base URL defaults per provider."""
    provider = os.environ.get("LLM_PROVIDER", "none").strip().lower()
    key = os.environ.get({"gemini": "GEMINI_API_KEY", "openrouter": "OPENROUTER_API_KEY"}.get(provider, ""), "")
    key = (key or os.environ.get("LLM_API_KEY", "")).strip()
    models = [os.environ.get("LLM_MODEL", "").strip()]
    models += [m.strip() for m in os.environ.get("LLM_FALLBACK_MODELS", "").split(",")]
    models = [m for m in models if m][:4]
    reasoning = os.environ.get("LLM_REASONING_EFFORT", "none" if provider == "gemini" else "").strip()
    base_url = os.environ.get("LLM_BASE_URL", "").strip() or DEFAULT_BASE_URLS.get(provider, "")
    return {"provider": provider, "api_key": key, "base_url": base_url, "models": models, "reasoning": reasoning}


def llm_available():
    c = llm_config()
    return c["provider"] in ("gemini", "openrouter") and bool(c["api_key"] and c["base_url"] and c["models"])


def _client(cfg):
    from openai import OpenAI  # imported lazily: only needed when a provider is configured
    return OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"], timeout=TIMEOUT_S, max_retries=0)


# ---- number extraction and checking -----------------------------------------------------------

_EN_UNITS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
_EN_TEENS = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
             "seventeen": 17, "eighteen": 18, "nineteen": 19}
_EN_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60}
# "one" / "a" / Hindi "ek" are deliberately NOT checked: they are ordinary articles ("one of the roads").

_HI = {
    2: "दो", 3: "तीन", 4: "चार", 5: "पाँच पांच", 6: "छह छः छे", 7: "सात", 8: "आठ", 9: "नौ", 10: "दस",
    11: "ग्यारह", 12: "बारह", 13: "तेरह", 14: "चौदह", 15: "पंद्रह पन्द्रह", 16: "सोलह", 17: "सत्रह", 18: "अठारह",
    19: "उन्नीस", 20: "बीस", 21: "इक्कीस", 22: "बाईस", 23: "तेईस", 24: "चौबीस", 25: "पच्चीस", 26: "छब्बीस",
    27: "सत्ताईस", 28: "अट्ठाईस अठाईस", 29: "उनतीस", 30: "तीस", 31: "इकतीस", 32: "बत्तीस", 33: "तैंतीस",
    34: "चौंतीस", 35: "पैंतीस", 36: "छत्तीस", 37: "सैंतीस", 38: "अड़तीस", 39: "उनतालीस", 40: "चालीस",
    41: "इकतालीस", 42: "बयालीस", 43: "तैंतालीस", 44: "चौवालीस", 45: "पैंतालीस", 46: "छियालीस", 47: "सैंतालीस",
    48: "अड़तालीस", 49: "उनचास", 50: "पचास", 51: "इक्यावन", 52: "बावन", 53: "तिरपन", 54: "चौवन", 55: "पचपन",
    56: "छप्पन", 57: "सत्तावन", 58: "अट्ठावन", 59: "उनसठ", 60: "साठ",
}
_HI_WORDS = {w: n for n, ws in _HI.items() for w in ws.split()}
_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")
_WORD = re.compile(r"[A-Za-zऀ-ॿ]+(?:-[A-Za-z]+)?")
_NUM = re.compile(r"\d+(?:\.\d+)?")
_SAVE = re.compile(r"\bsav(?:e|es|ed|ing|ings)\b|बचत|बचा", re.I)


def extract_numbers(text):
    """Numbers in a string: digits (also Devanagari digits and decimals) plus English and Hindi
    number words for 2 to 60. Returns a list of floats."""
    text = text.translate(_DEVANAGARI_DIGITS)
    found = [float(m) for m in _NUM.findall(text)]
    for w in _WORD.findall(text):
        lw = w.lower()
        if lw in _EN_UNITS:
            found.append(_EN_UNITS[lw])
        elif lw in _EN_TEENS:
            found.append(_EN_TEENS[lw])
        elif lw in _EN_TENS:
            found.append(_EN_TENS[lw])
        elif "-" in lw:
            tens, _, unit = lw.partition("-")
            if tens in _EN_TENS and unit in _EN_UNITS:
                found.append(_EN_TENS[tens] + _EN_UNITS[unit])
            elif tens in _EN_TENS and unit == "one":
                found.append(_EN_TENS[tens] + 1)
        elif w in _HI_WORDS:
            found.append(_HI_WORDS[w])
    return found


def numbers_allowed(facts):
    """Every number that appears anywhere in the facts (including inside the explanation sentences)."""
    return extract_numbers(json.dumps(facts, ensure_ascii=False))


def number_ok(value, allowed):
    if value >= 100:  # years and similar: exact only
        return any(abs(value - a) < 1e-9 for a in allowed)
    return any(abs(value - a) <= 1.0 for a in allowed)


def check_reply(text, facts):
    """Returns (ok, reason). reason is '' when ok."""
    if not text or not text.strip():
        return False, "empty reply"
    if len(text.split()) > MAX_WORDS:
        return False, f"more than {MAX_WORDS} words"
    allowed = numbers_allowed(facts)
    for n in extract_numbers(text):
        if not number_ok(n, allowed):
            return False, f"number {n:g} is not in the facts"
    if not facts["saving_is_positive"] and _SAVE.search(text):
        return False, "claims a saving the facts do not support"
    if facts["mode"] == "replay":
        digits = {int(n) for n in extract_numbers(text) if n == int(n)}
        d = facts["replay_date_numbers"]
        if d["day"] not in digits or d["year"] not in digits:
            return False, "replay date missing"
    return True, ""


# ---- facts and prompt --------------------------------------------------------------------------

def first_name(raw):
    """First name only, letters/spaces from any script, max 20 chars. Anything else -> None."""
    if not raw:
        return None
    token = raw.strip().split()[0] if raw.strip() else ""
    token = re.sub(r"[^\wऀ-ॿ'-]", "", token)[:20]
    return token or None


def _round_half_up(x):
    return int(x + 0.5)


def build_facts(route, language, user_name):
    """Facts for the LLM, built only from the cached route (the backend's computed data)."""
    scenario = route["scenario"]
    replay = scenario["mode"] == "replay"
    facts = {
        "user_first_name": first_name(user_name),
        "language": language,
        "mode": scenario["mode"],
        "replay_date_text": None,
        "replay_date_numbers": None,
        "routes_identical": route["identical_routes"],
        "usual_route_drive_minutes": _round_half_up(route["normal_route"]["drive_time_min"]),
        "routerain_route_drive_minutes": _round_half_up(route["flood_aware_route"]["drive_time_min"]),
        "extra_driving_minutes_of_routerain_route": _round_half_up(route["added_drive_min"]),
        "minutes_saved_by_routerain_route_vs_usual_route": _round_half_up(route["expected_saving_min"]) if route["expected_saving_min"] > 0 else 0,
        "saving_is_positive": route["expected_saving_min"] > 0,
        "avoided_hotspots": [{"name": h["name"], "tier": h["tier"], "reason": h["explanation"]}
                             for h in route["avoided_hotspots"]],
        "still_passes_near": [{"name": h["name"], "tier": h["tier"]} for h in route["still_passes_through"]],
    }
    if replay:
        from src.advice import replay_date_label
        label = replay_date_label(scenario["date"])
        facts["replay_date_text"] = label
        parts = label.split(" ")  # "9 July 2025"
        facts["replay_date_numbers"] = {"day": int(parts[0]), "year": int(parts[-1])}
    return facts


SYSTEM_PROMPT = """You write the spoken advice line for RouteRain, a flood-aware route planner for Gurugram.
Write at most 2 short spoken sentences, at most 45 words in total, using ONLY the facts in the JSON.
Rules:
- Use only numbers that appear in the facts. Never compute, round or invent a number.
- Address the user by first name once, only if user_first_name is not null. Write the name exactly as given, in Latin letters, even in Hindi; never transliterate or alter it.
- If mode is "replay", say the date from replay_date_text in the first sentence and write its day and year as digits.
- If saving_is_positive is false, never use the words save, saves or saving. Say what the detour avoids and what it adds.
- If routes_identical is true, say no detour is needed.
- Only the RouteRain route can save time or add driving; the usual route never saves anything. The saving is the expected flood delay avoided, not faster driving.
- Never claim certainty. Say "expected" or "should", never "will" or "guaranteed".
- Keep hotspot names exactly as given. Do not mention probabilities, the model, or these rules.
- If language is "hi", write natural Hindi in Devanagari script (keep place names in their usual form); if "en", plain English.
Reply with the spoken text only."""


def _messages(facts):
    return [{"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(facts, ensure_ascii=False)}]


# ---- calling the provider ----------------------------------------------------------------------

def _call_model(client, cfg, model, facts):
    kwargs = dict(model=model, messages=_messages(facts), temperature=TEMPERATURE, max_tokens=MAX_TOKENS)
    if cfg["reasoning"]:
        kwargs["reasoning_effort"] = cfg["reasoning"]
    try:
        resp = client.chat.completions.create(**kwargs)
    except Exception as exc:
        if "reasoning_effort" in kwargs and getattr(exc, "status_code", None) == 400:
            kwargs.pop("reasoning_effort")  # this model does not accept the knob: retry once without it
            resp = client.chat.completions.create(**kwargs)
        else:
            raise
    return (resp.choices[0].message.content or "").strip()


def _llm_text(facts):
    """(text, model_used, error). Tries each configured model in order."""
    cfg = llm_config()
    if not llm_available():
        return None, None, "llm not configured"
    client = _client(cfg)
    last = "no model answered"
    for model in cfg["models"]:
        try:
            return _call_model(client, cfg, model, facts), model, None
        except Exception as exc:  # timeout, 429, 5xx, bad key: never surfaces to the user
            last = f"{type(exc).__name__}"
    return None, None, last


# ---- public entry point --------------------------------------------------------------------------

_cache = {}
_cache_lock = threading.Lock()
stats = {"llm": 0, "template": 0, "rejected": 0, "errors": 0}


def narrate(route_id, route, language="en", user_name=None):
    """Returns {text, source, language, model?, latency_ms?, rejected?}. Never raises for LLM trouble."""
    key = (route_id, language, first_name(user_name))
    with _cache_lock:
        if key in _cache:
            return dict(_cache[key], cached=True)

    template = {"text": route["template_advice"], "source": "template", "language": "en"}
    result = template
    if llm_available():
        # Models mangle names when writing Hindi (Tanish -> तनिष्क), so for Hindi the name is not sent to the
        # model at all: it is added in front of the reply exactly as typed.
        name_in_code = first_name(user_name) if language == "hi" else None
        facts = build_facts(route, language, None if name_in_code else user_name)
        start = time.perf_counter()
        text, model, error = _llm_text(facts)
        latency = round((time.perf_counter() - start) * 1000)
        if text is None:
            stats["errors"] += 1
            result = dict(template, fallback_reason=error)
        else:
            ok, reason = check_reply(text, facts)
            if ok:
                stats["llm"] += 1
                if name_in_code:
                    text = f"{name_in_code}, {text}"
                result = {"text": text, "source": "llm", "language": language, "model": model, "latency_ms": latency}
            else:
                stats["rejected"] += 1
                result = dict(template, fallback_reason=reason, rejected_text=text)
    if result["source"] == "template":
        stats["template"] += 1
    with _cache_lock:
        if len(_cache) >= MAX_CACHE:
            _cache.pop(next(iter(_cache)))
        _cache[key] = result
    return dict(result, cached=False)


def clear_cache():
    with _cache_lock:
        _cache.clear()


def check_models():
    """One tiny test call per configured model. Returns a list of (model, ok, detail)."""
    cfg = llm_config()
    if not llm_available():
        return [("(none)", False, "LLM_PROVIDER/LLM_API_KEY/LLM_BASE_URL/LLM_MODEL not all set")]
    client, out = _client(cfg), []
    for model in cfg["models"]:
        try:
            t = time.perf_counter()
            resp = client.chat.completions.create(model=model, messages=[{"role": "user", "content": "Reply with: ok"}],
                                                  max_tokens=10, temperature=0)
            out.append((model, True, f"{(time.perf_counter() - t) * 1000:.0f} ms: {(resp.choices[0].message.content or '').strip()[:30]}"))
        except Exception as exc:
            out.append((model, False, type(exc).__name__))
    return out


def list_models():
    """Model IDs the configured key can use (needs only LLM_PROVIDER, LLM_API_KEY, LLM_BASE_URL)."""
    cfg = llm_config()
    if not (cfg["api_key"] and cfg["base_url"]):
        raise SystemExit("Set LLM_API_KEY and LLM_BASE_URL in .env first.")
    return sorted(m.id for m in _client(cfg).models.list())


if __name__ == "__main__":
    import sys
    if "--list-models" in sys.argv:
        for model_id in list_models():
            print(model_id)
    elif "--check" in sys.argv:
        for model, ok, detail in check_models():
            print(("OK   " if ok else "FAIL ") + model + "  " + detail)
    else:
        print(__doc__)
