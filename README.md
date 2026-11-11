# Driftline

Fly fishing web app: live USGS river flows, weather, hatch calendars, a fly recommender, photo bug ID, an AI guide, a catch log, a trip planner, and knots and rigs.

- `public/index.html` is the whole front end.
- `netlify/functions/data.mts` relays USGS and Open-Meteo data (`/api/data`).
- `netlify/functions/ai.mts` runs Ask a Guide and Photo ID through Netlify AI Gateway (`/api/ai`).

Deploys automatically to Netlify on every push to `main`.
