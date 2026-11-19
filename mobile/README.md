# RouteRain Mobile

Android app (Expo SDK 58, React Native 0.88, TypeScript, Expo Router) for the RouteRain flood-aware routing demo.
The phone stays thin: all scoring and routing happens on the FastAPI backend in `../app`.

**Status: Phase M3.** The only screen is a server health check that calls `/mobile/v1/health` and `/mobile/v1/scenarios`.

## Requirements

- Node 22.13 or newer (checked: 22.17.1) and npm.
- **Expo Go** from the Play Store on the Android phone (it must support SDK 58; update it if the app refuses to open).
- The backend running on the laptop (see below).
- Only for the tunnel option: `cloudflared` (`winget install --id Cloudflare.cloudflared`, then open a new terminal).

## Run it (Windows PowerShell)

**Terminal 1: backend** (repo root). It takes about 15 s to load the road graph; wait for `Application startup complete`.
```powershell
.\venv\Scripts\python -m uvicorn app.api:app --host 0.0.0.0 --port 8000
```
Windows may ask to allow Python through the firewall: allow it on **private** networks.

**Choose how the phone reaches the backend:**

- **Option A: same Wi-Fi, no extra software.** Run `ipconfig` and note the laptop's IPv4 address (e.g. `192.168.1.23`).
  The backend address is `http://192.168.1.23:8000`. Check it first: open that address followed by `/mobile/v1/health`
  in the phone's browser. If it does not load, the Wi-Fi blocks device-to-device traffic: use Option B.
  (Expo Go allows plain `http` while developing; a built APK will need `https`, which is what option B gives.)
- **Option B: Cloudflare tunnel (works on any network, gives HTTPS).** In a second terminal:
  ```powershell
  cloudflared tunnel --url http://localhost:8000
  ```
  Copy the `https://....trycloudflare.com` address it prints. It changes every time you restart it.

**Terminal 3: the app**
```powershell
cd mobile
copy .env.example .env
notepad .env          # set EXPO_PUBLIC_API_URL=<the address from option A or B>, save
npx expo start        # laptop and phone on the same Wi-Fi
# npx expo start --tunnel   # use this instead if the Wi-Fi blocks device-to-device traffic
#                             (the first time it asks to install @expo/ngrok: answer y)
```
On the phone, open Expo Go and scan the QR code shown in the terminal.

If you changed `.env` after starting, stop Metro (Ctrl+C) and run `npx expo start --clear`.
If Metro runs out of memory: `$env:NODE_OPTIONS="--max-old-space-size=4096"` first.

### What you should see

A dark screen titled **RouteRain** with a **Server** card:

- `✓ Server reachable`
- `✕ Not fully ready`  (correct for now: the risk model file is not on the laptop yet)
- Risk model `✕ No`, Road graph `✓ Yes`, Narration (AI) `✕ No`, Places `65 (0 verified)`, API version `mobile/v1`
- A **Replay days** card listing 7 August 2026, 8 July 2026, 31 July 2025 and 9 July 2025.

If the server cannot be reached you get `✕ Can't reach RouteRain server.` with a **Retry** button. Pull down to refresh.

### Changing the server address without rebuilding

**Long-press the "RouteRain" title** to open the developer field, paste a new tunnel address, press **Save**, then
pull down to refresh. **Reset** goes back to the address in `.env`. (The field also opens by itself if no address is set.)

## Checks

```powershell
npm run typecheck                                  # TypeScript
npx expo lint                                      # ESLint
npx expo-doctor                                    # dependency and config health
npm run check:contract -- http://127.0.0.1:8000    # parses the real backend's JSON with the app's zod schemas
```

## Layout

```
mobile/
  src/app/            Expo Router screens (_layout.tsx, index.tsx = health check)
  src/api/            client.ts (fetch + timeout + zod), schemas.ts, baseUrl.ts (env + runtime override)
  src/theme/          colour, spacing, type tokens; tiers.ts = tier colour + word + glyph helper
  scripts/            check-contract.mjs
```

`src/api/schemas.ts` section 1 mirrors the endpoints that exist today. Section 2 (`/hotspots`, `/route`, `/narrate`)
is a **draft** that will be finalised when those endpoints are built.

## Notes

- No secrets live in the app. `EXPO_PUBLIC_*` values are readable by anyone with the app, which is fine for a server address.
- `npm audit` reports 3 moderate findings (`minimatch`, inside Expo's own dev tooling). The only automatic fix downgrades Expo to SDK 52, so it is left alone.
- `AGENTS.md` is the template's guidance file for coding assistants; it stays.
