import { useQuery } from '@tanstack/react-query';

import { getHealth } from '@/api/client';

/** Static facts below come from the project's own reports (PLAN.md phases 4 to 7, PROGRESS.md). */
export function About() {
  const { data } = useQuery({ queryKey: ['health'], queryFn: getHealth });
  const delay = data ? data.flood_delay_min.toFixed(1) : '23.4';
  return (
    <>
      <h1>About RouteRain</h1>
      <p><b>A guide, not a guarantee.</b> RouteRain is a research project. Use your own judgement in heavy rain.</p>

      <section className="rr-card" aria-labelledby="a-what">
        <h2 id="a-what">What it does</h2>
        <p>
          RouteRain scores waterlogging risk at 12 known flooding hotspots in Gurugram, explains each score in plain
          words, and plans a drive that goes around the hotspots that are at risk.
        </p>
        <ul>
          <li><b>RED</b>: avoid if you can. <b>YELLOW</b>: allow extra time. <b>GREEN</b>: proceed normally.</li>
          <li><b>LOW RAIN</b> (replay days only): under 10 mm of rain that day, so the model does not score it.</li>
          <li>The tiers are relative: RED is the top 15% of scores on rainy days and GREEN is the bottom half. They are not a promise that a road will or will not flood.</li>
        </ul>
      </section>

      <section className="rr-card" aria-labelledby="a-model">
        <h2 id="a-model">How accurate is it?</h2>
        <ul>
          <li>A random forest, trained on rainy days from 2022 to 2024 and tested on 2025 to 2026 days it had never seen.</li>
          <li><b>Test ROC-AUC 0.638</b> (447 rainy hotspot-days, 60 with a reported flood). That is better than chance (0.5) but modest.</li>
          <li>Terrain explains little on its own; recent rain, soil moisture and each hotspot's flood history matter more.</li>
        </ul>
      </section>

      <section className="rr-card" aria-labelledby="a-saving">
        <h2 id="a-saving">The “time saved” estimate</h2>
        <p>
          A detour always costs driving time. It only “saves” time if it avoids a hotspot that might flood. For each
          hotspot near a route we add <i>probability × a flood delay</i> to that route's drive time, and compare the two routes.
        </p>
        <p>
          The flood delay is one number: <b>{delay} minutes</b>. <b>This is an assumption, not measured data.</b> It is the
          average of three guessed delays (minor pooling 5 min, traffic disrupted 20 min, road closed 45 min) weighted by how
          often each kind appears among the 168 reported flood events we collected: 15 minor, 121 disrupted, 32 closed.
          Only 2 of those reports mention how long the flood lasted, so the data cannot confirm it.
        </p>
        <p>Drive times are free-flow estimates from road speed limits. They do not include traffic.</p>
      </section>

      <section className="rr-card" aria-labelledby="a-data">
        <h2 id="a-data">Where the data comes from</h2>
        <ul>
          <li><b>Flood reports</b>: 168 events found by hand in news and social media, 2022 to 2026. News over-reports busy, wealthy areas and misses small floods, so real flooding is under-counted.</li>
          <li><b>Rain and soil moisture</b>: Open-Meteo (gridded reanalysis and forecast). A grid cell is not a rain gauge, so it can differ from what fell on a specific road.</li>
          <li><b>Terrain</b>: a 30 m SRTM elevation model. Fine drainage details and blocked drains are invisible to it.</li>
          <li><b>Roads</b>: OpenStreetMap. <b>Place search</b>: a short list of Gurugram places, plus OpenStreetMap's Nominatim for “search the full map”.</li>
        </ul>
      </section>

      <section className="rr-card" aria-labelledby="a-replay">
        <h2 id="a-replay">Replay days</h2>
        <p>
          Replay re-scores a real past monsoon day from 2025 or 2026, which the model was not trained on. It is always labelled
          with its date. The “reported that day” line shows what was recorded, separately from the prediction, so you can see where the model was right and where it missed.
        </p>
      </section>
    </>
  );
}
