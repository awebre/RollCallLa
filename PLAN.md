# District Map — Find Your Legislator by Region

## Goal

Let users find their LA House Rep or State Senator by clicking a district on a map. No address input. No geolocation. Browse-only.

## Privacy framing (copy)

> Browse Louisiana's legislative districts. No address required. We don't ask for or store your location.

Stated once on the map page header.

## Scope (v1)

- New `#/map` route + header nav link.
- Chamber toggle (House 105 / Senate 39).
- Interactive map of LA with district polygons.
- Click district → side panel with current legislator (name, party, district #, link to detail).
- Vacant seats → gray polygon + "Seat vacant" in panel.
- A11y fallback: chamber selector + district number dropdown → same panel. Keyboard-reachable, screen-reader friendly.
- Disclaimer: "Showing current districts (2024 boundaries). Pick a session in the header to see how today's members voted on past bills."

## Out of scope (v2+)

- Historical district boundaries per session.
- ZIP / address geocoding lookup.
- Parish overlay layer with parish-level legislator summary.
- Vector tiles / PMTiles. v1 ships simplified GeoJSON as static assets.

## Architecture

### Data

- Source: US Census TIGER/Line 2024, state FIPS 22.
  - `SLDL` (state legislative district lower) → House 1-105
  - `SLDU` (state legislative district upper) → Senate 1-39
- Property used for join: `SLDLST` / `SLDUST` (district code) → cast to int → join `legislators.district` on `(role, district)`.
- Simplify via `mapshaper` to ~150-300 KB per chamber GeoJSON (Visvalingam weighted, ~3-5% retention). Acceptable visual fidelity for browse use.
- Output checked into repo at:
  - `worker/public/districts-house.geojson`
  - `worker/public/districts-senate.geojson`
- Build script: `worker/scripts/build-districts.mjs` — idempotent, fetches TIGER shapefiles, runs mapshaper, writes GeoJSON. Requires `mapshaper` on PATH (npx ok).

### Frontend

- Lib: `maplibre-gl` (no API key, no tile cost). No basemap initially; neutral background + district polygons + parish outline overlay (optional, deferred unless orientation is poor).
- New view: `worker/src/react-app/views/Map.tsx`.
- New nav link in `App.tsx` header. Hash route `#/map`.
- Loads GeoJSON for active chamber lazily on mount.
- Loads `/api/legislators?active=1` once, builds `(role, district) → legislator` map.
- Hover: highlight + tooltip with district # and member name.
- Click: select district + show side panel.
- Mobile: stacks vertically (map top, panel bottom). District dropdown is the recommended interaction below md breakpoint.

### A11y fallback (always visible)

Above the map: chamber radio + district `<select>` with all 1..N options labeled `District N — Last Name (Party)`. Selecting updates the same side panel and pans/zooms the map. Keyboard works without map interaction.

## Files touched

- `worker/scripts/build-districts.mjs` (new)
- `worker/public/districts-house.geojson` (new, generated)
- `worker/public/districts-senate.geojson` (new, generated)
- `worker/src/react-app/views/Map.tsx` (new)
- `worker/src/react-app/App.tsx` (route + header link)
- `worker/package.json` (`maplibre-gl` dep)
- `README.md` (1-line build instruction for districts)

No D1 migration. No new API endpoint — existing `/api/legislators` is reused.

## Risks / open questions

- TIGER 2024 publish lag: if not yet posted, fall back to TIGER 2023 (post-redistricting cycle is reflected from 2023 onward in LA).
- Bundle size of `maplibre-gl` (~800 KB gzipped). Acceptable for a feature page; lazy-load via dynamic import so non-map routes don't pay it.
- Polygon tap targets in dense urban districts. The dropdown fallback covers this.
