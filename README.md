# RouteRain

RouteRain is a Gurugram monsoon risk dashboard. The interface is a React + TypeScript single-page app; FastAPI serves the JSON API and the production frontend. The Python forecasting, model, explanation, and road-routing pipelines remain the source of truth.

## Run locally

Install the Python dependencies into the project virtual environment and frontend dependencies once:

```powershell
.\venv\Scripts\python -m pip install -r requirements.txt
cd frontend
npm install
```

For development, start the API from the project root:

```powershell
.\venv\Scripts\python -m uvicorn app.api:app --reload --host 127.0.0.1 --port 8000
```

In another terminal, start Vite:

```powershell
cd frontend
npm run dev
```

Open the local Vite URL printed by npm. Vite proxies `/api` calls to FastAPI. For a single production-style server, run `npm run build` in `frontend`, return to the project root, then run:

```powershell
.\venv\Scripts\python -m uvicorn app.api:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000`. Production assets are served from `frontend/dist`.

## Runtime data

Live scoring needs `models/risk_model.pkl`, `data/raw/hotspots.csv`, and the processed terrain, training, and weather CSVs. Route planning additionally needs `data/external/road_graph.graphml`; build it once with `python src/build_road_graph.py`. The dashboard fetches the Open-Meteo forecast and caches scored results for ten minutes. Address resolution uses Nominatim, bounded to the project coverage area.

## Interface

The dark dashboard includes live tier counts, map markers and explanations, a historical flooded-event replay, RED/YELLOW route avoidance, risk caveats, and selectable map coordinates displayed as latitude and longitude directly below the map. React escapes hotspot text by default; API errors are returned as concise messages, and routing inputs have length limits.
