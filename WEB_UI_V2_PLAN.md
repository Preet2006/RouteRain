# RouteRain Web: UI v2 and In-App Navigation Plan for Claude Code

**Project:** RouteRain website, second round of UI changes
**Group 6** · Aryan Srivastava, Preet Jhagekar, Laksh Sharda, Mayank Bansal
**Builds on:** `WEB_APP_PLAN.md` (the website that already exists: entry, setup, home/plan trip, route result, settings) and the `/api/v2` backend.
**Audience:** Claude Code, executing phase by phase, and the project owner, approving each phase.

---

## 0. Rules

1. **One phase at a time.** Each phase ends with a Phase Report in the exact format of `PLAN.md` §1, then STOPS until the owner says "proceed to Phase Un+1".
2. **Do not touch the model, `predict.py`, `route_metrics.py` maths, the flood-delay value or the replay dates.** These are UI and navigation changes only, plus one new backend module for turn-by-turn directions (U4).
3. **Everything in `WEB_APP_PLAN.md` §0 and §3 still applies**: no secrets in the frontend, replay always labelled, "save" only when the expected saving is positive, numbers spoken equal numbers shown.
4. **Keep existing pages working while changing them.** If a phase restructures a page, the old behaviour must still be reachable until the owner confirms the new one.
5. **Fail loudly.** A missing route, failed directions call or map tile error shows a clear message, never a frozen or blank screen.

---

## 1. The Changes Requested

| # | Change | Phase |
|---|---|---|
| 1 | Entry screen: big "RouteRain" name in the centre and an Enter button | U1 |
| 2 | Whole site full screen and full width, not boxed in the centre | U1 |
| 3 | Main tabs (Home / Plan trip, Hotspots, Settings, About) as full-screen pages | U1 |
| 4 | Hotspots move off the Plan trip page into their own page: a list of all hotspots with colour and tier, each with "View in detail" that opens a full-screen map of that spot | U2 |
| 5 | Settings: changes are saved with a Save button at the bottom | U3 |
| 6 | Route result: a "Start trip with RouteRain" button | U5 |
| 7 | Navigation screen like Google Maps: car moving on the route, map following the car, spoken "turn left / turn right" instructions, so the user never leaves RouteRain | U4 (backend) + U5 (screen) + U6 (live GPS) |

---

## 2. Key Design Decisions

### 2.1 Turn-by-turn instructions come from our own road graph

The routes are paths through the cached OSM road graph (`road_graph.graphml`), so the directions are computed from that same path. No outside routing service is used, which means the navigation always follows exactly the flood-aware route RouteRain recommended.

How a step is built (U4):
- Walk the route's edges in order. Group consecutive edges that share the same road name (`name`, or `ref` such as "NH-48" when the name is missing).
- At each change of road, compare the compass bearing of the last segment before the junction with the first segment after it.
- Classify the bearing change: under 20° = continue straight; 20° to 45° = slight left/right; 45° to 135° = turn left/right; over 135° = sharp turn or U-turn.
- Roundabouts: edges tagged `junction=roundabout` become one step, "At the roundabout, take the Nth exit onto X" (count exits from the graph). If the exit count can't be computed reliably, say "Go through the roundabout onto X".
- Unnamed roads: "Turn left" with no street name, never "Turn left onto unnamed road".
- Very short steps (under 25 m) are merged into the next one, so the voice doesn't fire twice in a second.

These are deterministic templates, not the LLM: navigation prompts must be instant and must never be wrong because a model rephrased them. The LLM is used only for the one-line trip summary spoken at the start (already built in W2).

### 2.2 The navigation map uses MapLibre GL JS with OpenFreeMap tiles

The current maps use Leaflet, which can't rotate or tilt the map. A Google-Maps-style view (map turns so your direction of travel points up, slight 3D tilt, smooth camera following the car) needs a WebGL map.

- **MapLibre GL JS** (open source) for the navigation screen.
- **OpenFreeMap** vector tiles: its public instance is free with no registration, no API key and no request limits. Use the `liberty` or `positron` style and darken it to match the site if no dark style exists. OpenStreetMap attribution must stay visible.
- OpenFreeMap's public service is provided as-is and may change, so U5 includes a fallback: if the vector style fails to load, the navigation screen switches to the existing Leaflet tiles in north-up mode with a rotated car icon, and shows a small notice.
- The other pages (Home, Hotspots, Route result) can stay on Leaflet. Moving them to MapLibre is optional, decided by the owner after U5.

### 2.3 Two driving modes, clearly labelled

| Mode | How the car moves | When |
|---|---|---|
| **Simulated drive** (default on laptop) | The car moves along the route at the graph's free-flow speeds, with a speed control (1×, 5×, 10×, 20×) and pause/resume | Demo on a laptop that isn't moving |
| **Live GPS** (U6) | Browser `watchPosition`, the position snapped onto the route | Real use on a phone. Needs HTTPS or `localhost`; over plain `http://<laptop-ip>` the browser blocks location, so on a phone it works only through an HTTPS tunnel |

Simulated mode shows a permanent "Simulated drive" badge. It must never look like real positioning.

### 2.4 Voice prompt timing

Using the browser's `speechSynthesis` (already wrapped in `src/lib/speech.ts`), in the user's chosen language:

| Moment | Example (English) |
|---|---|
| Trip start | the W2 summary sentence, then "Head north on Sohna Road." |
| ~500 m before a manoeuvre (only on roads longer than 800 m) | "In 500 metres, turn left onto Golf Course Road." |
| ~150 m before | "In 150 metres, turn left." |
| At the manoeuvre (~20 m) | "Turn left now." |
| Approaching an avoided hotspot area (within 1 km, once) | "Bilaspur Chowk, rated RED, is to your right. Your route keeps you clear of it." |
| Arrival | "You have arrived at Cyber Hub." |

Each prompt fires once. A new prompt cancels any prompt still speaking. In simulated mode at high speed, the 500 m and 150 m prompts are skipped when they would overlap. Hindi uses fixed templates in `src/lib/navPhrases.ts` (e.g. "बाएं मुड़ें"), reviewed by the owner in U5.

---

## 3. Phase U0: Audit the Current Site

**Goal:** know exactly what the site looks like now before changing it. No code changes.

**Tasks:**
1. Report which `WEB_APP_PLAN.md` phases are finished, partly done or not started, with evidence (files, routes, commits).
2. List every page and route in `frontend/src`, its layout container, and any `max-width`, centring or fixed-width CSS causing the "too much in the centre" look.
3. Describe the current entry/welcome screen, the Plan trip page (how hotspots are shown there now), and the Settings page (does it save on every change?).
4. Inspect the cached route result: does it keep the **full** edge-geometry path and the node list, or only the ≤300-point simplified polyline? (U4 needs the node list.)
5. Check the road graph for the edge attributes U4 needs: `name`, `ref`, `junction`, `oneway`, `geometry`, `length`, `travel_time`, `speed_kph`. Report what fraction of edges on 3 sample routes have a usable name or ref.
6. Take screenshots of every page at 1366 × 768 and 1920 × 1080, if a headless browser is available; otherwise describe them.

**Report**, then STOP.

---

## 4. Phase U1: Entry Screen, Full-Screen Layout and Tabs

**Tasks:**
1. **Entry screen (`/`, first thing every visitor sees):**
   - Full viewport, dark background with a slow, subtle animated rain or map texture (CSS only, no video; respects `prefers-reduced-motion`).
   - "RouteRain" large in the exact centre (about 12–14% of viewport width on desktop, at least 56 px on phones), with the tagline "Know before you go: flood-aware routes for Gurugram" below it.
   - One large **Enter** button under the tagline. Enter also works from the keyboard.
   - First-time visitors go to `/setup`; returning visitors go straight to `/plan`.
   - Small footer: "Group 6 · MDI Gurgaon" and the caveat link.
2. **Full-screen app shell** for every page after the entry screen:
   - Remove all centred fixed-width containers. Pages fill `100vw × 100vh` (use `100dvh` on mobile so browser bars don't cut it off).
   - A slim top bar (desktop) or bottom tab bar (under 768 px) with the tabs **Plan trip**, **Hotspots**, **Settings**, **About**, the RouteRain wordmark, the Live/Replay selector and the greeting.
   - Map pages: the map fills all remaining space; panels float over it or dock to the left at a fixed 380–420 px width.
   - Text pages (Settings, About): content uses the full width with a sensible reading column (about 720 px for paragraphs) and wide layouts for grids and tables.
3. Check every page at 360, 768, 1366 and 1920 px wide: no horizontal scroll, nothing clipped.

**Sanity checks:** screenshots or descriptions at the 4 widths; entry → setup → plan works for a new visitor and entry → plan for a returning one.

**Report**, then STOP.

---

## 5. Phase U2: Hotspots Page and Hotspot Detail

**Tasks:**
1. **Plan trip page (`/plan`) simplified:** the map and the From/To planner only. No hotspot cards or long lists. Hotspots appear as small tier-coloured dots with a text label on hover/focus, and a toggle "Show hotspots" (on by default). A one-line summary ("2 hotspots at risk today · View all") links to the Hotspots page.
2. **Hotspots page (`/hotspots`):** full-screen grid of 12 cards, 3–4 per row on desktop, 1 per row on phones. Each card shows:
   - a coloured strip **and** the tier word with an icon (RED / YELLOW / GREEN / LOW RAIN);
   - hotspot name and area;
   - probability as a percentage band (e.g. "28–30%"), or "Not scored, under 10 mm rain";
   - the first reason from `explain.py`, one line;
   - in replay, "Reported that day: flooded / no report";
   - a **View in detail** button.
   - Above the grid: filter chips (All, RED, YELLOW, GREEN, LOW RAIN), sort (risk high to low, name A–Z), and the scenario banner.
3. **Hotspot detail page (`/hotspots/:id`):** full-screen map centred on the spot at street level, with:
   - the hotspot marker and its 500 m (RED) or 300 m (YELLOW/GREEN) buffer drawn as a circle;
   - nearby roads visible so the user sees which junction it is;
   - a docked side panel: tier, probability, full `explain.py` sentence, terrain facts (`sink_depth_m`, `elevation_m`), rain facts for the scenario day, number of past recorded floods for this hotspot from `flood_labels_clean.csv`, infrastructure issue note if any, lat/lon, and in replay the reported outcome;
   - "Plan a trip avoiding this" (opens `/plan`) and "Back to all hotspots".
4. Deep links work: refreshing `/hotspots/H03` reloads the same view.

**Sanity checks:** card data equals `/api/v2/hotspots` for one live and one replay scenario (table); filters and sort work; detail page for 3 hotspots, including a LOW RAIN one.

**Report**, then STOP.

---

## 6. Phase U3: Settings With a Save Button

**Tasks:**
1. Settings edits a **draft** copy of the profile. Nothing is stored until **Save** is pressed.
2. A sticky bar at the bottom of the Settings page with **Save changes** (primary) and **Cancel** (reverts the draft). Save is disabled while nothing has changed.
3. On save: write to `localStorage`, show a "Settings saved" toast, and apply immediately (greeting, voice language, caution level used by the next route).
4. Leaving the page with unsaved changes asks "Discard unsaved changes?" (in-app dialog, not a browser `alert`).
5. Field validation: name up to 40 characters; Home/Work must be valid places.
6. "Clear my data" stays, separate from Save, with its own confirmation.

**Sanity checks:** change name → leave without saving → prompt appears; save → reload → change kept; cancel → reverted.

**Report**, then STOP.

---

## 7. Phase U4: Turn-by-Turn Directions (Backend)

**Tasks:**
1. Make sure the route cache keeps, for both routes, the **node list** and the **full edge geometry** (not only the simplified polyline). The simplified polyline stays for drawing; the full one is used for navigation.
2. `src/directions.py` implementing §2.1:
   - `build_steps(graph, node_path) -> list[Step]`, where each step has `index, maneuver` (`depart`, `continue`, `turn`, `slight`, `sharp`, `uturn`, `roundabout`, `arrive`), `modifier` (`left`, `right`, `straight`), `street`, `distance_m`, `duration_s`, `location [lat, lon]`, `bearing_before`, `bearing_after`, `exit_number` (roundabouts), `instruction_en`.
   - `build_nav_geometry(graph, node_path)`: full coordinate list with cumulative distance at each point and the index of each step on it, so the frontend can find "distance to next turn" by position along the line.
   - Hotspot proximity events along the route: the distance along the route at which the car comes within 1 km of each avoided RED/YELLOW hotspot, and which side it's on.
3. Endpoint `GET /api/v2/route/{route_id}/directions?which=flood_aware|normal` returning steps, nav geometry, total distance and time, and hotspot events. 404 with a clear message if the route has expired.
4. Tests on a synthetic grid graph: an L-shaped path gives exactly one "turn left" or "turn right" with the correct side; a straight path gives only depart and arrive; same-name edges merge; an unnamed road has no "onto"; a roundabout yields a roundabout step; steps under 25 m merge; total step distance equals route length within 1 m.
5. Real-graph check: print the full step list for 3 replay trips (including one with a detour around a RED hotspot) so the owner can compare it against Google Maps by eye.

**Sanity checks to report:** test results; the 3 real step lists; share of steps with a street name; anything that looks wrong (e.g. a "turn" on a curving road with the same name).

**Report**, then STOP.

---

## 8. Phase U5: Navigation Screen (Simulated Drive)

**Tasks:**
1. Route result page: a large primary button **Start trip with RouteRain** under the advice, plus a smaller "Preview the usual route" link. The button opens `/navigate/:routeId`.
2. Add `maplibre-gl` to the frontend. Create `NavigationMap` with an OpenFreeMap style (§2.2). Vite worker setup as in the MapLibre docs. Keep OSM attribution visible. Fallback to Leaflet north-up mode if the style fails.
3. **Screen layout (full screen, nothing else on screen):**
   - Top banner: big manoeuvre arrow icon, distance to the turn ("300 m"), street name; below it a smaller "Then turn right" for the next step if it's within 200 m.
   - Map: route line in RouteRain blue, already-driven part greyed out, avoided-hotspot buffers in translucent red/yellow, car icon at the current position pointing in the direction of travel.
   - Camera: follows the car, heading-up (map rotates with the car), tilt about 45°, zoom about 16–17, smooth easing. Zooms in slightly before turns.
   - Bottom bar: arrival time (clock), remaining minutes, remaining km, **End trip** button, mute/unmute, re-centre (appears after the user drags the map), and in simulated mode the speed selector and pause.
   - Badges: "Simulated drive" and, in replay, "Replay: 7 Aug 2026 weather".
   - Hotspot alert banner when the car is within 1 km of an avoided hotspot, matching the spoken line.
4. **Simulation engine:** moves the car along the nav geometry using each edge's free-flow speed × the chosen multiplier, at 60 fps with `requestAnimationFrame`; pausing stops time. Pausing or hiding the browser tab must not make the car jump.
5. **Voice prompts** per §2.4, using step distances from U4. The first prompt plays from the Start click, which counts as the user interaction Chrome needs before speech; if speech is blocked anyway, show "Tap to enable voice".
6. **Arrival screen:** "You have arrived", trip time, distance, hotspots avoided, and "Plan another trip". Saves the trip to recent trips.
7. Leaving the page or pressing End trip stops speech and the simulation.
8. Hindi phrase templates in `src/lib/navPhrases.ts`, listed in the report for the owner to review.

**Sanity checks to report (Chrome, laptop):**
- Full simulated run of 2 replay trips at 10×: every step spoken once, in order, no overlaps; the car stays on the line; heading-up rotation is smooth.
- The avoided RED hotspot alert fires once, on the correct side.
- Arrival screen numbers match the route result page.
- Style load failure (block the tile host in DevTools): Leaflet fallback appears with a notice.
- Frame rate stays smooth on the demo laptop (report average fps during a run).

**Report**, then STOP.

---

## 9. Phase U6: Live GPS Mode and Demo Updates

**Tasks:**
1. On the navigation screen, a "Use my real location" switch (hidden when the browser has no geolocation or the page isn't secure).
2. `watchPosition` with high accuracy; snap the position to the nearest point on the nav geometry; heading from the last two snapped points.
3. **Off-route:** more than 50 m from the route for over 10 seconds → "Recalculating", call `/api/v2/route` from the current position to the same destination with the same scenario and caution, and continue on the new route with a spoken "Rerouting". At most one reroute every 30 seconds.
4. If the GPS signal is lost for over 15 seconds, show "Waiting for GPS" and pause prompts.
5. Explain in the About page and README that live mode on a phone needs the site over HTTPS (e.g. through the Cloudflare tunnel) and is a demonstration, not a safety-certified navigation app.
6. Update `DEMO_SCRIPT.md`: entry screen, Hotspots page and one detail view, plan a replay trip, Start trip, simulated drive at 10× through the detour, arrival. Note Plan B (offline demo pack) and Plan C (Leaflet fallback).
7. Update the offline demo pack (from W8) to include directions and nav geometry for its 2 routes, so a simulated drive also works without internet. Map tiles can't be bundled under OpenFreeMap's terms, so in fully offline mode the drive runs on a plain background with the route line, labelled "Offline demo".

**Sanity checks:** a short real walk or drive with a phone over the HTTPS tunnel, if the owner can do one (report what the owner observed; Claude Code cannot test this itself); the off-route logic tested in code with a scripted fake GPS track that leaves and rejoins the route.

**Report.** This is the last phase of this plan. After it, `PLAN.md` Phase 11 (`LIMITATIONS.md`, feedback form) is still pending; add to it that navigation uses free-flow OSM speeds, has no live traffic, and that the turn instructions are generated from OSM road names and geometry.

---

## 10. Phase Order

**U0 → U1 → U2 → U3 → U4 → U5 → U6.**
U3 can be done any time after U1. U4 is backend-only, so the owner may run it in parallel with U2 or U3 in a separate session if wanted.