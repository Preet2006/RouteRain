# RouteRain — Progress Summary

**Project:** AI-powered pre-departure waterlogging risk advisory for Gurugram
**Group 6** · Aryan Srivastava, Preet Jhagekar, Laksh Sharda, Mayank Bansal

This file is a single point-in-time snapshot of everything built so far, written from the actual state of the repository. The authoritative phase-by-phase spec is [`PLAN.md`](PLAN.md); this file summarizes what of that plan has actually been executed and where the resulting files live.

---

## 1. What RouteRain is

A dashboard + API that predicts waterlogging risk (GREEN/YELLOW/RED) at 12 known flooding hotspots in Gurugram, explains *why* in plain language, and reroutes a commuter's drive around today's at-risk hotspots. Built from real DEM terrain data, real historical rainfall (Open-Meteo), and manually researched flood news events — not synthetic data.

## 2. Phases completed

All of Phases 1–10 from `PLAN.md` have corresponding files in the repo. Phase 11 (Validation & Responsible AI documentation / `LIMITATIONS.md`) has **not** been produced yet — no `LIMITATIONS.md` file exists in the repo.

| Phase | Goal | Status | Key artifact(s) |
|---|---|---|---|
| 1 | Environment & scaffolding | Done | `requirements.txt`, `config.py`, `.gitignore`, `venv/` |
| 2 | Hotspot list + coordinate verification | Done | `data/raw/hotspots.csv`, `data/raw/hotspots_verification.csv` |
| 3 | Terrain pipeline (SRTM DEM) | Done | `src/build_terrain.py`, `data/processed/terrain_features.csv`, `data/external/dem/gurugram_ncr.tif` |
| 4 | Rainfall pipeline (Open-Meteo) | Done | `src/collect_weather.py`, `data/processed/weather_features.csv`, `data/external/rainfall_raw/*.json` (cached per hotspot-year, 2022–2026) |
| 5 | Label construction | Done | `src/build_labels.py`, `data/raw/flood_events.csv`, `data/processed/flood_labels_clean.csv` |
| 6 | Dataset assembly (the join) | Done | `src/build_dataset.py`, `data/processed/training_data.csv`, `data/raw/infrastructure_issues.csv`, `data/docs/DATA_DICTIONARY.md` |
| 7 | Model training & evaluation | Done | `src/train_model.py`, `src/predict.py`, `models/risk_model.pkl` (+ a `_v1_no_soil_moisture` comparison variant) |
| 8 | Explainability layer | Done | `src/explain.py` |
| 9 | Web app + flood-aware routing | Done | `app/api.py` (FastAPI), `frontend/` (React + TypeScript + Vite), `src/build_road_graph.py`, `src/route_planner.py` |
| 10 | Automation (daily scoring) | Done | `.github/workflows/daily_alert.yml` |
| 11 | Validation & Responsible AI docs | **Not started** | `LIMITATIONS.md` does not exist yet |

## 3. Data pipeline, concretely

- **Hotspots:** 12 verified Gurugram waterlogging locations (`H01`–`H12`) in `data/raw/hotspots.csv`, cross-checked via reverse geocoding (`data/raw/hotspots_verification.csv`).
- **Terrain:** per-hotspot `elevation_m`, `slope_deg`, `sink_depth_m`, `catchment_cells`, derived from a single SRTM DEM tile (`gurugram_ncr.tif`) using a 17-cell-radius window. `slope_deg`/`catchment_cells` are numpy-only approximations — `richdem` failed to build on this (Windows) environment, so the documented fallback from `PLAN.md` was used instead of a true hydrological flow model.
- **Rainfall:** Open-Meteo Archive/Forecast API, hourly precipitation + `soil_moisture_0_to_7cm`, June 1–September 30 for 2022–2026, cached as raw JSON per hotspot-year in `data/external/rainfall_raw/`. Engineered into `rain_24h`, `rain_max_1h`, `rain_max_3h`, `rain_prev_3d`, `soil_moisture_surface`.
- **Labels:** `data/raw/flood_events.csv` (167 manually researched news/social-media events) deduplicated and cleaned into `data/processed/flood_labels_clean.csv`.
- **Final training table:** `data/processed/training_data.csv` — one row per (hotspot, date) where `rain_24h > 10mm`, joined against terrain and labels, plus two engineered features added after the first model run showed terrain alone carried little signal:
  - `rain_season_cumulative` — running seasonal rainfall total per hotspot.
  - `hotspot_flood_rate_prior` — Laplace-smoothed (k=5) historical flood rate per hotspot, computed **only from 2022–2024** to avoid leaking test-period outcomes.
  - `has_infrastructure_issue` — binary flag for hotspots with documented structural drainage defects (5 of 12: H01, H02, H04, H05, H12), from `data/raw/infrastructure_issues.csv`.
- Full column-by-column documentation lives in `data/docs/DATA_DICTIONARY.md`, including known limitations of the table (label under-reporting, gridded-rainfall vs. gauge mismatch, terrain being an approximation, and a documented ~0.008 AUC run-to-run variance explained as hyperparameter-tuning noise, not a bug).

## 4. Model

- **Final model:** `RandomForestClassifier(class_weight="balanced")`, hyperparameter-tuned via a time-aware validation split (train 2022–2023, validate 2024), trained on the full 2022–2024 set, tested on 2025–2026 (year-based split, not random — avoids leakage), probability-calibrated with `CalibratedClassifierCV` (Platt/sigmoid).
- **Test ROC-AUC:** 0.6380 (production pipeline run) / 0.6463 (exploratory run) — both well above the pre-soil-moisture baseline of 0.5873.
- **Alternatives tried and explicitly rejected:** logistic regression (better AUC but physically-backwards coefficient signs under multicollinearity — disqualifying for the explainability requirement), HistGradientBoosting and an RF+HGB soft-vote ensemble (sometimes higher AUC but no native feature importances) — RandomForest was deliberately kept for its interpretability.
- **Risk tiers**, recalibrated from the trained model's actual test-set probability distribution (in `config.py`):
  - `GREEN_MAX = 0.0657` (50th percentile)
  - `YELLOW_MAX = 0.2838` (85th percentile)
- `src/predict.py` supports both a model-based mode and a rule-based fallback mode (for the sparse-label scenario described in `PLAN.md`), gated automatically by positive-class size.

## 5. Explainability

`src/explain.py` generates template-based (non-LLM) plain-language explanations for each score, e.g.:
> *"Hero Honda Chowk — RED. Because 45mm of rain is forecast in a single hour, and this point sits 3.1m below the surrounding road level. It has flooded on 7 of the last 10 comparable rain days."*

Deliberately template-based rather than an LLM call, so explanations are free, instant, deterministic, and can't hallucinate a number.

## 6. Web application

- **Backend:** `app/api.py` — FastAPI, serves the JSON risk/route API and hosts the built frontend (`frontend/dist`) for a single production server.
- **Frontend:** `frontend/` — React + TypeScript + Vite single-page dashboard (replaced an earlier Streamlit-era approach referenced in some docs/dependencies). Dark theme, live tier counts, map markers with explanations, historical flooded-event replay, selectable coordinates shown as lat/lon.
- **Routing (Part B):** `src/build_road_graph.py` downloads and caches Gurugram's drivable OSM road network once (`data/external/road_graph.graphml`, never rebuilt automatically). `src/route_planner.py` computes a normal shortest route and a flood-aware route (RED hotspots penalized ×15 within 500m, YELLOW ×3 within 300m), returning both routes plus which hotspots were avoided and the extra time/distance cost.
- **Safety/design rules honored:** color is never the only risk signal (paired with text like "RED — avoid"), a visible confidence caveat is shown, React's default escaping is relied on for hotspot text, API errors return concise messages, and routing text inputs are length-limited.

## 7. Automation

`.github/workflows/daily_alert.yml` — scheduled GitHub Actions job (06:00 IST daily, plus manual `workflow_dispatch`) that installs dependencies and runs `python src/predict.py --notify`, intended to push a Telegram alert when any hotspot scores YELLOW/RED. Bot token and chat ID are expected to be stored as GitHub Actions secrets, not committed.

## 8. What's not done yet

- **Phase 11** (Validation & Responsible AI documentation) is unstarted: no `LIMITATIONS.md`, no feedback form, no one-page shareable summary for field-interview validation.
- The daily Telegram alert's bot creation / secret configuration is a manual, human step per `PLAN.md` and its completion status isn't verifiable from the repo alone.

## 9. Key files at a glance

```
RouteRain/
├── PLAN.md                        — full phase-by-phase spec (source of truth for scope)
├── README.md                      — run instructions
├── config.py                      — thresholds, paths, risk tier cutoffs
├── data/
│   ├── raw/                       — hotspots, flood_events, infrastructure_issues
│   ├── external/                  — DEM tile, cached rainfall JSON, road_graph.graphml
│   ├── processed/                 — terrain/weather/labels/training_data/risk_predictions
│   └── docs/DATA_DICTIONARY.md
├── src/
│   ├── build_terrain.py, collect_weather.py, build_labels.py, build_dataset.py
│   ├── train_model.py, predict.py, explain.py
│   └── build_road_graph.py, route_planner.py
├── models/risk_model.pkl (+ _v1_no_soil_moisture.pkl comparison model)
├── app/api.py                     — FastAPI backend
├── frontend/                      — React + TypeScript + Vite dashboard
└── .github/workflows/daily_alert.yml
```

---

*Generated from the current repository state on 2026-11-19. Treat `PLAN.md` phase reports (if pasted elsewhere) as the primary record of decisions and sanity checks; this file is a structural summary, not a replacement for them.*
