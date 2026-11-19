# RouteRain Mobile: Phase-Wise Build Plan for Claude Code

**Project:** RouteRain Android app (React Native / Expo) for the live demo
**Group 6** · Aryan Srivastava, Preet Jhagekar, Laksh Sharda, Mayank Bansal
**Builds on:** `PLAN.md` Phases 1 to 10 (already done, **on Google Colab**). The model, `predict.py`, `explain.py`, `route_planner.py`, the cached road graph and the FastAPI backend in `app/api.py` exist in the Colab/Google Drive copy. Phase L0 moves them to the laptop (VS Code) first. This plan does **not** retrain or change the model unless the owner approves it in L0.
**Audience:** Claude Code, executing phase by phase, and the project owner, approving each phase.

---

## 0. Rules (same spirit as PLAN.md §0, plus mobile-specific ones)

1. **One phase at a time.** Each phase ends with a Phase Report in the exact format of `PLAN.md` §1, then STOPS until the project owner says "proceed to Phase Mn+1".
2. **Do not touch the model or the training pipeline.** Mobile work only reads from `models/`, `config.py`, `src/predict.py`, `src/explain.py`, `src/route_planner.py`. If a change there looks necessary, stop and ask.
3. **The backend stays the brain, the phone stays thin.** All scoring, routing and LLM calls run on the FastAPI server. The app never holds the model, the road graph, or any API key.
4. **No secret in the app bundle.** Anything inside a React Native build can be extracted from the APK. The LLM API key (Gemini or OpenRouter) lives only in the backend `.env`.
5. **Never present a replay as live.** If the screen shows a historical day (see §2.3), it must say so on screen and in the spoken line.
6. **Spoken and displayed numbers must come from the backend's computed route data.** The LLM may phrase them; it may not invent or round them into something new (enforced in Phase M2).
7. **Python work uses the existing `venv`.** JS work uses Node LTS and `npx expo install` (not plain `npm install`) for any Expo-managed package, so versions match the SDK.
8. **Fail loudly.** A failed API call shows a clear error state in the app, never a blank map or a silently empty route.

---

## 1. Target Stack (decided, with reasons)

| Layer | Choice | Why |
|---|---|---|
| App framework | **Expo SDK 58** (React Native 0.88) + TypeScript + Expo Router | Current stable Expo release. Expo Go lets the team run the app on an Android phone in minutes with no Android Studio. |
| Map | `react-native-maps` (Google provider on Android) | Included in Expo Go with no setup, so development needs no API key. A key is needed only for the final APK (Phase M9). |
| Voice output | `expo-speech` | On-device text-to-speech, works in Expo Go, supports `en-IN` and (device permitting) `hi-IN` voices. Free, offline, no latency. |
| Location | `expo-location` | "Use my current location" for pickup. |
| Bottom sheets / gestures | `@gorhom/bottom-sheet`, `react-native-reanimated`, `react-native-gesture-handler` | Map-first layout with a draggable sheet, the pattern users know from Uber/Ola/Google Maps. |
| Local storage | `@react-native-async-storage/async-storage` | Personalisation (name, saved places, preferences) stays on the phone. No login, no accounts. |
| Data fetching | `@tanstack/react-query` + `zod` | Caching, retries, loading/error states, and runtime validation of backend responses. |
| Haptics | `expo-haptics` | Small tactile feedback on route found / RED warning. |
| LLM | **Gemini API (primary) or OpenRouter (alternative)**, called **from the backend only** through the `openai` Python SDK pointed at an OpenAI-compatible endpoint. Provider, base URL and model name come from `.env`, so switching is a config change, not a code change. | Both have free tiers. Gemini's free tier covers its Flash and Flash-Lite models and writes good Hindi. OpenRouter's free models are capped at 50 requests a day without a top-up and can disappear without notice, so it needs 2 to 3 fallback model IDs. Either way, any failure falls back to the existing `explain.py` templates. |
| Backend | Existing FastAPI `app/api.py`, extended with `/mobile/v1/*` routes | Reuses the model, explainer and router exactly as they are. |
| Phone ↔ laptop | Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:8000`) giving a public HTTPS URL | Works on any network (college Wi-Fi often blocks device-to-device traffic), and HTTPS avoids Android's cleartext-HTTP block in release builds. |
| Final demo build | EAS Build `preview` profile → installable `.apk` | Runs as a normal app icon on the phone, independent of Expo Go and of the laptop's Metro bundler. |

**Things deliberately NOT in scope:** turn-by-turn navigation, iOS build, user accounts, push notifications (Phase 10's Telegram alert already covers that), voice *input*. Voice input would need a development build with a native speech-recognition module; listed as a stretch item in §12.

---

## 2. Three Problems This Plan Must Solve Honestly

### 2.1 "Time saved" is not automatic

`PLAN.md` Phase 9 requires that the flood-aware route is **never faster** than the normal route in plain driving time. So "take this route, you save X minutes" is false if X is computed from driving time alone. The saving only exists once you account for the expected delay of driving into a flooded hotspot.

**Definition to implement (Phase M1):**

```
expected_time(route) = drive_time(route)
                     + Σ over hotspots h near route:  p_h × FLOOD_DELAY_MIN

expected_saving = expected_time(normal_route) - expected_time(flood_aware_route)
```

- `p_h` is the **calibrated** probability from `predict.py` (Phase 7 calibrated it with Platt scaling precisely so it can be read as a probability).
- "Near route" uses the same buffers as `route_planner.py` (500 m RED, 300 m YELLOW). GREEN hotspots add `p_h × FLOOD_DELAY_MIN` too, so the maths is consistent. Replay-day hotspots that were not scored have no probability and add nothing.
- **The delay is one number, independent of tier** (owner decision in M0). How likely a flood is lives in `p_h`; how long a flood delays you lives in `FLOOD_DELAY_MIN`. It is an **assumption**, not measured data, built in `config.py` in two steps:
  - `FLOOD_SEVERITY_DELAY_MIN = {"minor": 5, "disrupted": 20, "closed": 45}` minutes, by the severity recorded in `flood_events.csv` (1 = minor pooling, 2 = traffic disrupted, 3 = road closed).
  - `FLOOD_DELAY_MIN` = the average of those three values weighted by how often each severity appears in `flood_events.csv` (15 minor, 121 disrupted, 32 closed of 168), which comes to about **23.4 minutes**. It is computed when `config.py` loads.
  - **Do not change either value after routes have been scored without asking the project owner.** Only 2 of the 168 events record a duration, so the data cannot confirm these numbers. The app's info screen must state that the saving is an estimate built on this assumption.
- Speech rules:
  - If routes are identical → "No detour needed today."
  - If `expected_saving > 0` → "This route adds about A minutes of driving but is expected to save about S minutes overall by avoiding Bilaspur Chowk, rated RED."
  - If `expected_saving <= 0` → do **not** say "saves". Say what the detour avoids and what it costs, and let the user decide.

### 2.2 Place search must respect geocoder policies

The public Nominatim server allows at most one request per second, needs an identifying User-Agent, and forbids autocomplete. Typing-as-you-search against it would break the policy and can get the IP blocked mid-demo.

**Approach (Phase M1):**
1. A curated `data/raw/places_gurugram.csv` of ~60 to 100 common Gurugram pickup/drop points (metro stations, Cyber Hub, malls, sector markers, the 12 hotspots, colleges incl. MDI, hospitals) with coordinates. Instant, offline, perfect for the demo. The team supplies or approves this list; Claude Code may propose entries but must mark them unverified until a team member checks them on a map (same discipline as `PLAN.md` Phase 2).
2. Search-as-you-type filters **only** this local list.
3. A "Search the full map" button sends one Nominatim request on submit (backend-side, rate-limited to 1/s, cached, `viewbox` bounded to Gurugram), as `geopy` already does in Phase 9.
4. Plus "Use current location" and "Pick on map" (long-press).

### 2.3 November has no monsoon

The demo is likely to happen outside June to September. A live forecast will almost certainly show 12 GREEN hotspots and no reroute, which is correct but a dull demo.

**Approach:** a clearly labelled **Scenario switch** with two modes:
- **Live** (default): today's Open-Meteo forecast through `predict.py`.
- **Replay a past monsoon day**: reuse `historical_scenarios()` in `app/api.py`, which rescores `training_data.csv` rows on dates with at least one recorded flood (47 dates). The replay dates were chosen by the project owner in Phase M0 and live in `config.MOBILE_REPLAY_DATES`: **2026-08-07, 2026-07-08, 2025-07-31, 2025-07-09**. All four are in the 2025 to 2026 test period, so the model has not seen them in training.
- **Hotspots with no row on a replay date:** `training_data.csv` only holds hotspot-days with more than 10 mm of rain, so some replay dates cover as few as 2 hotspots. Hotspots without a row are shown as **"LOW RAIN: not scored (under 10 mm)"** with a neutral grey marker, and are treated like GREEN for routing. They are never given an invented probability.
- **Ground truth in replay:** each replay row carries the real `flooded` outcome. Show it only as a separate, labelled line in the hotspot sheet ("Reported that day: flooded / no report"), never as the prediction. Used honestly, it lets the demo show where the model was right and where it missed.
- In replay mode a yellow banner shows "Replay: 14 July 2025 weather", and the spoken line starts with "On 14 July 2025, ...".

---

## 3. App Experience (what the user sees)

```
Splash ─► Welcome (first launch only) ─► Quick setup (3 short steps) ─► Home
                                                                         │
             ┌───────────────────────────────────────────────────────────┤
             ▼                         ▼                                 ▼
      Where from / Where to      Hotspot sheet (tap marker)        Settings / About
             │
             ▼
      Route results  (map with both routes + comparison card + spoken advice)
```

**Welcome:** RouteRain logo, one-line value statement ("Know before you go: flood-aware routes for Gurugram"), "Get started".

**Quick setup (skippable, editable later in Settings):**
1. Your name (used in greetings and voice).
2. Home and Work (optional; picked with the same place picker).
3. Preferences: voice on/off, voice language (English, Hindi), and a "How cautious?" choice:
   - *Cautious*: avoid RED and YELLOW (uses the existing ×15 / ×3 penalties).
   - *Balanced*: avoid RED only (YELLOW penalty set to ×1).

**Home:**
- Full-screen dark map of Gurugram with the 12 hotspot markers. Each marker shows colour **and** a text label/icon (`RED`, `YELLOW`, `GREEN`), per `PLAN.md`'s colour-blind rule.
- Top: greeting ("Good evening, Tanish"), forecast timestamp, Live/Replay chip.
- Bottom sheet: big "Where to?" field, chips for Home / Work / recent trips, and a one-line city summary ("2 hotspots at risk today").
- Persistent small caveat link: "Guide, not a guarantee".

**Place picker:** search box with instant results from the curated list, "Use my location", "Pick on map", saved and recent places, and the "Search the full map" fallback.

**Route results:**
- Map: normal route grey dashed, flood-aware route solid blue, hotspot buffers drawn as translucent circles, legend.
- Comparison card: two columns (Usual route / RouteRain route) with drive time, distance, at-risk hotspots passed, expected time incl. flood risk.
- Headline: the advice sentence, e.g. "Take the RouteRain route. It avoids Bilaspur Chowk (RED) and should save about 12 minutes overall."
- "Why?" section, visible without a tap: the `explain.py` reason for each avoided hotspot.
- Voice plays automatically once (if enabled), with Replay and Stop buttons.
- "Open in Google Maps" button (stretch, see §12).

**Hotspot sheet:** name, tier with word, probability shown as a percentage band, `explain.py` sentence, lat/lon.

**Design direction:** dark theme consistent with the existing web dashboard; one accent colour (rain blue) plus the three tier colours; large touch targets (≥ 48 dp), readable at arm's length on a projector-mirrored phone; skeleton loaders instead of spinners; no screen more than two taps from Home.

---

## 4. Backend API Contract (added in Phase M1)

All under `/mobile/v1`. JSON only. Every response includes `scenario: {mode: "live"|"replay", date, forecast_generated_at}`.

| Method & path | Input | Output |
|---|---|---|
| `GET /health` | | `{ok, model_loaded, graph_loaded, llm_available}` |
| `GET /scenarios` | | list of replay dates + labels chosen in M0 |
| `GET /hotspots` | `?mode=live|replay&date=` | 12 items: `id, name, lat, lon, tier, probability, explanation` |
| `GET /places/search` | `?q=` | up to 8 matches from the curated list |
| `POST /places/geocode` | `{q}` | one Nominatim lookup, Gurugram-bounded, rate-limited |
| `POST /route` | `{origin:{lat,lon}, destination:{lat,lon}, caution:"cautious"|"balanced", mode, date}` | `route_id`, both routes (simplified polylines ≤ 300 points each), drive times, distances, hotspots near each, `expected_time` each, `expected_saving_min`, `added_drive_min`, `avoided_hotspots[]`, `template_advice` (from `explain.py`) |
| `POST /narrate` | `{route_id, user_name?, language:"en"|"hi"}` | `{text, source:"llm"|"template"}` |

Validation: reject origins/destinations more than 1 km from the nearest road-graph node with a clear message ("That point is outside RouteRain's Gurugram coverage"). Cache route results in memory by `route_id` for 30 minutes so `/narrate` never recomputes the route.

---

## 4A. Phase L0: Move the Project from Colab to the Laptop

**Goal:** the existing backend (model, predictor, explainer, router, FastAPI) running locally in VS Code with a project venv, producing the **same predictions** it produced in Colab. Nothing new is built in this phase.

**Why this matters:** a pickled scikit-learn model (`risk_model.pkl`) is only reliable when loaded with the same scikit-learn version that saved it. Colab also hardcodes paths like `/content/drive/MyDrive/...` that don't exist on a laptop. And a Colab runtime disconnects when idle and has a maximum session length, so it can't host the backend reliably during a live demo.

**Owner does these steps in Colab first (Claude Code can't reach Colab):**
1. In a Colab cell, record the environment and save it to Drive:
   ```python
   !python --version
   import sklearn, numpy, pandas, joblib; print(sklearn.__version__, numpy.__version__, pandas.__version__, joblib.__version__)
   !pip freeze > /content/drive/MyDrive/RouteRain/requirements_colab.txt
   ```
   Also export a reference prediction for the parity check in step L0.6:
   ```python
   # run the project's predict.py logic on one fixed replay date for all 12 hotspots
   # and save hotspot_id, probability, tier to /content/drive/MyDrive/RouteRain/colab_reference_predictions.csv
   ```
2. Confirm every project file is in Google Drive, not only in `/content/` (files outside Drive are wiped when the runtime resets). If some only exist inside notebook cells, download the `.ipynb` files too.
3. Download the whole Drive `RouteRain` folder (Drive web → right-click → Download, gives a zip) and unzip it into the laptop folder that VS Code will open.

**Claude Code does these steps on the laptop:**
1. **Inventory:** list what arrived. Check for every file `PROGRESS.md` mentions. The minimum to serve the app: `config.py`, `src/predict.py`, `src/explain.py`, `src/route_planner.py`, `app/api.py`, `models/risk_model.pkl`, `data/raw/hotspots.csv`, `data/processed/` (weather, terrain, labels, training data), `data/external/road_graph.graphml`. The DEM tile and raw rainfall JSON are not needed to serve, only to rebuild. Report anything missing. Do not recreate missing data.
2. **Notebook-only code:** if logic exists only inside `.ipynb` cells (or as `%%writefile` cells), extract it into the matching `src/*.py` file without changing behaviour, and list each extracted cell in the report.
3. **Paths:** replace every Colab path (`/content/...`, `drive.mount`, `google.colab` imports) with paths built from the project root (`Path(__file__).resolve().parent` in `config.py`). Report every line changed.
4. **Environment:** install the same Python major.minor version Colab used. Create `venv`, then write a **serving** `requirements.txt` pinned to the Colab versions for at least `scikit-learn`, `numpy`, `pandas`, `joblib`, `scipy`, `networkx`, `osmnx`, `shapely`, `geopandas`, `fastapi`, `uvicorn`, `requests`, `python-dotenv`, `geopy`. Leave `richdem` and `elevation` out (only needed to rebuild terrain). Install and report any package that fails.
5. **Load check:** load `models/risk_model.pkl` and the road graph, print the model type, feature names and any scikit-learn version warning. A version warning is a failure for this phase, not something to ignore.
6. **Parity check:** run the local `predict.py` on the same date as `colab_reference_predictions.csv`. All 12 tiers must match and probabilities must agree to 4 decimal places. Report the side-by-side table.
7. **Smoke test:** start `uvicorn app.api:app --port 8000`, call one existing hotspot endpoint and one route endpoint, report response times.
8. **Version control:** the repo already exists on GitHub. The `.graphml` (66 MB) and processed data are tracked; only `*.pkl` is gitignored, so the model file must be backed up on Drive. Untrack `cache/` and `.claude/scheduled_tasks.lock` and add both to `.gitignore`.
9. **Housekeeping from the R0 review:** make `MODEL_PATH` in `predict.py` and `train_model.py` use `config.BASE_DIR` instead of the working directory; move the Nominatim User-Agent contact in `route_planner.py` into `.env` (`NOMINATIM_USER_AGENT`) so no personal email sits in code; add `geopandas`, `shapely`, `networkx`, `scipy` to the serving requirements since they are imported directly or needed at runtime.
10. **Record versions in the model file going forward:** if the model is ever re-saved, store Python, scikit-learn, numpy and pandas versions inside the `joblib` dict so this problem cannot recur.

**If the parity check fails and can't be fixed by matching versions:** stop and ask. The fallback is re-running the existing `src/train_model.py` locally to regenerate the model and checking that the test ROC-AUC comes out close to 0.6380, but that is a retrain, and the owner must approve it.

**Report** per `PLAN.md` §1, then STOP.

---

## 5. Phase M0: Audit & Decisions (no new code)

**Goal:** know exactly what the existing backend does before extending it, and get the owner's decisions on the open values.

**Tasks:**
1. The endpoint inventory, route_planner findings and graph coverage were already done in the Phase R0 repo review. Do not repeat them; refer to the R0 report. Only re-check anything L0 changed.
2. Confirm `route_planner.py` returns travel time (not only length), and how the road graph's bounding box compares with the 12 hotspots.
3. Time a cold backend start (graph load + model load) and a single route computation. Report the numbers; a demo-day route should return in under ~3 s.
4. Propose, for the owner to approve:
   - The flood delay (§2.1): decided, a single tier-independent `FLOOD_DELAY_MIN` of about 23.4 minutes from `FLOOD_SEVERITY_DELAY_MIN`.
   - 3 to 5 replay dates with the reason for each (§2.3).
   - Draft of `places_gurugram.csv` (§2.2), every row marked `verified=0`.
5. Check the dev machine: Node LTS version, `npx expo --version`, Android phone's Android version, Expo Go installed from Play Store.

**Report** per `PLAN.md` §1, including the endpoint inventory and the three proposals. STOP for decisions.

---

## 6. Phase M1: Mobile API on the Backend

**Goal:** the §4 contract working and tested from the laptop, without any LLM yet.

**Tasks:**
1. Add `app/mobile_api.py` as an `APIRouter` mounted in `app/api.py` under `/mobile/v1`. Do not break existing web endpoints.
2. Add `FLOOD_SEVERITY_DELAY_MIN`, `FLOOD_DELAY_MIN`, `MOBILE_REPLAY_DATES`, `ROUTE_CACHE_TTL_MIN = 30` to `config.py` (done).
3. Implement `expected_time` / `expected_saving` (§2.1) as a pure function in `src/route_metrics.py` with unit tests (`tests/test_route_metrics.py`, pytest): identical routes → saving 0; no hotspots → saving 0; RED on normal route only → positive saving; flood-aware drive time ≥ normal drive time always.
4. Caution mode: `balanced` sets the YELLOW penalty to ×1 for that request only. `route_planner.py` currently holds the penalties and buffers as module constants (lines 62 to 65), so add optional parameters to `plan_route` with the current values as defaults. The existing web `/api/route` must behave exactly as before.
5. Polyline simplification to ≤ 300 points per route (Douglas–Peucker via `shapely`, already imported by `route_planner.py`). Polylines follow the road **edge geometry** (owner decision), not just the junction nodes, and are simplified after that.
5a. A new proximity function listing **every** hotspot (GREEN included) within a buffer of each route, for the expected-time maths in §2.1. Use the YELLOW 300 m buffer for GREEN hotspots.
5b. A module-level Nominatim rate limiter (the current one is rebuilt on every call, so the 1 req/s limit is not enforced across requests).
5c. Performance and memory: the road graph alone takes ~1 GB of RAM (measured in L0 part 1), and `build_penalized_graph` copies the whole graph on every request. Do **not** cache full graph copies. Instead:
   - Precompute once per `(scenario date)` the set of edge IDs inside each RED/YELLOW buffer (a small set, not a graph).
   - Route with a networkx weight **function**, e.g. `weight=lambda u, v, d: d["travel_time"] * penalty_for(u, v)`, so the original graph is never copied.
   - Report before/after timings and peak memory. The existing web `/api/route` should switch to the same path only if its outputs stay identical on 2 test routes.
5d. Coordinate input: `/mobile/v1/route` takes lat/lon and calls `plan_route` directly, skipping the text resolver. Keep the existing 15 km out-of-area rule for text geocoding and add the 1 km snap-to-road check for lat/lon.
5e. Unreachable routes (owner decision): the graph is directed, and a point can snap to a one-way pocket with no path (for example Ambience Mall to Sohna). Try the normal nearest nodes first; if there is no path, snap both points to the nearest node of the largest strongly connected component; if there is still no path (or that snap is more than 1 km away), `/route` returns 422 "No drivable route found between these points."
5f. Startup (owner decision): load the road graph and build the edge cache when the server starts, so the first request is not slow.
6. Curated places search + rate-limited, cached Nominatim geocode (1 req/s, identifying User-Agent, bounded viewbox).
7. `tests/test_mobile_api.py` using FastAPI `TestClient` for every endpoint, including the out-of-coverage error and a forced-RED replay route.

**Sanity checks to report:** test results; for 2 origin/destination pairs in replay mode, the full `/route` JSON summary (drive times, saving, avoided hotspots); response times.

**Report**, then STOP.

---

## 7. Phase M2: LLM Narration with Guardrails

**Goal:** natural, personalised spoken advice that cannot state a wrong number.

**Tasks:**
1. Add `openai` (used only as an OpenAI-compatible client) to `requirements.txt`. Configure in `.env`, with an `.env.example` holding empty values:
   ```bash
   LLM_PROVIDER=gemini            # gemini | openrouter | none
   LLM_API_KEY=
   # Gemini (Google AI Studio key):
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
   LLM_MODEL=                     # a current Gemini Flash or Flash-Lite model ID, copied from AI Studio
   # OpenRouter alternative:
   # LLM_BASE_URL=https://openrouter.ai/api/v1
   # LLM_MODEL=                   # one :free model ID from openrouter.ai/models
   # LLM_FALLBACK_MODELS=         # comma-separated, 2 to 3 more :free IDs
   ```
   Do not hardcode model IDs in code. Free model lineups change; the owner picks current IDs at setup time and Claude Code verifies each one with a single test call. `LLM_PROVIDER=none` must work and gives template-only narration.
   Free-tier notes for the report: Gemini free-tier prompts may be used by Google to improve its products, so send only the route facts and the user's first name, nothing else personal. OpenRouter free usage is capped per day, so the narration cache in step 2 matters.
2. `src/narrate.py`:
   - Build a **facts object** from the cached route: user name, language, mode/date, both drive times, `added_drive_min`, `expected_saving_min`, avoided hotspots with tier and their `explain.py` reasons.
   - System prompt: write at most 2 short spoken sentences (≤ 45 words), address the user by name once, use only numbers present in the facts, never claim certainty, if mode is replay say the date, never say "save" when `expected_saving_min <= 0`. For `hi`, write natural Hindi in Devanagari, keeping place names in their usual form.
   - Model from `LLM_MODEL` (for OpenRouter, try `LLM_FALLBACK_MODELS` in order on a 429 or error), temperature 0.3, max ~120 output tokens, 4-second timeout. If the model has a "thinking" mode, turn it off or set its budget to minimum, since it adds latency for no gain on 2 sentences.
   - **Number check:** extract every number from the reply (digits, plus English/Hindi number words for 1 to 60); each must match a facts value (allow ±1 rounding). Any mismatch, empty reply, timeout or API error → return the template sentence instead with `source:"template"`.
   - Cache narrations by `(route_id, language, user_name)`.
3. `/mobile/v1/narrate` endpoint wired to it. `/health` reports `llm_available`.
4. `tests/test_narrate.py`: mock the LLM to return (a) a valid sentence, (b) a sentence with an invented number, (c) a timeout. Expect llm, template, template.

**Sanity checks to report:** 6 real narrations (3 routes × English/Hindi) printed verbatim alongside the facts object they came from; the fallback rate in that run; median latency; which provider and model IDs were used. If both Gemini and OpenRouter keys are available, run the same 6 on each and show them side by side so the owner can choose.

**Report**, then STOP.

---

## 8. Phase M3: App Scaffold & First Run on the Phone

**Goal:** a skeleton Expo app running on the owner's Android phone, talking to the backend.

**Tasks:**
1. `npx create-expo-app@latest mobile --template default@sdk-58` at repo root (sibling of `frontend/`). TypeScript, Expo Router.
2. Install with `npx expo install`: `react-native-maps expo-location expo-speech expo-haptics @react-native-async-storage/async-storage react-native-reanimated react-native-gesture-handler @gorhom/bottom-sheet`; and `npm i @tanstack/react-query zod`.
3. `mobile/src/api/client.ts`: base URL from `EXPO_PUBLIC_API_URL`, overridable at runtime from a hidden developer field in Settings (so a new tunnel URL needs no rebuild). zod schemas mirroring §4.
4. `mobile/src/theme/`: colours, spacing, typography tokens; tier colour + label + icon helper used everywhere.
5. Temporary screen calling `/mobile/v1/health` and showing the result.
6. Document in `mobile/README.md`:
   ```bash
   # terminal 1 (repo root, venv active)
   uvicorn app.api:app --host 0.0.0.0 --port 8000
   # terminal 2
   cloudflared tunnel --url http://localhost:8000     # copy the https://...trycloudflare.com URL
   # terminal 3
   cd mobile
   echo "EXPO_PUBLIC_API_URL=https://<tunnel>.trycloudflare.com" > .env
   npx expo start --tunnel                            # scan QR with Expo Go on the phone
   ```

**Sanity checks to report:** screenshot or description of the health screen on the actual phone; which network was used.

**Report**, then STOP.

---

## 9. Phase M4: Welcome, Setup & Personalisation

**Tasks:**
1. `src/store/profile.ts`: typed profile (`name, home, work, voiceOn, language, caution, recentTrips[≤5], onboarded`) persisted in AsyncStorage, with a version field for future migrations.
2. Welcome screen, 3-step setup (§3), skippable, each step editable later in Settings.
3. Greeting helper (time of day + name) used on Home and passed to `/narrate`.
4. Settings screen: edit everything above, "Test voice" button (speaks a sample line in the chosen language), "Clear my data", About/Limitations text (model AUC 0.638 on 2025–26 test data, the `FLOOD_DELAY_MIN` assumption, data sources, "guide, not a guarantee").
5. If the phone has no Hindi TTS voice (`Speech.getAvailableVoicesAsync()`), say so in Settings and fall back to English.

**Sanity checks:** fresh install → onboarding shown; relaunch → skipped; clear data → onboarding again.

**Report**, then STOP.

---

## 10. Phase M5: Home Map & Hotspots

**Tasks:**
1. Map centred on Gurugram, dark map style JSON, 12 markers from `/hotspots` with text tier labels.
2. Live/Replay chip opening a selector fed by `/scenarios`; replay shows the yellow banner (§2.3).
3. Tap marker → hotspot bottom sheet (§3).
4. Bottom "Where to?" sheet with Home/Work/recent chips and city summary line.
5. Loading skeleton, error state with Retry, empty state when the backend is unreachable that names the problem ("Can't reach RouteRain server").

**Sanity checks:** marker tiers and probabilities on the phone match `/hotspots` JSON for the same scenario (list all 12).

**Report**, then STOP.

---

## 11. Phase M6 & M7: Place Picking, Route Results & Voice

### M6: Pickup and drop selection
1. Place picker screen (§2.2, §3): debounced local search, current location (permission prompt with a plain explanation), long-press on map, saved and recent places, "Search the full map".
2. Swap-origin/destination button; validation message for out-of-coverage points.

**Sanity checks:** search "cyber" returns Cyber Hub within 100 ms; full-map geocode respects 1 req/s (show log timestamps).
**Report**, then STOP.

### M7: Route results and spoken advice
1. Call `/route`, draw both polylines, hotspot circles, legend; fit map to both routes.
2. Comparison card with plain numbers (§3); headline advice; "Why?" reasons visible without tapping.
3. Call `/narrate` in parallel with drawing; when it returns and voice is on, `Speech.speak(text, {language: "en-IN" | "hi-IN"})` once. Replay/Stop buttons. Stop speech when leaving the screen. Small "AI-phrased" / "Standard" tag showing `source`.
4. Haptic tap when a RED hotspot is avoided.
5. Save trip to recent trips.

**Sanity checks to report (on the phone):**
- Replay date with a RED hotspot on the direct path: blue route avoids the buffer, grey passes through it, spoken numbers equal card numbers.
- A trip with no at-risk hotspots: "No detour needed" spoken and shown, routes identical.
- A case where the detour costs more than it is expected to save: the word "save" is not used.
- Backend LLM disabled (unset key): template narration plays, app shows no error.

**Report**, then STOP.

---

## 12. Phase M8: Polish, Accessibility & Demo Safety Net

**Tasks:**
1. Accessibility: `accessibilityLabel` on every marker and button; tier always as text; font scaling up to 1.3× without clipped text; contrast check of tier colours on the dark map.
2. Performance: no frame drops when panning with 12 markers + 2 polylines on a mid-range phone; memoise markers.
3. **Demo pack:** bundle a JSON snapshot of 2 pre-computed replay routes + narrations in the app (`assets/demo/`). A "Demo mode (offline)" switch in developer settings plays these if the network or tunnel fails during the presentation. Clearly labelled "Offline demo" on screen.
4. App icon, splash screen, app name "RouteRain".
5. Stretch (only if owner approves): "Open in Google Maps" with 2–3 waypoints sampled from the flood-aware route; note in-app that Google may still re-route between waypoints.

**Report**, then STOP.

---

## 13. Phase M9: Build the APK & Rehearse

**Tasks:**
1. Google Maps key for the standalone APK: create a Google Cloud project, enable Maps SDK for Android, create an API key restricted to the app's package name and EAS SHA-1 fingerprint. Put it in `app.config.ts` read from `.env` (a literal `process.env...` string inside `app.json` does not work). This step needs the owner's Google account; Claude Code writes the instructions, the owner does it. Check current Google Maps Platform billing terms before enabling.
   - **Fallback if the key is not possible:** keep the demo inside Expo Go (needs the laptop running Metro), or swap the map to a Leaflet page inside `react-native-webview` with OSM-based tiles. Decide with the owner; do not switch silently.
2. `eas.json` with a `preview` profile, `"android": {"buildType": "apk"}`; `eas build -p android --profile preview`; install the APK on the phone.
3. Backend hosting for demo day: the laptop + Cloudflare tunnel. The backend needs over 1 GB of RAM (graph load alone measured ~1.03 GB, peak ~1.1 GB), which rules out typical free cloud tiers. Cloud hosting is out of scope unless the owner chooses a paid instance.
4. Rehearsal checklist in `mobile/DEMO_SCRIPT.md`: start order of the three services, the 2 planned trips, what to say during each screen, the offline-demo switch as Plan B, phone settings (brightness, Do Not Disturb, media volume up, screen mirroring tested).

**Sanity checks:** APK opens with no laptop Metro running; full demo script run end to end twice; cold start to first route time.

**Report** including the final run-through notes and remaining known limits. This is the last phase.

---

## 14. Stretch Ideas (not scheduled)

- Voice input ("Take me to Cyber Hub") via a development build with a native speech-recognition module.
- "Leave at" time picker using the 7-day forecast so users can compare departing now vs in 2 hours.
- Grounded Q&A ("Why is Rajiv Chowk yellow?") using the same facts-only + number-check guard as M2.
- Morning notification on the phone mirroring Phase 10's Telegram alert.

---

## 15. Suggested Repo Additions

```
RouteRain/
├── MOBILE_APP_PLAN.md            # this file
├── app/mobile_api.py             # M1
├── src/route_metrics.py          # M1
├── src/narrate.py                # M2
├── data/raw/places_gurugram.csv  # M0/M1, team-verified
├── tests/                        # M1, M2
└── mobile/                       # M3 onward (Expo app)
    ├── app/                      # Expo Router screens
    ├── src/api, src/store, src/theme, src/components
    ├── assets/demo/              # M8 offline demo pack
    ├── eas.json, app.config.ts   # M9
    ├── README.md
    └── DEMO_SCRIPT.md
```

## 16. How to Use This

1. Do the owner's Colab steps in Phase L0, download the Drive folder, open it in VS Code, and put this file in the root next to `PLAN.md`.
2. Tell Claude Code to start Phase L0 and stop after the L0 Report.
3. Then M0: answer its decisions (flood-delay values, replay dates, place list). Then approve each phase after checking its report and the phone.

Phase order: **L0 → M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9.**