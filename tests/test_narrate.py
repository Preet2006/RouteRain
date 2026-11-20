import os
import types

import pytest
from dotenv import dotenv_values

import src.narrate as nr

ROUTE = {
    "scenario": {"mode": "replay", "date": "2026-08-07", "forecast_generated_at": None},
    "identical_routes": False,
    "normal_route": {"drive_time_min": 7.8}, "flood_aware_route": {"drive_time_min": 8.8},
    "added_drive_min": 1.1, "expected_saving_min": 8.1,
    "avoided_hotspots": [{"name": "Rajiv Chowk", "tier": "RED", "probability": 0.39,
                          "explanation": "Rajiv Chowk is RED. 45 mm of rain is forecast in a single hour."}],
    "still_passes_through": [],
    "template_advice": "On 7 August 2026, this route adds about 1 minute of driving but is expected to save about 8 minutes overall by avoiding Rajiv Chowk (RED).",
}
LIVE_NO_SAVING = {**ROUTE, "scenario": {"mode": "live", "date": None, "forecast_generated_at": "x"},
                  "expected_saving_min": -2.0,
                  "template_advice": "This detour avoids Rajiv Chowk (RED) but adds about 1 minute of driving, more than the flood delay it is expected to avoid. It's your call."}

GOOD = "On 7 August 2026, Tanish, take the RouteRain route: it adds about 1 minute but avoids Rajiv Chowk, rated RED, saving about 8 minutes."


class FakeClient:
    """Stands in for the openai client. `script` is a list of replies or exceptions, used in order."""

    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.calls.append(kw)
        item = self.script.pop(0) if self.script else self.script_default
        if isinstance(item, Exception):
            raise item
        return types.SimpleNamespace(choices=[types.SimpleNamespace(message=types.SimpleNamespace(content=item))])

    script_default = GOOD


@pytest.fixture
def llm(monkeypatch):
    for k, v in {"LLM_PROVIDER": "gemini", "LLM_API_KEY": "k", "LLM_BASE_URL": "http://x/",
                 "LLM_MODEL": "m1", "LLM_FALLBACK_MODELS": "", "LLM_REASONING_EFFORT": ""}.items():
        monkeypatch.setenv(k, v)
    nr.clear_cache()
    holder = {}

    def install(script):
        holder["c"] = FakeClient(script)
        monkeypatch.setattr(nr, "_client", lambda cfg: holder["c"])
        return holder["c"]
    return install


# ---- the three required cases ---------------------------------------------------------------------

def test_valid_reply_is_used(llm):
    llm([GOOD])
    r = nr.narrate("r1", ROUTE, "en", "Tanish")
    assert r["source"] == "llm" and r["text"] == GOOD and r["model"] == "m1"


def test_invented_number_falls_back_to_template(llm):
    llm(["On 7 August 2026, Tanish, take this route, it saves about 30 minutes by avoiding Rajiv Chowk."])
    r = nr.narrate("r2", ROUTE, "en", "Tanish")
    assert r["source"] == "template" and r["text"] == ROUTE["template_advice"]
    assert "30" in r["fallback_reason"]


def test_timeout_falls_back_to_template(llm):
    llm([TimeoutError("timed out")])
    r = nr.narrate("r3", ROUTE, "en", "Tanish")
    assert r["source"] == "template" and r["text"] == ROUTE["template_advice"]


# ---- more guardrails ------------------------------------------------------------------------------------

def test_number_words_are_checked_in_english_and_hindi():
    facts = nr.build_facts(ROUTE, "en", None)
    assert nr.extract_numbers("twenty-five minutes and fifteen more") == [25, 15]
    assert nr.extract_numbers("तीस मिनट और ८ किमी") == [8, 30] or sorted(nr.extract_numbers("तीस मिनट और ८ किमी")) == [8, 30]
    assert nr.check_reply("On 7 August 2026 it adds about two minutes and avoids Rajiv Chowk.", facts)[0]
    ok, why = nr.check_reply("On 7 August 2026 it adds about thirty minutes.", facts)
    assert not ok and "30" in why
    ok, why = nr.check_reply("7 August 2026 में यह रास्ता चालीस मिनट लेगा", nr.build_facts(ROUTE, "hi", None))
    assert not ok and "40" in why


def test_numbers_within_one_pass_but_years_must_be_exact():
    facts = nr.build_facts(ROUTE, "en", None)
    assert nr.check_reply("On 7 August 2026 it takes 9 minutes, adding 2.", facts)[0]  # 8.8 -> 9, 1 -> 2 (+/-1)
    assert not nr.check_reply("On 7 August 2025 it takes 9 minutes.", facts)[0]


def test_save_word_is_rejected_when_saving_is_not_positive(llm):
    llm(["Tanish, this detour avoids Rajiv Chowk and will save you time."])
    r = nr.narrate("r4", LIVE_NO_SAVING, "en", "Tanish")
    assert r["source"] == "template" and "save" not in r["text"].lower().replace("'s", "")


def test_replay_reply_without_the_date_is_rejected(llm):
    llm(["Take the RouteRain route, it adds about 1 minute and avoids Rajiv Chowk."])
    assert nr.narrate("r5", ROUTE, "en", None)["source"] == "template"


def test_too_long_or_empty_replies_are_rejected(llm):
    llm(["On 7 August 2026 " + "word " * 70])
    assert nr.narrate("r6", ROUTE, "en", None)["source"] == "template"
    llm([""])
    assert nr.narrate("r7", ROUTE, "en", None)["source"] == "template"


def test_hindi_reply_with_devanagari_digits_and_date(llm):
    reply = "७ अगस्त २०२६ को टनिश, यह रास्ता लगभग १ मिनट ज़्यादा लेता है पर राजीव चौक से बचाता है, लगभग ८ मिनट की बचत।"
    llm([reply])
    r = nr.narrate("r8", ROUTE, "hi", "Tanish")
    assert r["source"] == "llm" and r["language"] == "hi" and r["text"] == reply


def test_template_fallback_reports_english_for_hindi_requests(llm):
    llm([RuntimeError("boom")])
    r = nr.narrate("r9", ROUTE, "hi", "Tanish")
    assert r["source"] == "template" and r["language"] == "en"


def test_fallback_models_are_tried_in_order(llm, monkeypatch):
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "m2, m3")
    c = llm([RuntimeError("429"), RuntimeError("429"), GOOD])
    r = nr.narrate("r10", ROUTE, "en", "Tanish")
    assert r["source"] == "llm" and r["model"] == "m3" and [k["model"] for k in c.calls] == ["m1", "m2", "m3"]


def test_all_models_failing_gives_template(llm, monkeypatch):
    monkeypatch.setenv("LLM_FALLBACK_MODELS", "m2")
    llm([RuntimeError("a"), RuntimeError("b")])
    assert nr.narrate("r11", ROUTE, "en", None)["source"] == "template"


def test_results_are_cached_per_route_language_and_name(llm):
    c = llm([GOOD, GOOD, GOOD])
    nr.narrate("r12", ROUTE, "en", "Tanish")
    again = nr.narrate("r12", ROUTE, "en", "Tanish")
    assert again["cached"] and len(c.calls) == 1
    nr.narrate("r12", ROUTE, "en", "Aryan")
    nr.narrate("r12", ROUTE, "hi", "Tanish")
    assert len(c.calls) == 3


def test_reasoning_knob_is_sent_for_gemini_and_dropped_if_rejected(llm, monkeypatch):
    class Bad(Exception):
        status_code = 400
    monkeypatch.setenv("LLM_REASONING_EFFORT", "none")
    c = llm([Bad("unsupported"), GOOD])
    r = nr.narrate("r13", ROUTE, "en", "Tanish")
    assert r["source"] == "llm" and "reasoning_effort" in c.calls[0] and "reasoning_effort" not in c.calls[1]
    assert c.calls[0]["temperature"] == 0.3 and c.calls[0]["max_tokens"] == 120


# ---- privacy and configuration ----------------------------------------------------------------------------

def test_only_first_name_and_route_facts_are_sent(llm):
    c = llm([GOOD])
    nr.narrate("r14", ROUTE, "en", "  Tanish Sharma  ")
    sent = " ".join(m["content"] for m in c.calls[0]["messages"])
    assert "Tanish" in sent and "Sharma" not in sent
    for secret in ("lat", "lon", "route_id", "r14", "polyline", "@"):
        assert secret not in c.calls[0]["messages"][1]["content"]


def test_first_name_cleaning():
    assert nr.first_name("  Tanish Sharma ") == "Tanish"
    assert nr.first_name("<script>x") == "scriptx"
    assert nr.first_name("") is None and nr.first_name(None) is None and nr.first_name("!!!") is None
    assert nr.first_name("A" * 50) == "A" * 20


def test_provider_none_gives_template_without_any_client(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "none")
    monkeypatch.setattr(nr, "_client", lambda cfg: pytest.fail("client must not be created"))
    nr.clear_cache()
    r = nr.narrate("r15", ROUTE, "en", "Tanish")
    assert r["source"] == "template" and not nr.llm_available()


def test_missing_key_or_model_means_unavailable(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_API_KEY", "")
    assert not nr.llm_available()


def test_no_model_ids_are_hardcoded():
    src = open(nr.__file__, encoding="utf8").read()
    assert "gemini-" not in src and "gpt-" not in src and ":free" not in src.replace("`:free`", "")


def test_env_example_parses_with_empty_values():
    env = dotenv_values(os.path.join(os.path.dirname(nr.__file__), "..", ".env.example"))
    assert env["LLM_PROVIDER"] == "none" and env["LLM_API_KEY"] == "" and env["LLM_MODEL"] == ""
    assert env["LLM_BASE_URL"].startswith("https://generativelanguage.googleapis.com")


# ---- the endpoint -------------------------------------------------------------------------------------------

def test_narrate_endpoint_uses_the_llm_and_reports_the_source(llm, monkeypatch):
    from fastapi.testclient import TestClient
    import app.web_api as web
    from app.api import app
    llm([GOOD])
    web._routes["abc123abc123"] = (1e12, {**ROUTE, "route_id": "abc123abc123"})
    try:
        c = TestClient(app)
        r = c.post("/api/v2/narrate", json={"route_id": "abc123abc123", "user_name": "Tanish", "language": "en"})
        assert r.status_code == 200 and r.json()["source"] == "llm" and r.json()["text"] == GOOD
        assert c.get("/api/v2/health").json()["llm_available"] is True
    finally:
        web._routes.pop("abc123abc123", None)
