// Shared helpers for Driftline push notifications and gauge checks.
import webpush from "web-push";
import { getStore } from "@netlify/blobs";

export const subs = () => getStore({ name: "push-subs", consistency: "strong" });

let configured = false;
export function configure() {
  if (configured) return true;
  const pub = Netlify.env.get("VAPID_PUBLIC_KEY");
  const priv = Netlify.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return false;
  webpush.setVapidDetails("https://driftline-fly.netlify.app", pub, priv);
  configured = true;
  return true;
}

export async function keyFor(endpoint) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// Send one notification. Removes the subscription if the browser has dropped it.
export async function send(key, rec, payload) {
  try {
    await webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 60 * 60 * 6 });
    return true;
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) await subs().delete(key);
    else console.error("push failed", e?.statusCode, e?.body);
    return false;
  }
}

export async function allSubs() {
  const { blobs } = await subs().list();
  const out = [];
  for (const b of blobs) {
    const rec = await subs().get(b.key, { type: "json" });
    if (rec) out.push([b.key, rec]);
  }
  return out;
}

const OGC = ["https://api.waterdata.usgs.gov/ogcapi/v0/collections", "https://api.waterdata.usgs.gov/ogcapi/v1/collections"];
async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
export async function latestCfs(site) {
  for (const base of OGC) {
    try {
      const j = await getJSON(`${base}/latest-continuous/items?f=json&monitoring_location_id=USGS-${site}&parameter_code=00060&limit=5`);
      for (const f of j.features || []) {
        const v = parseFloat(f.properties?.value);
        if (!isNaN(v)) return v;
      }
    } catch {}
  }
  try {
    const j = await getJSON(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${site}&parameterCd=00060&siteStatus=all`);
    const vals = j.value?.timeSeries?.[0]?.values?.[0]?.value || [];
    const v = parseFloat(vals[vals.length - 1]?.value);
    if (!isNaN(v) && v > -999) return v;
  } catch {}
  return null;
}

export function flowState(w, cfs) {
  if (cfs == null || w.idealLo == null || w.idealHi == null) return null;
  if (cfs < w.idealLo) return "low";
  if (cfs <= w.idealHi) return "fishable";
  if (w.hi != null && cfs > w.hi) return "blown";
  return "high";
}
