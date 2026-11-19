# RouteRain — Phase-Wise Build Plan for Claude Code

**Project:** AI-powered pre-departure waterlogging risk advisory, Gurugram
**Group 6** · Aryan Srivastava, Preet Jhagekar, Laksh Sharda, Mayank Bansal
**Audience for this document:** Claude Code, executing autonomously, phase by phase
**Audience for the Phase Reports this document demands:** the project owner, verifying each phase by hand before approving the next

**This is a single, self-contained document.** Every formula, code snippet, and threshold referenced by any phase is inlined directly in that phase's section below — there is no second file to read.

---

## 0. Rules Claude Code Must Follow for the Whole Project

1. **Python environment:** every phase that runs Python MUST use a project-local virtual environment, never the system Python.
   ```bash
   python3 -m venv venv
   source venv/bin/activate        # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
   The venv is created once in Phase 1 and reused for every later phase. Every command in every phase assumes `venv` is already activated. If a new shell session starts, reactivate it first — do not reinstall into system Python.

2. **One phase at a time.** Do not start Phase N+1 until explicitly told to. Each phase ends with a mandatory **Phase Report** (format specified in §1 below) and then STOPS. The project owner reviews the report, verifies the actual files/output, and only then says "proceed to Phase N+1."

3. **Never fabricate data.** If a step needs the project owner's input (manual label collection, a coordinate decision, a go/no-go call), stop and ask — do not invent placeholder rows and present them as real.

4. **Every script must be runnable standalone**, with a `--help` or docstring explaining what it does, what it reads, and what it writes. No notebook-only logic that can't be reproduced.

5. **Fail loudly, not silently.** If an API call fails, a file is missing, or a sanity check fails (e.g. class balance way off), the script must print a clear error and stop — never continue with corrupted or empty data silently.

6. **Every phase's report must be copy-pasteable** into a chat message so the project owner can hand it to someone else (e.g. back to this conversation) for independent cross-verification.

---

## 1. Mandatory Phase Report Format

At the end of **every** phase, before stopping, Claude Code must output a report in exactly this structure:

```markdown
## Phase [N] Report — [Phase Name]

### What was done
- [bullet list of concrete actions taken, in the order performed]

### Files created / modified
- `path/to/file` — [one-line description of contents]
- ...

### Commands run (copy-pasteable)
```bash
[exact commands, in order, that reproduce this phase from a clean checkout]
```

### Key outputs / numbers
- [any counts, metrics, sample rows, or statistics produced this phase —
   e.g. "47 rows in flood_events.csv", "ROC-AUC: 0.81", "class balance: 22% positive"]

### Sanity checks performed
- [what was verified, and the result — e.g. "Hero Honda Chowk has the
   highest sink_depth_m among all hotspots: PASS"]

### Known issues / things to verify manually
- [anything uncertain, approximate, or that needs the project owner's
   judgment — e.g. "3 flood events matched within ±1 day tolerance,
   verify these aren't false matches"]

### Ready for next phase?
[YES / NO — if NO, state exactly what is blocking]
```

This report is what gets pasted back for cross-verification. It must be honest about gaps — a report that hides a failed sanity check defeats the entire point of phase gating.

---

## 2. Project Structure (target state, built incrementally across phases)

```
routerain/
├── PLAN.md                        # this file — the only plan document
├── requirements.txt
├── venv/                          # local virtual environment, gitignored
├── .gitignore
├── config.py                      # hotspot list, thresholds, file paths, constants
├── data/
│   ├── raw/
│   │   ├── hotspots.csv           # manually curated, coordinate-verified
│   │   ├── flood_events.csv       # manually collected ground truth labels
│   │   └── source_log.csv         # who collected what, when, confidence
│   ├── external/
│   │   ├── rainfall_raw/          # untouched API pulls, one file per hotspot-year
│   │   └── dem/
│   │       └── gurugram_ncr.tif   # SRTM elevation tile
│   ├── processed/
│   │   ├── terrain_features.csv
│   │   ├── weather_features.csv
│   │   └── training_data.csv      # final joined table, model-ready
│   └── docs/
│       └── DATA_DICTIONARY.md
├── src/
│   ├── verify_hotspots.py         # Phase 2
│   ├── build_terrain.py           # Phase 3
│   ├── collect_weather.py         # Phase 4
│   ├── build_labels.py            # Phase 5
│   ├── build_dataset.py           # Phase 6
│   ├── train_model.py             # Phase 7
│   ├── predict.py                 # Phase 7 / 9 / 10
│   └── explain.py                 # Phase 8
├── app/
│   ├── api.py                     # FastAPI JSON API and frontend host
│   └── (React app in ../frontend) # Phase 9 dashboard
├── models/
│   └── risk_model.pkl             # Phase 7
└── .github/workflows/
    └── daily_alert.yml            # Phase 10
```

---

## 3. Phase 1 — Environment & Project Scaffolding

**Goal:** a working Python environment and a clean project skeleton. No data logic yet.

**Tasks:**
1. Create `venv` in the project root. Activate it.
2. Create `requirements.txt`:
   ```
   pandas
   numpy
   scikit-learn
   requests
   rasterio
   richdem
   elevation
   matplotlib
   joblib
   python-dotenv
   osmnx
   networkx
   geopy
   ```
   `osmnx` and `networkx` are added for Phase 9's flood-aware routing (road network graph + shortest-path routing) — not needed before then, but listed here so the environment doesn't need revisiting mid-project. `geopy` is used for geocoding user-entered origin/destination addresses in the routing UI. Phase 9's React/TypeScript frontend dependencies live in `frontend/package.json`; FastAPI and Uvicorn host its API. If Phase 1 already ran before these backend packages were added, install the current `requirements.txt` into the existing venv.
   `pip install -r requirements.txt` inside the venv. If `richdem` fails to build (common on some platforms, especially Windows with no prebuilt wheel), note it in the report and continue — Phase 3 below has a NumPy-only fallback for the slope feature that would have used it. Do not let a richdem failure block the rest of Phase 1.
3. Create the folder structure from §2 (empty files where content doesn't exist yet).
4. Create `.gitignore` covering `venv/`, `__pycache__/`, `*.pkl`, `.env`, `data/external/rainfall_raw/*.json` (raw API caches, large and regenerable).
5. Create `config.py` with: `HOTSPOTS_CSV`, `FLOOD_EVENTS_CSV`, `DEM_PATH`, `PROCESSED_DIR`, `RAIN_THRESHOLD_MM = 10`, `TERRAIN_RADIUS_CELLS = 17`, `DATE_MATCH_TOLERANCE_DAYS = 1`, and the risk-tier thresholds `GREEN_MAX = 0.30`, `YELLOW_MAX = 0.60` (used in Phase 7, defined once here so every later script imports the same values rather than hardcoding them separately).
6. Create empty placeholder files `data/raw/hotspots.csv` (header only: `hotspot_id,name,lat,lon,type,notes`) and `data/raw/flood_events.csv` (header only: `hotspot_id,date,severity,duration_hours,source_url,notes`). These get populated in Phase 2 and by manual team collection respectively — nothing exists yet, and Phase 1 should not invent rows.

**Produce the Phase 1 Report** per §1, then stop.

---

## 4. Phase 2 — Hotspot List Creation & Coordinate Verification

**Goal:** build `data/raw/hotspots.csv` from nothing into a locked, verified list of 12 hotspots. Nothing downstream should change this list again.

**Starting state:** `hotspots.csv` has a header row only. No hotspots are defined yet. This phase both proposes the list AND verifies it — it is not just a verification pass.

**Tasks:**

1. **Propose the candidate list, in two tiers:**
   - **Tier A — known, independently documented in prior research for this project** (use these as the anchor set, they are not invented):
     - Bilaspur Chowk, NH-48 Delhi–Jaipur highway, Gurugram — chronic waterlogging tied to stalled flyover construction (approved 2015, foundation laid 2022) and a chronically choked drain (reported as recently as Dec 2025). This is the project's grounding case.
     - Rajiv Chowk — recurring underpass closures during heavy rain.
     - Hero Honda Chowk — named a "hypercritical"/high-priority location in municipal waterlogging surveys.
     - Narsingpur — low-lying NH-48 stretch.
     - IFFCO Chowk — high-traffic intersection with reported waterlogging.
   - **Tier B — fill the remaining ~7 slots using named locations from municipal (MCG/GMDA) waterlogging hotspot surveys/press coverage.** Select 7 named locations that:
     - appear in at least one independent news source (not just a survey mention alone), so later label collection in Phase 5 has somewhere to actually find events, and
     - are not duplicates or sub-parts of a Tier A location already on the list.
   - If 7 suitably documented Tier B locations cannot be found with real citations, **do not pad the list with invented or unverifiable locations** — report the shortfall honestly and ask the project owner whether to proceed with fewer than 12, or help source the remainder.
   - If a published hotspot-count figure (e.g. "X locations surveyed, Y hypercritical") cannot be matched to a verifiable source, use the closest verifiable figure you can actually cite instead, and note the discrepancy in the report. Do not block on this — it's a sourcing footnote, not a blocker.

2. **Get coordinates for every proposed hotspot.** For each one, look up its approximate lat/lon via a free geocoding service (e.g. OpenStreetMap Nominatim — one request per second, proper User-Agent header, respecting usage policy). Write the result into `data/raw/hotspots.csv` with columns `hotspot_id, name, lat, lon, type, notes` — `notes` should carry a one-line citation of why this location was selected.

3. **Reverse-geocode to sanity-check each coordinate** (a second, independent check beyond the forward lookup in step 2): resolve each lat/lon back to an address and flag any hotspot whose resolved address doesn't plausibly match its `name` as `NEEDS_MANUAL_CHECK`.

4. **Do not auto-correct a flagged coordinate.** Stop and ask the project owner to confirm or correct it — this is a judgment call, not something to guess, since a coordinate 100–200m off silently corrupts every terrain feature computed in Phase 3.

5. **Expect that some informal local names (colloquial chowk/village names) will not be indexed in OpenStreetMap at all.** If forward-geocoding returns nothing after several query variants, do not keep retrying indefinitely or guess a coordinate — report it as unresolved and ask the project owner to supply a coordinate manually (read directly off a Google Maps pin). A manually-supplied coordinate should be marked `MANUALLY_VERIFIED` in the verification table, not run back through reverse-geocoding (which will just reproduce the same false-negative pattern that caused the manual lookup to be needed).

6. Produce a final verification table: `hotspot_id, name, lat, lon, type, notes, resolved_address, flag`.

**Produce the Phase 2 Report**, including:
- the full proposed list with citations for every Tier B pick,
- the full verification table,
- an honest statement of how many hotspots were confidently sourced vs. how many are uncertain,

then stop. The project owner should treat this report as the moment to personally spot-check a few of these locations on a map before approving Phase 3 — once terrain features are computed on these coordinates, fixing a bad one means redoing Phase 3.

---

## 5. Phase 3 — Terrain Pipeline (SRTM DEM → terrain features)

**Goal:** `data/processed/terrain_features.csv` — one row per verified hotspot.

**What this phase computes and why:**

| Feature | Meaning | Why it predicts flooding |
|---|---|---|
| `elevation_m` | Height above sea level | Baseline position |
| `slope_deg` | Steepness of the surrounding ground | Steep = water runs off; flat = water sits |
| `sink_depth_m` | How far *below* the mean of a ~500m radius this point sits | **The strongest signal.** A point sitting below everything around it receives drainage from the whole area and has nowhere to send it — this is why underpasses flood first. |
| `catchment_cells` | Count of nearby cells that are higher than this point | Proxy for how much water drains toward this point |

**Tasks:**

1. Download a single SRTM tile covering all 12 hotspot coordinates (bounding box derived automatically from the min/max lat/lon in `hotspots.csv`, plus a ~0.05° buffer) to `data/external/dem/gurugram_ncr.tif`. Use the `elevation` package's `eio clip` CLI:
   ```bash
   eio clip -o data/external/dem/gurugram_ncr.tif --bounds <min_lon> <min_lat> <max_lon> <max_lat>
   ```
   If the CLI fails in this environment, document the manual EarthExplorer fallback instead of silently skipping this step.

2. Write `src/build_terrain.py` implementing this exact logic:
   ```python
   # src/build_terrain.py — core logic
   import rasterio, numpy as np, pandas as pd
   from rasterio.transform import rowcol

   RADIUS_CELLS = 17   # ~500m at 30m resolution (config.TERRAIN_RADIUS_CELLS)

   dem = rasterio.open("data/external/dem/gurugram_ncr.tif")
   band = dem.read(1).astype(float)
   band[band == dem.nodata] = np.nan

   rows = []
   for h in pd.read_csv("data/raw/hotspots.csv").itertuples():
       r, c = rowcol(dem.transform, h.lon, h.lat)
       win = band[max(0, r-RADIUS_CELLS):r+RADIUS_CELLS,
                  max(0, c-RADIUS_CELLS):c+RADIUS_CELLS]
       elev = band[r, c]
       rows.append({
           "hotspot_id":   h.hotspot_id,
           "elevation_m":  elev,
           "sink_depth_m": np.nanmean(win) - elev,          # positive = sits in a bowl
           "slope_deg":    np.degrees(np.arctan(np.nanstd(win) / 30.0)),
           "catchment_cells": int(np.nansum(win > elev)),
       })

   pd.DataFrame(rows).to_csv("data/processed/terrain_features.csv", index=False)
   ```
   If `richdem` is unavailable (per the Phase 1 install failure), the `np.gradient`/`np.arctan(np.nanstd(...))` approach above is the documented fallback already — no richdem call is actually required by this logic, so this should work regardless of whether richdem installed.

3. **Mandatory sanity check, must be run and reported:** confirm that Hero Honda Chowk and Bilaspur Chowk (the two most-documented chronic flooders in this project's research) have `sink_depth_m` values in the top half of all 12 hotspots. If they don't, flag this prominently — it likely means a coordinate problem from Phase 2, not a terrain pipeline bug. Do not proceed to Phase 4 silently if this check fails; stop and report it.

**Produce the Phase 3 Report**, including the full terrain feature table (all 12 rows) and the sanity check result, then stop.

---

## 6. Phase 4 — Rainfall Pipeline (Open-Meteo → weather features)

**Goal:** `data/processed/weather_features.csv` — hotspot × date rainfall + soil moisture features, covering monsoon months (June–September) 2022–2026.

**What this phase computes and why:**

| Feature | Definition | Why it matters |
|---|---|---|
| `rain_24h` | Total precipitation, mm, over the day | Baseline volume |
| `rain_max_1h` | Peak hourly intensity | **Intensity matters more than total** — 40mm in one hour floods a road; 40mm spread over a day drains away |
| `rain_max_3h` | Peak 3-hour rolling total | Captures sustained bursts |
| `rain_prev_3d` | Trailing 3-day rainfall, shifted by 1 day so it excludes the current day | Antecedent rainfall — already-saturated ground floods faster |
| `soil_moisture_surface` | Same-day mean of `soil_moisture_0_to_7cm` (ERA5-Land reanalysis), fetched from the same Open-Meteo Archive/Forecast API call as precipitation — no new key, no extra request, same caching discipline | A **direct ground-saturation measurement**, not just a rainfall-as-proxy signal. Added post-Phase-7, after an exploratory round found it ranked ~2nd in RandomForest feature importance and lifted test ROC-AUC by +0.059 — outside this project's established ~0.02-0.03 run-to-run noise margin. Confirmed available for the full 7-day forecast horizon (not just the archive) before adoption |

**Note on the date window** (corrected — an earlier version of this section called for March 1 – November 30 to capture off-season flood events found in research; that widening was tried, found to add training-period negatives but zero new positives, diluted the training signal, and was reverted. The window is **June 1 – September 30**, as implemented.)

**Tasks:**

1. Write `src/collect_weather.py` implementing this core logic:
   ```python
   # src/collect_weather.py — core call
   import requests, pandas as pd, time

   def fetch(lat, lon, start, end):
       r = requests.get("https://archive-api.open-meteo.com/v1/archive", params={
           "latitude": lat, "longitude": lon,
           "start_date": start, "end_date": end,
           "hourly": "precipitation",
           "timezone": "Asia/Kolkata",
       }, timeout=60)
       r.raise_for_status()
       h = r.json()["hourly"]
       df = pd.DataFrame({"ts": pd.to_datetime(h["time"]), "precip": h["precipitation"]})
       df["date"] = df.ts.dt.date
       daily = df.groupby("date").agg(
           rain_24h=("precip", "sum"),
           rain_max_1h=("precip", "max"),
       ).reset_index()
       daily["rain_max_3h"]  = df.set_index("ts").precip.rolling("3h").sum() \
                                 .groupby(df.set_index("ts").index.date).max().values
       daily["rain_prev_3d"] = daily.rain_24h.rolling(3).sum().shift(1).fillna(0)
       return daily
   ```
   - Call this for each hotspot, for each year 2022–2026, requesting **June 1 – September 30** (a wider March 1 – November 30 window was tried and reverted — see note above). Request `hourly=precipitation,soil_moisture_0_to_7cm` in the same call (soil moisture added post-Phase-7, see note above).
   - Open-Meteo needs no API key, but be polite: a short `time.sleep(1)` between calls, retry once on transient failure, and a clear error if a call fails twice.
   - Cache each hotspot-year's raw API response to `data/external/rainfall_raw/` before processing, so reprocessing doesn't require re-fetching.

2. Also implement a `--forecast` mode in the same script (or a small separate function) that hits the Forecast API (`api.open-meteo.com/v1/forecast`) for the next 7 days, same parameters style as above. This isn't used for training, but Phase 9 (the live demo) needs it, so build and test it now while the API logic is fresh.

3. Write `data/processed/weather_features.csv`: one row per `(hotspot_id, date)` where `rain_24h > 0`.

**Mandatory sanity check:** report the number of distinct rainy days captured per hotspot, and the max single-day rainfall observed across the dataset (as a plausibility check — if the max is absurdly high or zero across the board, something is wrong with the API call or units).

**Produce the Phase 4 Report**, then stop.

---

## 7. Phase 5 — Label Construction (flood_events.csv → binary labels)

**Goal:** turn the manually collected `flood_events.csv` into a clean, de-duplicated, decision-documented label source, ready to be joined against rainy days in Phase 6.

**How the team should have been collecting labels** (for context — not something Claude Code does, but useful to understand what's in the file):

| Source | How |
|---|---|
| News archives | Date-filtered search, e.g. `"[hotspot name]" "waterlogging" site:tribuneindia.com`, repeated per year 2022–2026, across multiple outlets |
| Gurugram Traffic Police (X/Twitter) | Search for "underpass", "waterlogging", "diverted" during Jun–Sep of each year — timestamped and specific |
| MCG / GMDA statements | Pre-monsoon and post-monsoon press releases listing hotspots and remedial work |

Target: 60–120+ event rows spanning 2022–2026 across all 12 hotspots.

> **Before this phase starts:** the project owner must confirm `flood_events.csv` has reached a reasonable size via manual team collection, as planned separately. Claude Code should NOT attempt to generate flood events itself — this data does not exist anywhere to scrape and must come from the team's news/social-media research. If the file is too small when this phase starts, say so plainly in the report and ask whether to proceed anyway (useful for an early dry run) or wait.

**Tasks:**

1. Write `src/build_labels.py`:
   - Load `flood_events.csv`.
   - **De-duplicate:** collapse rows with the same `hotspot_id` and `date` within `config.DATE_MATCH_TOLERANCE_DAYS` (±1 day) into a single event, keeping the highest reported severity and concatenating all `source_url`s into one field.
   - **Severity decision:** treat severity 1–3 (1 = minor pooling, 2 = traffic disrupted, 3 = road closed) all as `flooded = 1` for the primary label, but retain the original `severity` as a separate column so it can be used as a feature or for sensitivity analysis later.
   - Output `data/processed/flood_labels_clean.csv`: `hotspot_id, date, flooded=1, severity, duration_hours, sources (semicolon-joined)`.

2. Report the before/after row count (raw events → deduplicated events) and list every collapsed duplicate explicitly, so the project owner can confirm none of the merges were wrong.

**Produce the Phase 5 Report**, including the full deduplicated label table, then stop.

---

## 8. Phase 6 — Dataset Assembly (the join: rainfall + terrain + labels)

**Goal:** `data/processed/training_data.csv` — the single file the model will train on.

**The join logic:**

1. Start with every (hotspot, date) pair from `weather_features.csv` where `rain_24h > config.RAIN_THRESHOLD_MM` (10mm) — no-rain days teach the model nothing, this is the full candidate set.
2. Left-join `terrain_features.csv` on `hotspot_id`.
3. Left-join `flood_labels_clean.csv` on `(hotspot_id, date)`, matching within `DATE_MATCH_TOLERANCE_DAYS`. Where no match exists, set `flooded = 0`. **This step is where negative examples get created** — a rainy day at a hotspot with no recorded flood is a genuine negative, and the model needs these to learn the threshold between "rained" and "flooded."
4. Add a `month` feature extracted from `date`.
5. Write to `data/processed/training_data.csv`.

**Final schema:**
```
hotspot_id, date, rain_24h, rain_max_1h, rain_max_3h, rain_prev_3d,
soil_moisture_surface, rain_season_cumulative, hotspot_flood_rate_prior,
has_infrastructure_issue, elevation_m, slope_deg, sink_depth_m,
catchment_cells, month, flooded
```

**`soil_moisture_surface`** rides along as a plain column from `weather_features.csv` (Phase 4) — no separate join needed, since it's fetched in the same Open-Meteo call as precipitation. Added to this permanent schema after a Phase 7 exploratory round: it ranked ~2nd in RandomForest feature importance and lifted test ROC-AUC by +0.059, well outside this project's ~0.02-0.03 run-to-run noise margin, and is a genuinely different signal (direct ground saturation) than the rainfall-as-proxy features already present.

**Third engineered feature — `has_infrastructure_issue` (added to directly test a confirmed hypothesis: Phase 3/7 both found that terrain alone fails to explain hotspots like Bilaspur Chowk, whose flooding is caused by a blocked drain and stalled construction, not topography):**

A binary flag per hotspot, sourced from `data/raw/infrastructure_issues.csv` (already created — a 12-row reference table with `hotspot_id, has_infrastructure_issue, evidence_date, evidence_note, source_url`). This was derived by scanning the existing 167-row `flood_events.csv` for notes describing a *specific, structural* infrastructure defect (a choked/uncleaned drain, a cave-in, a sinkhole, a pump equipment failure) — deliberately excluding generic "pumps were deployed" mentions, since that's routine citywide flood response and not hotspot-specific evidence. Only 5 of 12 hotspots (H01, H02, H04, H05, H12) have real, specific evidence and are flagged 1; the other 7 are flagged 0. Left-join this file onto `training_data.csv` by `hotspot_id` — it's a static per-hotspot value, same for every row of that hotspot (not leakage-sensitive the way `hotspot_flood_rate_prior` is, since it isn't derived from flood outcomes at all, just independent infrastructure-condition reporting).

Report its feature importance alongside the others, and be honest in the write-up: since it's static per hotspot like terrain, it may show the same limited-signal pattern terrain did (only a few distinct values across hundreds of rows) — this is a worthwhile test of a specific hypothesis either way, not a guaranteed win.

**Two additional engineered features (added after the first Phase 7 run showed terrain features carry very little signal — these give the model a better way to capture "this specific hotspot is chronically bad" and "the ground is already saturated this season" than raw terrain alone provides):**

- **`rain_season_cumulative`** — total `rain_24h` for that hotspot, summed from June 1 of that date's year up to and including the current date. Captures whole-season ground saturation, not just the trailing 3 days already covered by `rain_prev_3d`. This can be computed directly from `weather_features.csv` (which only contains rain_24h>0 days — that's fine, since zero-rain days contribute 0 to the sum anyway) by summing `rain_24h` per hotspot for all rows with date between that year's June 1 and the current row's date, inclusive.

- **`hotspot_flood_rate_prior`** — a smoothed, **leakage-safe** historical flood rate per hotspot. Compute this using ONLY 2022-2024 (training-period) rows: for each hotspot, `(flooded_count_in_training + k * global_training_flood_rate) / (candidate_days_in_training + k)`, using Laplace/Bayesian smoothing with `k=5` so hotspots with very few events (H06, H12) don't get an unstably extreme value. **Critical: compute this once per hotspot from training data only, then apply that same fixed value to every row for that hotspot in BOTH the training and test sets.** Do not recompute it per-row or let it see 2025-2026 data — that would leak the test set's own outcome into a feature, which is a serious methodology error, not a minor one. Flag this explicitly in the report as a leakage check: confirm this feature's value for each hotspot is identical across all that hotspot's rows regardless of year.

**Tasks:**

1. Write `src/build_dataset.py` implementing the join logic above, including the two new engineered features.

2. **Mandatory sanity checks, all must be reported:**
   - Total row count.
   - **Class balance (% positive).** Expected: roughly 15–30%. Flag clearly if outside the 10–40% range: if above 60% positive, the rainfall threshold is likely too high and negatives are being missed; if below 5%, label collection likely missed events or the threshold is too strict.
   - Confirm every positive-labeled row actually has a `source_url` traceable back through the join (i.e. no label got attached without provenance).
   - Confirm no hotspot has zero rows (would mean its rainfall pull silently failed).

3. Write `data/docs/DATA_DICTIONARY.md` documenting every column in `training_data.csv`: name, meaning, unit, source, and whether it's a feature or the target.

**Produce the Phase 6 Report**, including the full sanity-check results and a 10-row sample of the final table, then stop. **This is the most important phase gate in the whole project** — nothing past this point is trustworthy if this table is wrong.

---

## 9. Phase 7 — Model Training & Evaluation

**Goal:** a trained, evaluated, saved model — or a documented decision to use the rule-based fallback instead.

**Model choice (final): `RandomForestClassifier(class_weight="balanced")` trained on the full feature set including `soil_moisture_surface`, calibrated. Test ROC-AUC 0.6463 (exploratory run) / 0.6380 (regenerated through the production pipeline — a small, explained discrepancy from RandomForest's hyperparameter tuning being sensitive to feature-column order under a fixed random seed; both numbers clear the pre-soil-moisture baseline of 0.5873 by well outside the noise margin).** Chosen deliberately over a neural network — it works on small tabular datasets (a few hundred rows, not millions), gives feature importances for free (which doubles as the explainability layer's evidence), and trains in seconds.

**Candidates tried and rejected (exploratory rounds after the first tuned run):**
- **Logistic regression** (untuned and tuned, with and without soil moisture) scored competitively or better on raw test AUC (0.6523 untuned, best overall), but its coefficients showed **backwards signs under multicollinearity** (e.g. `rain_max_3h` and `rain_season_cumulative` negative, `sink_depth_m` negative) — meaning more rain or a deeper sink predicted *lower* risk, which makes no physical sense. This disqualifies it as an honest explanation basis for Phase 8, regardless of its numeric edge.
- **HistGradientBoosting** and a **soft-vote RF+HGB ensemble** both outperformed RandomForest on some reruns (an automatic noise-margin selection rule would have picked HGB in the final pipeline run, AUC 0.6702 vs RF's 0.6380), but neither has RandomForest's native per-split feature importances — HGB would need permutation importance bolted on, and the ensemble has no single importance vector at all. RandomForest was force-selected for the final deployment specifically to preserve this interpretability property, per the project owner's explicit decision.

**Hyperparameter tuning (added after the first run used only default settings):** tune `n_estimators`, `max_depth`, `min_samples_leaf`, and `min_samples_split` using a **time-aware validation split within the training period only** — e.g. train on 2022-2023, validate on 2024, never a random/k-fold split (that would reintroduce the exact date-leakage problem year-splitting was meant to avoid). Score candidates by recall-weighted metrics (e.g. F2 or recall at a fixed reasonable precision floor), consistent with the project's stated priority. After selecting the best hyperparameters on the 2022-2023/2024 validation split, refit on the FULL 2022-2024 training set with those settings before evaluating on the untouched 2025-2026 test set, exactly as before.

**Model comparison (added for rigor):** also train a `HistGradientBoostingClassifier` (or `GradientBoostingClassifier`) with `class_weight`/`sample_weight` balancing, using the same time-aware tuning approach. Compare its validation performance against the tuned RandomForest. Report both models' results — do not silently discard the comparison.

**Ensemble (added as a third candidate, not a replacement for the comparison above):** also evaluate a simple soft-vote ensemble — the average of the tuned RandomForest's and tuned HistGradientBoosting's predicted probabilities — on the same held-out test set. Since the two models were nearly tied in the first comparison (AUC 0.593 vs 0.601), an average of both may pick up complementary signal either model misses alone. Compare all three (RF, HGB, ensemble) on the test set and pick whichever genuinely performs best; if the ensemble wins, note that Phase 8's explainability layer will need feature importances from the RandomForest component specifically (the ensemble itself has no single importance vector), and use those as the explanation basis regardless of which model's probability is actually shown to the user.

**Probability calibration (added so predicted probabilities are honestly interpretable as percentages, not just useful for ranking):** after selecting the final model (RF, HGB, or the ensemble), apply `CalibratedClassifierCV` (Platt/sigmoid method is fine for a small dataset; avoid isotonic, which needs more data than you have) fit on the training period only, evaluated on the test set. Report reliability before and after calibration (e.g. compare predicted-probability deciles against actual observed flood rates in each decile) — calibration should make a "70% probability" closer to an honest 70%, which matters directly for Phase 8's explanation sentences that will cite these percentages to the user. This does not change the model's ranking/AUC, only how its raw scores map to probabilities — re-run the percentile-based tier recalibration (GREEN_MAX/YELLOW_MAX) AFTER calibration, since calibration shifts the probability distribution those percentiles are computed from.

**Train/test split — split by year, not randomly:** train on 2022–2024 rows, test on 2025–2026 rows. A random split leaks information — if 10 July 2025 is in training and 11 July 2025 is in test, the model has effectively seen the answer. Year-based splitting simulates the real deployment condition: predicting a season the model has never seen.

**Evaluation — report all of these, not just accuracy:**
```
ROC-AUC            overall discriminative power
Precision          of alerts fired, how many were real floods
Recall             of real floods, how many were caught
Confusion matrix   the raw counts
```
Be explicit about asymmetric cost: a false negative (telling a commuter the road is clear when it floods) is far worse than a false alarm. Tune the decision threshold for **high recall**, and state this explicitly in the report.

**Risk tiers — recalibrated from the actual trained model (added after the first tuned run showed the original fixed 0.30/0.60 cutoffs no longer separate the tiers meaningfully):**

The original `config.GREEN_MAX = 0.30` / `config.YELLOW_MAX = 0.60` were placeholders chosen before any model existed. Now that the model is trained and tuned, replace them with **percentile-based cutoffs computed from this model's actual predicted-probability distribution on the test set**:
- Compute all predicted probabilities on the 2025-2026 test set.
- Set `GREEN_MAX` = the 50th percentile of that distribution (bottom half of rainy days → GREEN).
- Set `YELLOW_MAX` = the 85th percentile (next 35% → YELLOW; top 15% → RED).
- Update `config.py` with these two concrete, data-derived numbers (not the old 0.30/0.60), and report what they actually came out to.
- Recompute and report the tier flood-rates (GREEN/YELLOW/RED) with the new cutoffs — the goal is for RED to be a meaningfully smaller, higher-precision group than it was under the old fixed cutoffs, and for the GREEN→YELLOW→RED flood-rate gradient to be clearly separated, not bunched together like YELLOW (14.9%) and RED (17.2%) were under the old cutoffs.
- This changes only how probabilities are labeled GREEN/YELLOW/RED for display — it does not change the model, the decision threshold used for evaluation metrics, or retrain anything. Re-save `models/risk_model.pkl` if the tier cutoffs are stored alongside it; update `predict.py` to use the new `config.py` values.
- If a future retrain (e.g. after more data) shifts the probability distribution again, these cutoffs should be recalibrated the same way rather than left stale — note this as an operational step in `LIMITATIONS.md` (Phase 11).

```python
GREEN  = p < GREEN_MAX    # proceed normally — concrete value set from Phase 7's recalibration
YELLOW = GREEN_MAX <= p < YELLOW_MAX  # allow extra time, check before leaving
RED    = p >= YELLOW_MAX  # avoid this route
```

**Fallback if labels are too sparse:** if the positive class in the training split has fewer than ~40 examples, a trained model is unlikely to be reliable. In that case, implement this transparent rule-based scorer instead:
```python
def rule_score(rain_max_1h, rain_prev_3d, sink_depth_m):
    score = 0
    if rain_max_1h  > 25:  score += 2
    if rain_max_1h  > 40:  score += 1
    if rain_prev_3d > 50:  score += 1
    if sink_depth_m >  2:  score += 2
    return ["GREEN", "GREEN", "YELLOW", "YELLOW", "RED", "RED"][min(score, 5)]
```
This is a legitimate, defensible choice for a small dataset — not a failure. It's also arguably more trustworthy than an undertrained black box, which ties directly into the project's explainability-driven value proposition. Present it as a deliberate decision if used.

**Tasks:**

1. Write `src/train_model.py`: load `training_data.csv`, split by year, train the RandomForest, evaluate on the held-out set (all four metrics above), extract and report feature importances, save to `models/risk_model.pkl` via `joblib`.

2. **Decision gate:** apply the fallback rule above if the positive class is too small. `src/predict.py` should support both a `model` mode and a `rules` mode, selected by a flag. State clearly in the report which mode is being used and why.

3. Write `src/predict.py`: given rainfall + terrain features for a hotspot (live or historical), output a risk probability (or rule score) and a Green/Yellow/Red tier using the thresholds above.

**Produce the Phase 7 Report**, including the full confusion matrix, all metrics, feature importances, and which model mode was ultimately used, then stop.

---

## 10. Phase 8 — Explainability Layer

**Goal:** every risk score comes with a plain-language reason, not just a number. **This is the project's actual differentiator** — existing tools give a score or a generic rain warning; this gives a specific, checkable reason.

**Tasks:**

1. Write `src/explain.py` implementing this template-based logic:
   ```python
   # src/explain.py
   def explain(hotspot, risk, features, history):
       reasons = []
       if features["rain_max_1h"] > 25:
           reasons.append(f"{features['rain_max_1h']:.0f}mm of rain forecast in a single hour")
       if features["sink_depth_m"] > 2:
           reasons.append(f"this point sits {features['sink_depth_m']:.1f}m below the surrounding road level")
       if features["rain_prev_3d"] > 50:
           reasons.append("ground is already saturated from recent rain")

       base = f"{hotspot} — {risk}."
       why  = " Because " + ", and ".join(reasons) + "." if reasons else ""
       past = f" It has flooded on {history['floods']} of the last {history['rain_days']} comparable rain days."
       return base + why + past
   ```
   Example output: *"Hero Honda Chowk — RED. Because 45mm of rain is forecast in a single hour, and this point sits 3.1m below the surrounding road level. It has flooded on 7 of the last 10 comparable rain days."*

2. **Use templates, not an external LLM API call.** Templates are free, instant, deterministic, and can't hallucinate a number. Note an LLM-based version as a future roadmap item only — do not implement it now.

3. Generate and report example output for at least 3 different hotspots across different risk tiers, so the project owner can read the actual sentences produced.

**Produce the Phase 8 Report**, including all example explanation sentences generated, then stop.

---

## 11. Phase 9 — RouteRain Web Application & Flood-Aware Routing

**Goal:** a live, clickable demo — the thing that actually gets shown at the final presentation. This phase has two parts: (A) the risk-advisory map (original scope), and (B) real flood-aware rerouting on top of it (added scope — this is what makes the project predict-*and*-reroute, not just predict-and-advise).

**Design rules (apply to both parts):**
- Colour must never be the only signal — pair it with a word ("RED — avoid"). Some viewers are colour-blind, and a grader may notice.
- Show the *reason* on the first screen, not behind a click. The explanation is the product.
- Display a confidence caveat somewhere visible — overclaiming accuracy is the fastest way to lose trust after one wrong alert. Something like: *"This model is trained on a limited historical dataset and should be used as a guide, not a guarantee. Always exercise your own judgment in heavy rain."*

### Part A — Risk advisory map

**Tasks:**

1. Build the RouteRain frontend in React/TypeScript with a FastAPI API in `app/api.py`:
   - A dark, responsive Gurugram/NCR map with a colored marker (green/yellow/red) per hotspot, using the live forecast pull from Phase 4, run through `predict.py` and `explain.py`.
   - Clicking a marker shows its explanation sentence from Phase 8; show latitude and longitude below the map for the selected marker or map point.
   - A visible forecast timestamp and confidence caveat.

2. Document local development and production startup commands and report what the project owner will see on first load.

### Part B — Flood-aware rerouting

**What this adds:** given a commuter's origin and destination, compute and show two routes on the map — the normal shortest route, and a flood-aware route that detours around today's RED/YELLOW hotspots — with the extra travel time made explicit, and the reroute explained in plain language using the same explainability style as Phase 8.

**Tasks:**

3. Write `src/build_road_graph.py`: download Gurugram/NCR's drivable road network once via `osmnx` (`ox.graph_from_place("Gurugram, Haryana, India", network_type="drive")`), save it to `data/external/road_graph.graphml`. This is a one-time, slow (multi-minute) step — it must be cached to disk and never re-downloaded automatically by the Streamlit app on every run. The app loads the cached graphml file; it only re-runs this script if the file is missing or the project owner explicitly asks to refresh it.

4. Write `src/route_planner.py` implementing:
   - Load the cached road graph with `osmnx`/`networkx`.
   - For each hotspot scored RED or YELLOW today (from `predict.py`), buffer a radius around its coordinate — **500m for RED, 300m for YELLOW** — and find every graph edge whose geometry intersects that buffer.
   - Build a *weighted* copy of the graph: multiply the `travel_time` (or `length`, whichever the graph carries) of every edge found above by a penalty factor — **×15 for edges near a RED hotspot, ×3 for edges near a YELLOW hotspot**. Do not delete these edges outright (a true closure would force unrealistic detours if it's genuinely the only road through an area) — heavy penalty lets the shortest-path algorithm route around them when a reasonable alternative exists, and still use them as a last resort when there's truly no other way through.
   - Given an origin and destination (geocoded via `geopy`/Nominatim, or lat/lon directly), compute:
     - `normal_route`: shortest path on the **unmodified** graph (what Google Maps would show with no flood awareness).
     - `flood_aware_route`: shortest path on the **penalized** graph.
   - Return both routes (as ordered node/coordinate lists), their distances, and estimated travel times, plus which hotspot(s) the flood-aware route avoided that the normal route would have passed near.

5. Extend `src/explain.py` (or add a sibling function) to generate a one-line reroute explanation, e.g.: *"Rerouted to avoid Bilaspur Chowk (RED) and Rajiv Chowk (YELLOW) — adds approximately 6 minutes."* If the two routes are identical (no RED/YELLOW hotspots near the direct path today), say so plainly rather than inventing a detour: *"No reroute needed — your direct route doesn't pass near any at-risk hotspot today."*

6. Add to the web interface:
   - Origin/destination input (two text fields, geocoded on submit; or let the user click two points on the map — either is acceptable, pick whichever is more reliable to implement).
   - Both routes drawn on the interactive web map in different colors/styles (e.g. grey dashed = normal, blue solid = flood-aware), with a legend.
   - The reroute explanation sentence from step 5, plus the distance/time delta between the two routes shown as plain numbers (not just implied by the map).
   - If origin/destination aren't provided, the app still works exactly as Part A (hotspot map only) — routing is additive, not a requirement to use the rest of the demo.

**Mandatory sanity checks for Part B, must be run and reported:**
- Run the router for at least 2 test origin/destination pairs where the direct route plausibly passes near a known RED-tier hotspot (use a day/forecast where at least one hotspot is RED or YELLOW — if none is RED/YELLOW on the day tested, temporarily force one hotspot's tier for testing purposes only, and say clearly in the report that this was a forced test case, not a real prediction).
- Confirm the flood-aware route's path does NOT pass through the penalized buffer zone (or only does so when literally no alternative exists, which must be reported explicitly if it happens).
- Confirm the flood-aware route is never faster than the normal route (penalization should only ever add cost or tie, never improve on the unweighted shortest path) — if it is faster, that's a bug in the weighting logic, not a feature, and must be fixed before this phase closes.
- Report the actual extra distance/time cost of rerouting for both test cases, so the project owner can judge whether the detours are realistic (a few minutes) rather than absurd (a 45-minute detour to avoid a 2-minute flood risk would indicate the penalty factors need tuning).

7. Document deployment requirements, including the cached `road_graph.graphml` file and processed/model assets; do not rebuild the graph automatically on the server.

**Produce the Phase 9 Report**, including a description of exactly what renders on screen for both Part A and Part B, the full sanity-check results for Part B (including both test routes' distance/time deltas), and any errors hit, then stop.

---

## 12. Phase 10 — Automation (scheduled daily scoring)

**Goal:** prove the "pre-departure alert" claim with a real automated run, not a manual script execution. Without this, it's a dashboard, not an alert.

**Tasks:**

1. Write `.github/workflows/daily_alert.yml`:
   ```yaml
   name: Daily risk scoring
   on:
     schedule:
       - cron: '30 0 * * *'     # 06:00 IST
     workflow_dispatch:
   jobs:
     score:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-python@v5
           with: { python-version: '3.11' }
         - run: pip install -r requirements.txt
         - run: python src/predict.py --notify
   ```

2. Implement the `--notify` flag in `predict.py`: pulls the live forecast, scores all 12 hotspots, and if any hits YELLOW or RED, sends a message via a Telegram bot. A Telegram bot is the simplest free, credible option here — no business verification needed, unlike WhatsApp Business API. Document the bot-creation steps in the report (these need the project owner's own Telegram account, so they're not something Claude Code can do automatically).

3. Note explicitly that secrets (bot token, chat ID) must go into GitHub Actions repository secrets, never committed to the repo — add the relevant keys to `.gitignore`/`.env.example` instead.

**Produce the Phase 10 Report**, including the full workflow YAML and exact manual steps the project owner must complete (bot creation, secret configuration) to make it live, then stop.

---

## 13. Phase 11 — Validation & Responsible AI Documentation

**Goal:** close the loop back to the original fieldwork, and write up the limitations honestly.

**Tasks:**

1. This phase is **primarily human work**, not code — Claude Code's job is to prepare the materials:
   - Generate a one-page printable/shareable summary of a live alert (screenshot-style or a simple exported HTML) for the project owner to physically show to the original 3 field-interview participants.
   - Prepare a short structured feedback form as a simple text/markdown file, covering at minimum: (1) Would you trust this enough to change your route? (2) What would make you not trust it? (3) Does the explanation sentence change your answer versus a bare colour alone?

2. Compile a `LIMITATIONS.md` summarizing, with specific numbers pulled from this project's actual data (not generic statements): label count and sampling bias (e.g. news coverage over-represents affluent/high-traffic areas), rainfall grid resolution limits, which years were used for train vs. test, and the final class balance — referencing the real figures reported in Phases 4–7.

**Produce the Phase 11 Report**, including the drafted feedback form and the full `LIMITATIONS.md` content, then stop. This is the final phase — after this, the report should also include a one-paragraph overall project summary suitable for pasting into a research paper's Methods/Limitations sections.

---

## 14. How This Gets Used

1. Paste this file to Claude Code as the operating plan. It is the only document needed — everything referenced is inlined above.
2. Tell it: *"Start Phase 1. Stop after the Phase 1 Report and wait for me."*
3. Copy each Phase Report back into this conversation for independent cross-verification before approving the next phase.
4. Repeat through Phase 11.

No phase should be skipped, and no phase should silently absorb another phase's work — if Claude Code finds itself needing something from a later phase while executing an earlier one, it should stop and say so rather than quietly doing both.
