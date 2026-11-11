# Driftline

Fly fishing web app for a small crew: live USGS river flows, weather, a weekend outlook, hatch calendars, a fly recommender, rivers and Cascade lakes, crew fishing reports with photos, a shared catch log, Ask a Guide and Photo ID (Claude via Netlify AI Gateway), a trip planner, and knots and rigs.

- `public/index.html` is the whole front end.
- `netlify/functions/crew.mts` stores crew reports, catches and photos in Netlify Blobs (`/api/crew`).
- `netlify/functions/ai.mts` runs Ask a Guide and Photo ID (`/api/ai`).
- `netlify/functions/data.mts` is a fallback relay for USGS and Open-Meteo data (`/api/data`).

Crew features and AI need the crew code, set as the `DRIFTLINE_CREW_CODE` environment variable in Netlify (Functions scope). Change it there and redeploy to change the code.

Deploys automatically to Netlify on every push to `main`.
