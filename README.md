# Driftline

Fly fishing web app: live USGS river flows, weather, hatch calendars, a fly recommender, a bug ID field key, a catch log, a trip planner, and knots and rigs. No paid AI or API keys: river and weather data come from free public services.

- `public/index.html` is the whole front end.
- `netlify/functions/data.mts` is a fallback relay for USGS and Open-Meteo data (`/api/data`), used only if a browser blocks the direct request.

Deploys automatically to Netlify on every push to `main`.
