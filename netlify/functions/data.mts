import type { Config } from "@netlify/functions";

// Relays public USGS water data and Open-Meteo weather so the browser never
// depends on those services' CORS settings. Only these hosts are allowed.
const ALLOWED = new Set([
  "api.waterdata.usgs.gov",
  "waterservices.usgs.gov",
  "api.open-meteo.com",
  "api.water.noaa.gov",
  "router.project-osrm.org",
  "api.water.usgs.gov",
  "overpass-api.de",
  "overpass.private.coffee",
  "overpass.kumi.systems",
  "maps.mail.ru",
]);

export default async (req: Request) => {
  const target = new URL(req.url).searchParams.get("url");
  if (!target) return Response.json({ error: "Missing url parameter." }, { status: 400 });
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return Response.json({ error: "That url isn't valid." }, { status: 400 });
  }
  if (u.protocol !== "https:" || !ALLOWED.has(u.hostname)) {
    return Response.json({ error: "Only river, weather and routing data can be fetched." }, { status: 403 });
  }
  try {
    const upstream = await fetch(u.toString(), {
      headers: { accept: "application/json", "user-agent": "Driftline fly fishing app" },
      signal: AbortSignal.timeout(20000),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        // Gauges report every 15 minutes; cache briefly at the edge.
        "netlify-cdn-cache-control": "public, max-age=600, stale-while-revalidate=300",
        "cache-control": "public, max-age=300",
      },
    });
  } catch (e) {
    return Response.json({ error: "The data service didn't answer. Try again shortly." }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/data",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 120 },
};
