# RouteRain Web: Phase-Wise Build Plan for Claude Code

**Project:** RouteRain website for the live demo (replaces the earlier Android app plan)
**Group 6** · Aryan Srivastava, Preet Jhagekar, Laksh Sharda, Mayank Bansal
**Builds on:** the GitHub repo plus the local work already committed (R0 review, L0 parts 1 to 3, M0 decisions, M1 model-free backend). `models/risk_model.pkl` has now been obtained and placed in the repo root.
**Replaces:** `MOBILE_APP_PLAN.md`. Keep that file for history, but this is now the plan Claude Code follows.
**Audience:** Claude Code, executing phase by phase, and the project owner, approving each phase.

---

## 0. Rules

1. **One phase at a time.** Each phase ends with a Phase Report in the exact format of `PLAN.md` §1, then STOPS until the owner says "proceed to Phase Wn+1".
2. **Do not retrain or change the model.** The model is used exactly as provided. If it cannot be loaded faithfully (Phase W0), stop and ask.
3. **The backend is the brain.** Scoring, routing and LLM calls run in FastAPI. The browser never sees an API key.
4. **No secret in the frontend bundle.** Anything under `frontend/` ends up readable in the browser. The LLM key (Gemini or OpenRouter) lives only in the backend `.env`.
5. **Never present a replay as live.** A replay shows its date on screen and in the spoken line.
6. **Spoken and displayed numbers come from the backend's computed route data.** The LLM may phrase them, never invent them (enforced in W2).
7. **The existing web endpoints keep working** (`/api/dashboard`, `/api/history`, `/api/route`) until the new frontend no longer uses them. Remove nothing without asking.
8. **Python uses the existing `venv`.** Frontend uses the existing `frontend/` Vite project and its lockfile (Node 22 is already installed).
9. **Fail loudly.** A failed call shows a clear error state, never a blank map or a silently empty route.

---

## 1. What carries over from the mobile work

Already built and committed, reused as is:

| Item | Where | Status |
|---|---|---|
| Faster routing (weight function, no graph copy), per-request penalties, GREEN proximity, no-path snapping, edge-geometry polylines, startup warm-up | `src/route_planner.py` | Done, 16-case regression identical |
| Expected-time maths with a single 23.4-minute flood delay from the severity mix | `src/route_metrics.py`, `config.py` | Done, tested |
| Curated places (65, being verified by the team) and search | `data/raw/places_gurugram_DRAFT.csv`, `data/raw/places_verify/`, `src/places.py` | Done; verification pending |
| Rate-limited, cached Nominatim geocode | `src/route_planner.py` | Done |
| Polyline simplification | `src/polyline.py` | Done |
| Replay dates `2026-08-07, 2026-07-08, 2025-07-31, 2025-07-09` | `config.py` | Decided, not yet scored |
| `/health`, `/places/search`, `/places/geocode`, `/scenarios` | `app/mobile_api.py` | Done, prefix renamed in W1 |
| zod schemas, theme tokens, tier helpers | `mobile/src/api/schemas.ts`, `mobile/src/theme/` | Portable to the web; copied in W3 |

The Expo app in `mobile/` is no longer needed. Phase W1 tags the current commit as `mobile-scaffold-archive` and then removes `mobile/` from the working tree, so it stays recoverable from git.

---

## 2. Stack for the website

| Layer | Choice | Why |
|---|---|---|
| Frontend | Existing `frontend/`: React 18 + TypeScript + Vite, `react-leaflet` maps | Already built and working. Extended, not replaced. |
| Routing (pages) | `react-router-dom` | Welcome, Home, Plan trip, Route result, Settings as real URLs, so the back button works. |
| Data fetching | `@tanstack/react-query` + `zod` | Loading/error/retry states and runtime validation of API responses. |
| Personalisation storage | Browser `localStorage`, wrapped in try/catch | Name, saved places, preferences stay on the user's device. No login. |
| Voice | Browser **Web Speech API** (`window.speechSynthesis`) | Free, built into Chrome and Edge, no server cost. English (`en-IN`) everywhere; Hindi (`hi-IN`) where the browser or OS has a Hindi voice. |
| Location | Browser Geolocation API | "Use my location". Works on `localhost` and HTTPS only, which covers the demo laptop. |
| LLM | Gemini (primary) or OpenRouter, from the backend via the `openai` SDK on an OpenAI-compatible endpoint, set in `.env` | Free tiers available; any failure falls back to `explain.py` templates. |
| Backend | Existing FastAPI `app/api.py` + the new router | Reuses the model, explainer and router. FastAPI also serves the built frontend, so the demo is one command. |

**Browser for the demo:** Chrome or Edge on the laptop. Firefox has weaker speech voices and is not a target.

---

## 3. Honesty rules that still apply

These were decided in the mobile plan and carry over unchanged.

**3.1 Time saved.**
```
expected_time(route) = drive_time(route) + Σ over hotspots h near route: p_h × FLOOD_DELAY_MIN
expected_saving      = expected_time(normal) - expected_time(flood_aware)
```
`FLOOD_DELAY_MIN = 23.4` comes from `FLOOD_SEVERITY_DELAY_MIN = {minor 5, disrupted 20, closed 45}` weighted by the 168 events in `flood_events.csv`. It is an assumption, shown on the About page, and **must not be changed after routes are scored** without the owner's approval. The app says "saves" only when `expected_saving > 0`; otherwise it states the added driving time and what is avoided.

**3.2 Replay.** Reuse `historical_scenarios()`. Hotspots with no row on a replay date (rain under 10 mm) show as grey **"LOW RAIN: not scored"**, count as GREEN for routing, and never get an invented probability. The real `flooded` outcome is shown only as a separate labelled line ("Reported that day: flooded / no report").

**3.3 November.** Live mode will show no rain. The scenario switch defaults to Live but the demo script uses replay dates, labelled as such.

**3.4 Geocoding.** Search-as-you-type only filters the curated list. One Nominatim request per explicit "Search the full map", backend-side, at most 1 per second.

---

## 4. Website experience

```
/welcome (first visit only) ─► /setup (3 short steps, skippable) ─► /  (Home)
                                                                     │
         ┌──────────────────────────────┬────────────────────────────┤
         ▼                              ▼                            ▼
   /plan  (pickup + drop)        hotspot side panel           /settings, /about
         │
         ▼
   /route/:routeId  (map with both routes + comparison + spoken advice)
```

**Welcome:** full-screen hero with the map dimmed behind it, the line "Know before you go: flood-aware routes for Gurugram", and a "Get started" button.

**Setup (editable later in Settings):**
1. Your name.
2. Home and Work (optional, same place picker as `/plan`).
3. Voice on/off, voice language (English / Hindi, Hindi greyed out with a note if the browser has no Hindi voice), and caution level: *Cautious* (avoid RED and YELLOW) or *Balanced* (avoid RED only).

**Home (`/`):**
- Desktop: map on the right two-thirds, a left panel with greeting ("Good evening, Tanish"), Live/Replay selector, forecast timestamp, tier counts, and a large "Where are you going?" box with Home/Work/recent chips.
- Mobile width: map on top, the same panel as a bottom sheet.
- Markers show tier colour **and** a text label. Clicking one opens a side panel with name, tier word, probability band, the `explain.py` sentence, lat/lon, and (in replay) the reported outcome.
- Persistent caveat line: "A guide, not a guarantee."

**Plan trip (`/plan`):** From and To fields with instant curated suggestions, "Use my location", "Pick on map" (click mode with a visible hint), swap button, saved and recent places, "Search the full map" fallback, then "Find routes".

**Route result (`/route/:routeId`):**
- Map: normal route grey dashed, RouteRain route solid blue, hotspot buffers as translucent circles, legend.
- Comparison card: Usual route vs RouteRain route with drive time, distance, at-risk hotspots passed, and expected time including flood risk.
- Headline advice sentence and the "Why" reasons visible without a click.
- Voice plays the advice once (if on), with Play again / Stop.
- Small tag showing whether the sentence is "AI-phrased" or "Standard".

**Design direction:** keep the existing dark dashboard look; one accent colour plus the three tier colours; Inter or the current font; keyboard focus visible; works from 360 px to 1920 px wide.

---

## 5. Phase W0: Load and Verify the Model

**Goal:** the provided `risk_model.pkl` loads faithfully and reproduces the project's reported numbers. Nothing else.

**Tasks:**
1. Move `risk_model.pkl` from the repo root to `models/risk_model.pkl` (gitignored). Back it up: report its size and SHA-256 hash so the owner can store an identical copy on Drive.
2. **Recover the training versions from the pickle itself.** scikit-learn stores the version an estimator was saved with. Load it with warnings captured; if an `InconsistentVersionWarning` appears, read its original version. Also inspect the joblib dict (model, name, feature columns, threshold, calibrated flag) and the model class.
3. If the saved scikit-learn version differs from the venv's 1.9.1: install the saved version into the venv, reload, and confirm the warning is gone. If numpy also fails to unpickle (numpy 1 vs 2 differences), try the matching numpy major version. Report every version tried. Do not leave the venv in a broken state.
4. **Pin** scikit-learn, numpy, pandas, scipy and joblib in `requirements.txt` at the versions that load cleanly.
5. **Check A, reported AUC:** score the 2025 to 2026 rows of `data/processed/training_data.csv` with `predict.py`'s pipeline and compute ROC-AUC against `flooded`. Expect 0.6380. A difference beyond ±0.001 means this is not the production model or the pipeline differs; stop and report.
6. **Check B, stored predictions:** `data/processed/risk_predictions.csv` was produced by the original model from `data/processed/weather_forecast.csv` (dated 2026-10-18). Re-run prediction on that forecast file **offline** (no fresh API call) and compare probabilities to 4 decimal places and tiers exactly, for every row.
7. **Check C, tier cutoffs:** confirm `config.py` still has `GREEN_MAX = 0.0657` and `YELLOW_MAX = 0.2838`, and that recomputing the 50th and 85th percentiles of the test-set probabilities gives the same values.
8. Score the 4 replay dates and report, per date, how many hotspots are RED / YELLOW / GREEN / LOW RAIN, and how many of the reported floods were RED or YELLOW. This confirms which dates make a good demo. Do not change the date list; propose changes only.
9. Smoke test: start the server, call `/api/dashboard`, `/api/history`, and one `/api/route` in replay mode.

**Report** with the version table, the three checks, and the replay-date scoring table. STOP.

---

## 6. Phase W1: Backend API for the Website

**Goal:** a complete, tested JSON API for the new pages, without the LLM.

**Tasks:**
1. Tag the current commit `mobile-scaffold-archive`, then remove `mobile/` in its own commit.
2. Rename `app/mobile_api.py` to `app/web_api.py` and its prefix from `/mobile/v1` to `/api/v2`. Update the tests. `/health` now reports `model_loaded: true`.
3. New endpoints. Every response includes `scenario: {mode, date, forecast_generated_at}`:

| Method & path | Input | Output |
|---|---|---|
| `GET /api/v2/hotspots` | `?mode=live|replay&date=` | 12 items: `id, name, lat, lon, tier` (`RED`/`YELLOW`/`GREEN`/`LOW_RAIN`), `probability` (null for LOW_RAIN), `explanation`, `reported_outcome` (replay only) |
| `POST /api/v2/route` | `{origin:{lat,lon,label}, destination:{lat,lon,label}, caution, mode, date}` | `route_id`, both routes (≤300-point polylines), drive time, distance, hotspots near each with tier and probability, `expected_time` each, `expected_saving_min`, `added_drive_min`, `avoided_hotspots`, `template_advice` |
| `GET /api/v2/route/{route_id}` | | the cached result, so a refresh of `/route/:routeId` works |
| `POST /api/v2/narrate` | `{route_id, user_name?, language}` | `{text, source:"template"}` for now; W2 adds the LLM |

4. Route results cached in memory by `route_id` for `ROUTE_CACHE_TTL_MIN` (30). An expired id returns 404 with "This route has expired, please plan it again."
5. Live mode: forecast fetched through the existing `predict.py --forecast` logic, cached 10 minutes, as `/api/dashboard` does today.
6. Template advice follows §3.1 wording rules exactly, including "No detour needed" when the routes are identical.
7. Tests with FastAPI `TestClient` (httpx approved): every endpoint, a LOW_RAIN hotspot, a replay route with a RED hotspot on the direct path, an identical-routes case, a case where the detour costs more than it saves (no "save" in the text), expired route id, out-of-coverage point, no drivable route.

**Sanity checks to report:** test results; full `/route` summaries for 3 replay trips; response times warm and cold.

**Report**, then STOP.

---

## 7. Phase W2: LLM Narration with Guardrails

**Tasks:**
1. Add `openai` (as an OpenAI-compatible client) to `requirements.txt`. `.env` / `.env.example`:
   ```bash
   LLM_PROVIDER=gemini            # gemini | openrouter | none
   LLM_API_KEY=
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
   LLM_MODEL=                     # current Gemini Flash / Flash-Lite ID from AI Studio
   # OpenRouter:
   # LLM_BASE_URL=https://openrouter.ai/api/v1
   # LLM_MODEL=                   # a :free model ID
   # LLM_FALLBACK_MODELS=         # 2 to 3 more :free IDs, comma-separated
   ```
   No model IDs hardcoded. `LLM_PROVIDER=none` must work (templates only).
2. `src/narrate.py`: build a facts object from the cached route (first name, language, mode/date, drive times, added minutes, expected saving, avoided hotspots with tiers and `explain.py` reasons). System prompt: at most 2 spoken sentences, ≤45 words, name used once, only numbers from the facts, no certainty, say the date in replay, never "save" when saving ≤ 0, natural Devanagari Hindi for `hi`. Temperature 0.3, ~120 output tokens, 4-second timeout, thinking off or minimal.
3. **Number check:** every number in the reply (digits and English/Hindi number words 1 to 60) must match a facts value within ±1. Otherwise, or on timeout or error, return the template with `source:"template"`.
4. Cache by `(route_id, language, user_name)`. Send only the first name and route facts to the provider (free tiers may use prompts to improve products).
5. Tests with a mocked LLM: valid → llm; invented number → template; timeout → template.

**Sanity checks:** 6 real narrations (3 trips × English/Hindi) printed next to their facts, fallback rate, median latency, provider and model used. If both keys exist, show both side by side.

**Report**, then STOP.

---

## 8. Phase W3: Frontend Audit and Foundations

**Goal:** a clean base for the new pages without breaking the current dashboard.

**Tasks:**
1. Audit `frontend/src`: components, how the map, replay and route form work, which `/api/*` calls are made, styling approach. Report it before changing anything structural.
2. Add `react-router-dom`, `@tanstack/react-query`, `zod`. Port `schemas.ts` and the theme/tier helpers from the archived `mobile/` code and adapt to `/api/v2`.
3. App shell with routes from §4. The current dashboard stays reachable at `/legacy` until W5 replaces it, so nothing is lost mid-build.
4. `src/lib/storage.ts`: typed profile (`name, home, work, voiceOn, language, caution, recentTrips ≤5, onboarded, version`) in `localStorage`, wrapped in try/catch, falling back to in-memory if storage throws.
5. `src/lib/speech.ts`: wrapper over `speechSynthesis` that waits for `voiceschanged`, picks an `en-IN` or `hi-IN` voice (falling back to any English voice), exposes `speak`, `stop`, `isSpeaking`, `hasHindi`. Cancel speech on page change.
6. `npm run build` and the FastAPI static mount still serve the site at `/`.

**Report**, then STOP.

---

## 9. Phase W4: Welcome, Setup and Personalisation

1. `/welcome`, `/setup` (3 steps, skippable), redirect logic based on `onboarded`.
2. Greeting helper (time of day + name).
3. `/settings`: edit all profile fields, "Test voice" in the chosen language, "Clear my data".
4. `/about`: what RouteRain does, model test ROC-AUC 0.638 on 2025 to 2026 data, the 23.4-minute flood-delay assumption and how it was derived, data sources, "a guide, not a guarantee".
5. Hindi option disabled with an explanation when `hasHindi` is false.

**Sanity checks:** fresh browser → welcome; after setup → home on reload; clear data → welcome again; private window works (storage may be blocked or empty).

**Report**, then STOP.

---

## 10. Phase W5: Home Map and Hotspots

1. Home layout per §4 (desktop panel + mobile bottom sheet).
2. Markers from `/api/v2/hotspots`, text labels on every marker, grey LOW RAIN markers.
3. Live/Replay selector from `/api/v2/scenarios`, replay banner with the date.
4. Hotspot side panel.
5. Loading skeletons; error state with Retry; "Can't reach RouteRain server" state.
6. Retire `/legacy` once the owner confirms nothing from it is missing (ask; do not delete unasked).

**Sanity checks:** all 12 markers match the API for one live and two replay scenarios (table).

**Report**, then STOP.

---

## 11. Phase W6: Pickup and Drop Selection

1. `/plan` per §4: debounced curated search, geolocation with a plain permission message, click-on-map mode, swap, saved and recent places, full-map search.
2. Out-of-coverage and no-route messages from the API shown inline.
3. Keyboard: arrow keys and Enter in the suggestion list.

**Sanity checks:** "cyber" shows Cyber Hub instantly; full-map search obeys 1 req/s (log timestamps); clicking outside Gurugram gives the coverage message.

**Report**, then STOP.

---

## 12. Phase W7: Route Result and Spoken Advice

1. `/route/:routeId` per §4, loading the cached route (refresh-safe until the 30-minute expiry).
2. Fit map to both routes; legend; buffers.
3. Request `/api/v2/narrate` in parallel. Chrome only allows speech after the user has interacted with the page, so the "Find routes" click counts; if speaking is blocked anyway, show a "Play advice" button instead of failing silently.
4. Play again / Stop; stop on leaving the page; "AI-phrased" / "Standard" tag.
5. Save to recent trips.

**Sanity checks (in Chrome on the laptop):**
- Replay with RED on the direct path: blue route avoids the buffer; spoken numbers equal card numbers.
- Trip with no at-risk hotspots: "No detour needed" spoken and shown.
- Detour costing more than it saves: the word "save" never appears.
- `LLM_PROVIDER=none`: template plays, no error shown.

**Report**, then STOP.

---

## 13. Phase W8: Polish, Accessibility and Demo Safety Net

1. Accessibility: labels on all controls and markers; tier always in text; contrast check of tier colours on the dark map; full keyboard path from Home to a spoken route.
2. Responsive check at 360, 768, 1366 and 1920 px.
3. **Offline demo pack:** 2 precomputed replay routes with narrations bundled as JSON. A "Demo mode (offline)" switch in Settings plays them if the internet fails during the presentation, labelled "Offline demo" on screen.
4. Favicon, page titles, a short shareable summary card on the route page (useful for PLAN.md Phase 11's field-interview printout).

**Report**, then STOP.

---

## 14. Phase W9: Demo Build and Rehearsal

1. One command to run the demo: build the frontend, then `uvicorn app.api:app --host 0.0.0.0 --port 8000`, with warm-up. Document it in `README.md`.
2. Optional: open the site on a phone through the laptop's IP on the phone's hotspot (same steps as the earlier mobile test). Note that "Use my location" does not work over plain `http://` to an IP; on the phone, use typed places instead.
3. `DEMO_SCRIPT.md`: start order, 2 planned trips with replay dates, what to say on each screen, the offline switch as Plan B, laptop prep (close heavy apps, the backend needs ~1.5 GB RAM; volume up; Chrome zoom for the projector).
4. Run the script end to end twice; report timings from cold start to first spoken route.

**Report.** After this, return to `PLAN.md` Phase 11 (`LIMITATIONS.md`, feedback form), which is still not done.

---

## 15. Open Items Carried Forward

- Team verification of the 53 places in `data/raw/places_verify/` (rows not checked stay out of the site).
- `PROGRESS.md` corrections: Phase 10 is not done (`daily_alert.yml` is empty, no `--notify`), calibration is a manual Platt step, events are 168 not 167.
- The old User-Agent email remains in git history at commit `d0ec5f4`.
- Local commits are not pushed. Push to a `web-app` branch once W0 passes.

## 16. How to Use This

1. Put this file in the repo root next to `PLAN.md`.
2. Tell Claude Code to start Phase W0 and stop after the W0 Report.
3. Phase order: **W0 → W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8 → W9**, then `PLAN.md` Phase 11.